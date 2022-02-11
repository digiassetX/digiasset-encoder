const DigiAssetEncoder = require("./DigiAssetEncoder");
const rulesVerifier = require("./rules_verify");
const lookup = require("digiasset-lookup");
const helpers = require("./helpers");
const BitIO = require("bit-io");
const outputPair = require("outputpair");
const constants = require("./constants");
const decoder = require("digiasset-decoder");
const ExpectedError=require("./ExpectedError");

class DigiAssetTransferor extends DigiAssetEncoder {
    constructor() {
        super({
            allowAssetsInInputs:true,
            inputAddressesNeeded: true
        });
        this._outputs={};
        this._assetRules={};
        this._assetChangeAddresses={};
        this._royalties=0n;
        this._decodedTx=false;
        this._burns={};
    }

    /**
     * Erases the results of the build command
     */
    reset() {
        this._encoded=false;
        this._change={};
        this._royalties=0n;
        this._changes={};
        this._decodedTx=false;
    }

    /**
     * Adds multiple UTXOs to the object
     * @param {UTXO[]}  UTXOs
     * @returns {Promise<void>}
     */
    async addUTXOs(UTXOs) {
        this.reset();

        //let main function do its job
        await super.addUTXOs(UTXOs);

        //check for any addresses we can set as change
        for (let {assets,scriptPubKey} of UTXOs) {
            if (assets===undefined) continue;
            if ((scriptPubKey===undefined)||(scriptPubKey.addresses===undefined)||(scriptPubKey.addresses.length!==1)) continue;
            let address=scriptPubKey.addresses[0];
            for (let {assetId,cid} of assets) {
                let id=assetId;
                if (cid!==undefined) id+=":"+cid;   //none aggregable asset are split based on meta data
                if ((this._assetChangeAddresses[id]===undefined)&&(Object.values(this._assetChangeAddresses).indexOf(address)===-1)) {
                    this._assetChangeAddresses[id]=address;
                    break;  //need a new address so break out of this for loop
                }
            }
        }
    }

    async _newAsset(assetId) {
        //see if new asset to this transaction
        if (this._outputs[assetId]===undefined) {
            let rules=await lookup.getRules(assetId);
            if (rules===undefined) rules=[false];
            this._assetRules[assetId]=rules.pop();
            this._outputs[assetId]={};
        }
    }

    /**
     * Adds multiple outputs to the object
     * @param {string}          assetId
     * @param {Object<bigint>}  outputs
     */
    async addOutputs(assetId,outputs) {
        this.reset();

        //check we even have the asset
        assetId=assetId.split(":")[0];  //if sub type included remove it
        if (this._balances[assetId]===undefined) throw new ExpectedError("Don't have "+assetId+" to send");

        //see if new asset to this transaction
        await this._newAsset(assetId);

        //verify addresses are allowed to receive
        if ((this._assetRules[assetId]!==false)&&(this._assetRules[assetId].kyc!==undefined)) await rulesVerifier.verifyKYC(this._assetRules[assetId],Object.keys(outputs));

        //calculate how many we need
        let amountLeft=this.balanceAssets[assetId];
        for (let address in this._outputs[assetId]) amountLeft-=this._outputs[assetId][address];

        //add to outputs
        for (let address in outputs) {
            if (outputs[address]>amountLeft) throw new ExpectedError("Don't have enough "+assetId);
            if (this._outputs[assetId][address]===undefined) this._outputs[assetId][address]=0n;
            this._outputs[assetId][address]+=outputs[address];
            amountLeft-=outputs[address];
        }
    }

    /**
     * Adds an output to the object
     * @param {string}  assetId
     * @param {string}  address
     * @param {bigint}  balance
     */
    async addOutput(assetId, address,balance) {
        let outputs={};
        outputs[address]=balance;
        await this.addOutputs(assetId,outputs);
    }

    /**
     * Sets the change address for a specific assetId
     * Warning if you have 2 or more assets in a transaction it will fail if any 2 assets try to go to the same address
     * @param {string}  address
     * @param {string}  assetId
     * @returns {void}
     */
    setAssetChangeAddress(address,assetId=undefined) {
        if (assetId===undefined) {
            //set all(only safe if there is only 1 asset in tx and only works if utxos added first)
            for (let assetId in this._outputs) {
                this._assetChangeAddresses[assetId] = address;
            }
        } else {
            //set just the one
            this._assetChangeAddresses[assetId] = address;
        }
    }

