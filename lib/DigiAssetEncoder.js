const lookup = require("digiasset-lookup");
const constants = require("./constants");
const outputPair = require("outputpair");
const helpers = require("./helpers");
const ExpectedError=require("./ExpectedError");

class DigiAssetEncoder {
    constructor({allowAssetsInInputs,inputAddressesNeeded}) {
        this._allowAssetsInInputs=allowAssetsInInputs;
        this._inputAddressesNeeded=inputAddressesNeeded;
        this._lookupUTXOs=true;
        this._utxos=[];
        this._balances={
            DigiByte: 0n
        }
        this._assetIdVersions={};
        this._encoded=false;
        this._change={};
        this._outputsDigiByte={};
    }

    /**
     * Erases the results of the build command
     */
    reset() {
        this._encoded=false;
    }

    /**
     * Adds multiple UTXOs to the object
     * @param {UTXO[]}  UTXOs
     * @returns {Promise<void>}
     */
    async addUTXOs(UTXOs) {
        this.reset();
        checkUtxo: for (let index in UTXOs) {
            //check if already in utxo list and skip if it is
            for (let {txid,vout} of this._utxos) if ((UTXOs[index].txid===txid)&&(UTXOs[index].vout===vout)) continue checkUtxo;

            //lookup UTXOs[index] if is not in digiassetX standard format or force lookup is on
            if ((UTXOs[index].value === undefined) || (this._lookupUTXOs)) UTXOs[index]=await lookup.getUTXO(UTXOs[index].txid, UTXOs[index].vout);
            if (this._inputAddressesNeeded) await helpers.includeScriptPubKey(UTXOs[index]);
            this._utxos.push(UTXOs[index]);

            //set DigiByte change address to first address of first UTXOs[index] without assets if we know it
            if ((this._changeDigiByte===undefined)&&(UTXOs[index].assets===undefined)&&(UTXOs[index].scriptPubKey!==undefined)&&(UTXOs[index].scriptPubKey.addresses!==undefined)) {
                this._changeDigiByte=UTXOs[index].scriptPubKey.addresses[0];
            }

            //add balance
            this._balances.DigiByte+=BigInt(UTXOs[index].value);
            if (UTXOs[index].assets!==undefined) {
                //asset found
                for (let {assetId,amount,cid} of UTXOs[index].assets) {
                    //check if assets allowed in transaction
                    if (!this._allowAssetsInInputs) throw new ExpectedError("DigiAsset present in UTXO");

                    //compute the assets sub version if there is one
                    let id=assetId;
                    if (cid!==undefined) id+=":"+cid;  //none aggregable asset are split based on meta data

                    //make sure only 1 sub version present
                    if (this._assetIdVersions[assetId]===undefined) {
                        this._assetIdVersions[assetId]=id;
                    } else if (this._assetIdVersions[assetId]!==id) {
                        throw new ExpectedError("Can't mix sub versions of an asset in a transaction");
                    }

                    //keep track of balance
                    if (this._balances[assetId]===undefined) this._balances[assetId]=0n;
                    this._balances[assetId]+=BigInt(amount);
                }
            }
        }
    }

    /**
     * adds a UTXO to the object
     * @param {UTXO}    utxo
     * @returns {Promise<void>}
     */
    async addUTXO(utxo) {
        await this.addUTXOs([utxo]);
    }

    /**
     * Adds an extra output that DigiByte will be sent to.  Will throw and error during build if DigiAssets are also sent to this address
     * @param {string}  address
     * @param {bigint}  amount
     */
    addDigiByteOutput(address,amount) {
        if (this._outputsDigiByte[address]===undefined) this._outputsDigiByte[address]=0n;
        this._outputsDigiByte[address]+=amount;
    }

    /**
     * Returns number of DigiByte in utxos
     * @returns {bigint}
     */
    get balanceDigiByte() {
        return this._balances.DigiByte;
    }

    /**
     * Returns a copy of asset balances
     * @returns {Object<bigint>}
     */
    get balanceAssets() {
        let temp={};
        for (let assetId in this._balances) {
            if (assetId==="DigiByte") continue;
            temp[assetId]=this._balances[assetId];
        }
        return temp;
    }

    /**
     * Returns a copy of asset balances including DigiByte
     * @returns {Object<bigint>}
     */
    get balance() {
        let temp={};
        for (let assetId in this._balances) temp[assetId]=this._balances[assetId]; //copy each item so manipulating returned value does not effect object
        return temp;
    }

    /**
     * Allows setting the block height that expiry tests should be run at
     * @param height
     */
    set blockHeight(height) {
        this._height=height;
    }

    /**
     * Allows setting the block height that expiry tests should be run at
     * @param {BigInt}  time
     */
    set blockTime(time) {
        this._time=BigInt(time);
    }

    /**
     * returns the current time in seconds since epoch(or user entered value if set)
     * @returns {BigInt}
     */
    get blockTime() {
        if (this._time!==undefined) return this._time;
        return BigInt(Math.round((new Date()).getTime() / 1000));
    }

    /**
     * If you know UTXOs already contain asset data you can save some time by setting this to false
     * by default it is enabled
     * @param {boolean} state
     */
    set forceLookup(state) {
        this._lookupUTXOs=state;
    }

    /**
     *
     * @param address
     */
    set DigiByteChangeAddress(address) {
        this._changeDigiByte=address;
    }

    /**
     * Builds the transaction
     * @returns {Promise<void>}
     */
    async build() {
        throw new ExpectedError("Must be overwritten");
    }

    /**
     * Returns the inputs and outputs in the correct form to use the createrawtransaction(inputs,outputs) rpc command
     * @returns {{
     *      outputs: Object<string>[],
     *      inputs:  {txid: string,vout:int}[]
     * }}
     */
    get tx() {
        if (typeof this._encoded!=="string") throw new ExpectedError("Transaction not yet built");
        let inputs=[];
        for (let {txid,vout} of this._utxos) inputs.push({txid,vout});
        let outputs=JSON.parse(this._encoded);
        return {inputs,outputs};
    }

    /**
     * Handles DigiByte change and any extra outputs needed
     * @param {Object<string[]>}    txOutputs
     * @param {bigint}              amountLeft
     * @returns {string}
     */
    _addFinalOutputs(txOutputs,amountLeft) {
        //add extra outputs
        for (let address in this._outputsDigiByte) {
            txOutputs.push(outputPair(address,this._outputsDigiByte[address]));
            amountLeft-=this._outputsDigiByte[address];
        }

        //add change if applicable
        if (amountLeft>=constants.dust) {
            if (this._changeDigiByte===undefined) throw new ExpectedError("Change left over and no change address defined");
            txOutputs.push(outputPair(this._changeDigiByte,amountLeft));
            this._change.DigiByte=amountLeft
        }

        //check for common errors
        if (amountLeft<0n) throw new ExpectedError("Not enough funds: short "+(0n-amountLeft).toString()+" sat");
        let addresses=[];
        for (let line of txOutputs) {
            let address=Object.keys(line)[0];
            if (addresses.indexOf(address)!==-1) throw new ExpectedError("More then 1 output to the same address");
            addresses.push(address);
        }

        //return stringified result
        return JSON.stringify(txOutputs);
    }
}
module.exports=DigiAssetEncoder;