    /**
     * Sets the transaction to burn a specific quantity
     * @param {string}  assetId
     * @param {bigint}  amount
     */
    async burnAsset(assetId,amount) {
        //see if new asset to this transaction
        await this._newAsset(assetId);

        //add burn
        if (this._burns[assetId]===undefined) this._burns[assetId]=0n;
        this._burns[assetId]+=amount;
    }

    /**
     * Builds the transaction
     * @returns {Promise<void>}
     */
    async build() {
        this.reset();

        //keep track of how many asset outputs there was(excluding change)
        let counts={};
        for (let assetId in this._outputs) {
            counts[assetId]=Math.max(1,Object.keys(this._outputs[assetId]).length);
        }

        //handle asset burns
        let amountAssetsLeft=this.balanceAssets;
        let burn=false;
        let burnCount={};
        for (let assetId in this._burns) {
            burn=true;
            amountAssetsLeft[assetId]-=this._burns[assetId]; //remove burns from list
            burnCount[assetId]=this._burns[assetId];
        }
        for (let assetId in this._assetRules) {
            let rule=this._assetRules[assetId];
            if (rule===false) continue;
            if (rule.deflate===undefined) continue;
            amountAssetsLeft[assetId]-=rule.deflate;
            if (burnCount[assetId]===undefined) burnCount[assetId]=0n;
            burn=true;
            burnCount[assetId]+=rule.deflate;
        }

        //clone outputs and add change outputs if applicable
        let assetOutputs={};
        for (let assetId in this._outputs) {
            assetOutputs[assetId]={};
            for (let address in this._outputs[assetId]) {
                assetOutputs[assetId][address]=this._outputs[assetId][address];
                amountAssetsLeft[assetId]-=this._outputs[assetId][address];
            }
            if (amountAssetsLeft[assetId]<0n) throw new ExpectedError("Not enough assets: short "+(0n-amountAssetsLeft[assetId]).toString()+" sat");
            if (amountAssetsLeft[assetId]>0n) {
                if (this._assetChangeAddresses[assetId]===undefined) throw new ExpectedError("Change left over for "+assetId+" and no change address defined");
                let address=this._assetChangeAddresses[assetId];
                if (assetOutputs[assetId][address]===undefined) assetOutputs[assetId][address]=0n;
                assetOutputs[assetId][address]+=amountAssetsLeft[assetId];
                this._change[assetId]=amountAssetsLeft[assetId];
            }
            delete amountAssetsLeft[assetId];
        }

        //if any input assets where all change
        for (let assetId in amountAssetsLeft) {
            if (this._assetChangeAddresses[assetId]===undefined) throw new ExpectedError("Change left over for "+assetId+" and no change address defined");
            let address=this._assetChangeAddresses[assetId];
            assetOutputs[assetId]={}
            assetOutputs[assetId][address]=amountAssetsLeft[assetId];
            this._change[assetId]=amountAssetsLeft[assetId];
        }

        //verify no 2 assets are being sent to the same address
        let assetIdsInTransaction=Object.keys(assetOutputs);
        if (assetIdsInTransaction.length===0) throw new ExpectedError("No assets being sent");
        if (assetIdsInTransaction.length>1) {   //if only 1 asset no need to check
            let addressesUsed=[];
            for (let assetId in assetOutputs) {
                for (let address in assetOutputs[assetId]) {
                    if (addressesUsed.indexOf(address)!==-1) throw new ExpectedError("Can't send more then 1 asset to "+address);
                    addressesUsed.push(address);
                }
            }
        }

        //create list of which addresses had assets and who now has them
        let assetHolderChanges={};
        for (let {scriptPubKey, assets} of this._utxos) {
            if (assets===undefined) continue;
            let address=scriptPubKey.addresses[0];
            for (let {assetId,amount} of assets) {
                if (assetHolderChanges[assetId]===undefined) assetHolderChanges[assetId]={};
                if (assetHolderChanges[assetId][address]===undefined) assetHolderChanges[assetId][address]=0n;
                assetHolderChanges[assetId][address]-=amount;
            }
        }
        for (let id in assetOutputs) {
            for (let address in assetOutputs[id]) {
                let assetId=id.split(":")[0];
                if (assetHolderChanges[assetId][address]===undefined) assetHolderChanges[assetId][address]=0n;
                assetHolderChanges[assetId][address]+=assetOutputs[id][address];
            }
        }

        /**
         * This for loop is redundant
         * Its here to create nice human readable errors if rules where not applied
         */
        for (let assetId in assetOutputs) {
            /** @type {AssetRules}*/let rule=this._assetRules[assetId];
            if (rule===false) continue;

            //make list of addresses that gained assets
            let outputAddresses=[];
            for (let address in assetHolderChanges[assetId]) {
                if (assetHolderChanges[assetId][address]>0n) {
                    // noinspection JSUnfilteredForInLoop
                    outputAddresses.push(address);
                }
            }

            //verify kyc rules
            //await rulesVerifier.verifyKYC(rule,outputAddresses); //checked when adding outputs

            //verify vote rules
            await rulesVerifier.verifyVote(rule,outputAddresses);

            //verify signers rules
            if (rule.signers!==undefined) {
                //get list of input addresses
                let inputAddresses=[];
                for (let i in this._utxos) {
                    await helpers.includeScriptPubKey(this._utxos[i]);                             //make sure we have the script pub key so we can lookup the address
                    if (this._utxos[i].scriptPubKey.addresses.length!==1) continue;        //don't use multisig addresses for auto selected change
                    let address=this._utxos[i].scriptPubKey.addresses[0];
                    if (inputAddresses.indexOf(address)===-1) inputAddresses.push(address);
                }

                //verify signers rule
                await rulesVerifier.verifySigners(rule,inputAddresses);
            }
        }
        /**
         * End redundant error checking
         */

            //get list of assetIds
        const assetIds=Object.keys(assetOutputs);

        //build outputs
        let amountLeft=this.balanceDigiByte;
        let data=new BitIO();
        if (burn) {
            data.appendHex("44410325");
        } else {
            data.appendHex("44410315");
        }

        //build tx outputs
        let txOutputs=[];
        if ((assetIds.length===1)&&(assetIds[0].substr(1,1)==="a")&&(!burn)) {
            //only 1 asset, aggregable, and not burning so try to minify output
            const assetId=assetIds[0];
            const outputs=assetOutputs[assetId];

            //order outputs from biggest to smallest
            let assetOutputOrder=[];
            for (let address in outputs) {
                // noinspection JSUnfilteredForInLoop
                assetOutputOrder.push({address,amount: BigInt(outputs[address])});
            }
            assetOutputOrder.sort((a,b)=>parseInt((b.amount-a.amount).toString()));

            //create asset outputs
            for (let {address} of assetOutputOrder) {
                amountLeft-=600n;
                txOutputs.push(outputPair(address,600n));   //creates an output for each address with 600 sats
            }

            //create asset count array(used to build the asset send instructions
            let assetCounts=[];
            for (let {amount} of assetOutputOrder) assetCounts.push(amount);

            //build transfer instructions
            while (assetCounts.length>0) {
                if (!helpers.compressLastOutputs(data,assetCounts)) {    //will compress if it can.
                    //last remaining output was not compressible so write it by itself
                    if (assetCounts.length>32) {

                        //index to high to encode direct need to encode as range
                        let rangeAmount=assetCounts[assetCounts.length-1];
                        data.appendInt(2,3);                            //skip=false,range=true,percent=false
                        data.appendInt(assetCounts.length-1,13);     //current output
                        data.appendFixedPrecision(rangeAmount);                 //record amount
                        for (let i in assetCounts) {
                            // noinspection JSUnfilteredForInLoop
                            assetCounts[i]-=rangeAmount;                        //reduce remaining amounts
                        }

                    } else {
                        //encode direct
                        data.appendInt(0,3);                            //skip=false,range=false,percent=false
                        data.appendInt(assetCounts.length-1,5);     //current output
                        data.appendFixedPrecision(assetCounts[assetCounts.length-1]);

                    }
                    assetCounts.pop()   //remove last item
                }
            }

        } else {
            //more then 1 asset, not aggregable, or trying to burn

            //go through each inputs and make an array of sources in order
            /** @type {AssetCount[]}*/let assetInputs=[];
            for (let utxo of this._utxos) {
                if (utxo.assets===undefined) continue;
                for (let {assetId,amount,decimals,cid,rules} of utxo.assets) {
                    let lastIndex=assetInputs.length-1;
                    if (
                        (lastIndex<0)||                                   //if first element
                        (assetInputs[lastIndex].assetId!==assetId)||      //if asset id not same as last
                        (assetId.substr(1,1)!=='a')           //if not aggregable
                    ) {
                        assetInputs.push({assetId,amount,decimals,cid,rules});//add asset to list
                    } else {
                        assetInputs[lastIndex].amount+=amount;           //add amount to last input since compatible
                    }
                }
            }

            //create outputs and list of remaining assets needing to be sent
            /** @type {Object<int>}*/let outputAddresses={};
            /** @type {Object<{address:string,amount:BigInt}[]>}*/let outputAssets={};
            for (let assetId in assetOutputs) {
                for (let address in assetOutputs[assetId]) {

                    //if address not already in a output add to one
                    if (outputAddresses[address]===undefined) {
                        outputAddresses[address]=txOutputs.length;  //record address index for easy refrence
                        amountLeft-=600n;
                        txOutputs.push(outputPair(address,600n));   //creates an output for each address with 600 sats
                    }

                    //add asset to list needed
                    if (outputAssets[assetId]===undefined) outputAssets[assetId]=[];
                    outputAssets[assetId].push({address,amount: assetOutputs[assetId][address]});
                }
            }

            //add burns to output list if any
            for (let assetId in burnCount) {
                if (outputAssets[assetId]===undefined) outputAssets[assetId]=[];
                outputAssets[assetId].push({address:false,amount: burnCount[assetId]});
            }

            //create instructions
            let currentInput={amount:0n};                                       //create fake first input with nothing in it
            while ((assetInputs.length>0)||(currentInput.amount>0n)) {          //while still inputs keep going
                if (currentInput.amount===0n) currentInput=assetInputs.shift(); //if there is nothing left in input get next one
                let currentOutput=outputAssets[currentInput.assetId][0];        //gets the current output we are trying to fulfill
                let amountToTransfer=helpers.MathBigMin(currentInput.amount,currentOutput.amount);    //we can only move the smaller of the current input or amount needed
                data.appendInt(0,3);                                //skip=false,range=false,percent=false
                data.appendInt((currentOutput.address===false)?31:outputAddresses[currentOutput.address],5); //current output
                data.appendFixedPrecision(amountToTransfer);                    //amount to send
                currentInput.amount-=amountToTransfer;                          //update amount left
                currentOutput.amount-=amountToTransfer;                         //update amount left to send
                if (currentOutput.amount===0n) outputAssets[currentInput.assetId].shift();//if all sent remove the entry from outputs
            }
        }

        //add encoded data
        let hexData=data.toBuffer().toString('hex');
        if (hexData.length>constants.maxOpReturnBytes*2) throw new ExpectedError("Output encoding to large");
        txOutputs.push({"data":hexData});

        //check if any royalties need to be sent
        for (let assetId in assetOutputs) {
            if (this._assetRules[assetId]===false) continue;
            let royalties=await rulesVerifier.verifyRoyalties(this._assetRules[assetId],txOutputs,counts[assetId],true);
            this._royalties+=royalties;
            amountLeft-=royalties;
        }

        //remove fees
        amountLeft-=BigInt(hexData.length/2);  //size of encoded data
        amountLeft-=180n*BigInt(this._utxos.length);  //size of inputs and sigs
        amountLeft-=34n*BigInt(txOutputs.length);//size of outputs
        amountLeft-=100n;               //headers, and buffer
        if (amountLeft<0n) throw new ExpectedError("Not enough funds to create asset: short "+(0n-amountLeft).toString()+" sat");

        //add any change and extra output transactions
        this._addFinalOutputs(txOutputs,amountLeft);

        //create the output tx
        let tx={
            txid: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", //fake value
            height:await lookup.getHeight(this._height),
            time: Math.round((new Date()).getTime() / 1000),
            vin:  this._utxos,
            vout: []
        };
        for (let vout in txOutputs) {
            let address=Object.keys(txOutputs[vout])[0];
            let output={
                value:  0n,
                vout:   parseInt(vout),
                scriptPubKey: {}
            };
            if (address==="data") {
                let temp=new BitIO();
                temp.appendBitcoin("OP_RETURN");
                let temp2=Buffer.from(txOutputs[vout][address],'hex');
                temp.appendBitcoin(temp2);
                output.scriptPubKey.hex=temp.toBuffer().toString('hex');
            } else {
                output.value=BigInt(Math.round(parseFloat(txOutputs[vout][address])*100000000));
                output.scriptPubKey.addresses= [address];
            }
            tx.vout.push(output);
        }
        this._changes=await decoder(tx);
        if (this._changes.type==="Accidental Burn") throw new ExpectedError("Unknown Error Creating Transaction");
        this._decodedTx=tx;

        this._encoded=JSON.stringify(txOutputs);
    }

    /**
     * Returns the royalties paid in the transaction
     * @returns {bigint}
     */
    get royalties() {
        if (typeof this._encoded!=="string") throw new ExpectedError("Transaction not yet built");
        return this._royalties;
    }

    get decodedTx() {
        if (typeof this._encoded!=="string") throw new ExpectedError("Transaction not yet built");
        return this._decodedTx;
    }

    get changes() {
        if (typeof this._encoded!=="string") throw new ExpectedError("Transaction not yet built");
        return this._changes;
    }
}
module.exports=DigiAssetTransferor;