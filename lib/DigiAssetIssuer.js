const DigiAssetEncoder=require('./DigiAssetEncoder');
const lookup = require("digiasset-lookup");
const outputPair = require("outputpair");
const BitIO = require("bit-io");
const v3constants = require("digiasset_v3_constants");
const rulesVerifier = require("./rules_verify");
const constants = require("./constants");
const helpers = require("./helpers");
const crypto = require("crypto");
const base58check = require("base58check");
const ipfs = require("ipfs-simple");

class DigiAssetIssuer extends DigiAssetEncoder {
    /**
     * @param {{
     *         divisibility:    int,
     *         locked:          boolean,
     *         aggregation:     "aggregatable"|"hybrid"|"dispersed",
     *         rules:           AssetRules|boolean
     *     }}   options
     * @param {{
     *         assetName:   string,
     *         issuer:      string,
     *         description: string,
     *         urls:        Url[],
     *         site:        {
     *             url:         string,
     *             type:        "web"
     *         },
     *     }}   metadata
     */
    constructor(metadata,options) {
        super({
            allowAssetsInInputs:false,
            inputAddressesNeeded:false
        });
        this._outputs={};
        this._newAssets=0n;
        this._metadata=JSON.stringify(metadata);    //keep as string to prevent links
        this._divisibility=options.divisibility||0;
        this._locked=!(options.locked===false);     //always true unless explicitly set false
        this._aggregation={aggregatable:0,hybrid:1,dispersed:2}[options.aggregation||"aggregatable"];
        this._rules=options.rules||false;
        this._permanentProviders={dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x:true};
    }

    /**
     * Erases the results of the build command
     */
    reset() {
        this._encoded=false;
        this._assetId=undefined;
        this._cid=undefined;
        this._sha256Hash=undefined;
        this._change={};
    }

    /**
     * Adds multiple outputs to the object
     * @param {Object<bigint>}  outputs
     */
    async addOutputs(outputs) {
        this.reset();
        //verify addresses are allowed to receive
        if ((typeof this._rules==="object")&&(this._rules.kyc!==undefined)) {
            await rulesVerifier.verifyKYC(this._rules,Object.keys(outputs));
        }
        for (let address in outputs) {
            if (this._outputs[address]===undefined) {
                this._outputs[address]=0n;
            }
            this._outputs[address]+=outputs[address];
            this._newAssets+=outputs[address];
        }
    }

    /**
     * Adds an output to the object
     * @param {string}  address
     * @param {bigint}  balance
     */
    async addOutput(address,balance) {
        let outputs={};
        outputs[address]=balance;
        await this.addOutputs(outputs);
    }

    /**
     * Adds a permanent provider to asset creation
     * If value is set to true then $1.20/MB will be used
     * @param {string}          address
     * @param {Number,boolean}   satsPerByte
     */
    addPermanentProvider(address,satsPerByte) {
        this.reset();
        this._permanentProviders[address]=satsPerByte
    }

    /**
     * Clears all permanent providers
     */
    clearPermanentProviders() {
        this.reset();
        this._permanentProviders={};
    }

    /**
     * Builds the transaction
     * @returns {Promise<void>}
     */
    async build() {
        this.reset();

        //get permanentProviders or use default if none set
        let permanentProviders={};
        let defaultSatPerByte;
        for (let address in this._permanentProviders) {
            if ((defaultSatPerByte===undefined)&&(this._permanentProviders[address]===true)) defaultSatPerByte=0.0000012*(await lookup.getLatestExchangeRates()).USD[0];
            permanentProviders[address]=(this._permanentProviders[address]===true)?defaultSatPerByte:this._permanentProviders[address];
        }

        //order outputs from biggest to smallest
        let assetOutputOrder=[];
        for (let address in this._outputs) {
            assetOutputOrder.push({address,amount: this._outputs[address]});
        }
        assetOutputOrder.sort((a,b)=>parseInt((b.amount-a.amount).toString()));

        //create asset outputs
        let amountLeft=this.balanceDigiByte;
        let txOutputs=[];
        for (let {address} of assetOutputOrder) {
            amountLeft-=600n;
            txOutputs.push(outputPair(address,600n));   //creates an output for each address with 600 sats
        }

        //create asset count array(used to build the asset send instructions
        let assetCounts=[];
        for (let {amount} of assetOutputOrder) assetCounts.push(amount);








        //start creating the data that will be stored on ipfs
        // noinspection JSValidateTypes
        let ipfsData = {data: JSON.parse(this._metadata)};







        //compute hex rules data
        let rulesBinary=new BitIO();
        if (this._rules!==false) {
            //verify only valid rules where used
            let allowedRules=['rewritable','signers','royalties','kyc','vote','expires','currency','deflate'];
            let usedRules=Object.keys(this._rules);
            for (let rule of usedRules) {
                if (!allowedRules.includes(rule)) throw "Invalid Rule Detected";
            }





            if (this._rules.signers!==undefined) {
                /*
                    1 hex nibble of 0 showing it is signers rule
                    1 to 7 bytes - fixed precision encoded required weights to be valid
                    2 to 12 bytes per signer(or group of signers):
                    1 byte ending equal to 0x00(only if no range.  There will only ever be 1 range so that is end if present)
    
                    per rule:
                    if first bit is 0 then it is an asset address
                        1-4 bytes: fixed precision output number+1      (+1) so first byte is never 0x00
                        1-7 bytes: fixed precision weight
    
    
                    if first bit is 1 then it is a range of outputs that are non asset outputs
                        //pretend first bit is 0
                        1-4 bytes: fixed precision start output number
                        1-7 bytes: fixed precision number of outputs included
                        weight is value sent to the output-600 sats
                 */
                rulesBinary.appendHex("0");
                let required = BigInt(this._rules.signers.required || 1);
                rulesBinary.appendFixedPrecision(required);

                //check required is less then sum of all weights
                let listLeft = {};
                let found = 0n;
                for (let address in this._rules.signers.list) {
                    listLeft[address] = BigInt(this._rules.signers.list[address]);  //copy and make sure value is a BigInt
                    if (listLeft[address] <= 0) throw "Invalid Rule Detected: Invalid weight";
                    found += listLeft[address];
                }
                if (found < required) throw "Invalid Rule Detected: Not enough signers to reach required weight";

                //find any signer addresses already in output list
                for (/** @type{int}*/let index in txOutputs) {
                    let address = Object.keys(txOutputs[index])[0];
                    if (listLeft[address] !== undefined) {
                        rulesBinary.appendFixedPrecision(index + 1);
                        rulesBinary.appendFixedPrecision(listLeft[address]);
                        delete listLeft[address];
                    }
                }

                //add all remaining signers
                let remainingSigners = Object.keys(listLeft).length;
                if (remainingSigners > 0) {
                    let tempBitStream = new BitIO();
                    tempBitStream.appendFixedPrecision(txOutputs.length);   //next output to be added
                    tempBitStream.appendFixedPrecision(remainingSigners);   //number of outputs
                    for (let address in listLeft) {
                        let weight = listLeft[address];
                        let balance = 600n + weight;                            //encode weight in output balance
                        txOutputs.push(outputPair(address, balance));
                        amountLeft -= (600n + weight);
                    }
                    let tempBuffer = tempBitStream.toBuffer();                //convert temp to Buffer
                    tempBuffer[0] += 128;                                     //set first bit to a 1
                    rulesBinary.appendBuffer(tempBuffer);                   //write to bitstream
                } else {
                    rulesBinary.appendInt(0, 8);                 //all signers where part of output
                }
            }


            if (this._rules.royalties!==undefined) {
                /*
                    Royalties can not be set to any address already used as an output
    
                    1 hex nibble of 1 showing it is royalties rule
                    1-7 bytes: fixed precision output number start
                    1-7 bytes: fixed precision number of outputs included
                    cost is value sent to the output(can not be less then 600sats)
    
                    Exchange rate royalties:
                    1 hex nibble of 9 showing it is exchange rate royalties rule
                    1-4 bytes: if first bit is 1 then it is 1 byte value showing standard exchange rate index number
                               if first bit is 0 then fixed precision output number of exchange rate address and index is value sent to it -600
    
    
                    1-7 bytes: fixed precision output number start
                    1-7 bytes: fixed precision number of outputs included
                    cost is value sent to the output(can not be less then 600sats) value is with 8 decimals so if CAD $1 would be 100000000 sat
    
                 */
                //see if any royalty addresses are already in output list
                for (/** @type{int}*/let index in txOutputs) {
                    let address = Object.keys(txOutputs[index])[0];
                    if (this._rules.royalties[address] !== undefined) throw "Invalid Rule Detected: royalty addresses can not be sent assets or used as signer addresses";
                }

                //create rule data
                rulesBinary.appendHex((this._rules.currency===undefined)?"1":"9");
                if (this._rules.currency!==undefined) {
                    if (typeof this._rules.currency==="string") {
                        //standard exchange used
                        let i;
                        for (let index in v3constants.exchangeRate) {
                            if (v3constants.exchangeRate[index].name===this._rules.currency) {
                                i=parseInt(index);
                                break;
                            }
                        }
                        if (i===undefined) throw "Invalid Rule Detected: invalid exchange rate option";

                        //record in binary
                        i+=128; //set first bit to 1
                        rulesBinary.appendInt(i,8);

                    } else {
                        //non standard exchange used
                        if (
                            (typeof this._rules.currency!=="object")||
                            (typeof this._rules.currency.address!=="string")||
                            (typeof this._rules.currency.name!=="string")||
                            (!Number.isInteger(this._rules.currency.index))||
                            (this._rules.currency.index<0)||
                            (this._rules.currency.index>9)
                        ) throw "Invalid Rule Detected: invalid exchange rate option";
                        rulesBinary.appendFixedPrecision(txOutputs.length);   //next output to be added
                        txOutputs.push(outputPair(this._rules.currency.address, 600+this._rules.currency.index));
                    }
                }
                rulesBinary.appendFixedPrecision(txOutputs.length);   //next output to be added
                rulesBinary.appendFixedPrecision(Object.keys(this._rules.royalties).length);   //number of outputs
                for (let address in this._rules.royalties) {
                    let balance = BigInt(this._rules.royalties[address]);                            //encode weight in output balance
                    txOutputs.push(outputPair(address, balance));
                    amountLeft -= balance;
                }
            }




            if (this._rules.kyc!==undefined) {
                /*
                    KYC restricts what countries an asset can be sent to
    
                    1 hex nibble of 2 showing it is a kyc rule
                    2 bytes per country code(0xf9ff is used to mark end - ...)
    
                 */

                //kyc rules must be obeyed on issuance(already checked when adding outputs)

                //true is the same as ban no country
                if (this._rules.kyc===true) {
                    this._rules.kyc={ban:[]};
                }

                //make sure both allow and ban are not both used
                if ((this._rules.kyc.allow!==undefined)&&(this._rules.kyc.ban!==undefined)) throw "Invalid Rule Detected: can't use both allow and ban";
                let list=this._rules.kyc.allow||this._rules.kyc.ban;
                rulesBinary.appendHex((this._rules.kyc.allow!==undefined)?"2":"3");   //allow:ban
                try {
                    for (let country of list) {
                        if (country.length!==3) throw "Invalid Rule Detected: invalid country code";
                        rulesBinary.append3B40(country.toLowerCase());
                    }
                } catch (_) {
                    throw "Invalid Rule Detected: invalid country code";
                }
                rulesBinary.append3B40("...");

            }



            if ((this._rules.vote!==undefined)||(this._rules.expires!==undefined)) {
                /*
                    Vote rules allow restricting sending to only specific addresses,
                    naming these addresses, and the streaming service will keep track of the vote talies
    
                    1 hex nibble of 4 showing it is a vote rule
                    1 bit marking if movable
                    7 bit number of vote options
                    1-7 byte fixed precision cutoff.  0 means no cutoff
                    1-7 byte fixed precision output position start+1.
                        value of 0 means use standard address list
    
                 */
                //expires is really vote with no options so can't do both
                if (this._rules.rewritable===true) throw "Invalid Rule Detected: Votes can not be part of rewritable rule asset";
                if ((this._rules.vote!==undefined)&&(this._rules.expires!==undefined)) throw "Invalid Rule Detected: can't use both vote and expires";
                if (this._rules.expires!==undefined) {
                    // noinspection JSValidateTypes
                    this._rules.vote={options: [],movable: true,cutoff:this._rules.expires};
                }

                //quick check on vote length
                let voteCount=Object.keys(this._rules.vote.options).length;
                if (voteCount>127) throw "Invalid Rule Detected: To many vote options";

                //record rule header
                rulesBinary.appendHex("4");                                         //header
                rulesBinary.appendBits(this._rules.vote.movable ? "1" : "0");         //movable
                rulesBinary.appendInt(voteCount,7);       //length
                rulesBinary.appendFixedPrecision(this._rules.vote.cutoff || 0);       //cutoff

                if ((this._rules.vote.options.length===0)||(typeof this._rules.vote.options[0]=="string")) {
                    if (voteCount>constants.voteAddresses.length) throw "Invalid Rule Detected: To many vote options";

                    //convert format to standard for purpose of ipfs data
                    for (let index in this._rules.vote.options) {
                        if (typeof this._rules.vote.options[index]!="string") throw "Invalid Rule Detected: Can't mix vote option types";
                        this._rules.vote.options[index]={address:constants.voteAddresses[index],label:this._rules.vote.options[index]};
                    }

                    //handle defaults addresses.  Recommended because vote counts are auto counted and garbage collections is auto handled
                    rulesBinary.appendFixedPrecision(0);

                } else {

                    //see if any addresses are already in output list
                    for (/** @type{int}*/let index in txOutputs) {
                        let address = Object.keys(txOutputs[index])[0];
                        if (this._rules.vote.options[address] !== undefined) throw "Invalid Rule Detected: royalty addresses can not be sent assets or used as signer addresses";
                    }

                    //record rule
                    rulesBinary.appendFixedPrecision(txOutputs.length+1);

                    //add outputs
                    for (let index in this._rules.vote.options) {                          //encode weight in output balance
                        if (typeof this._rules.vote.options[index]=="string") throw "Invalid Rule Detected: Can't mix vote option types";
                        if (typeof this._rules.vote.options[index].label!=="string") throw "Invalid Rule Detected: Vote option label must be a string";

                        txOutputs.push(outputPair(this._rules.vote.options[index].address, 600n));
                        amountLeft -= 600n;
                    }
                }

                //add votes to ipfs data
                ipfsData.votes=this._rules.vote.options;
            }

            if (this._rules.deflate!==undefined) {
                /*
                    deflate if set requires a specific number be burned per transaction.  Value is in sats
    
                    1 hex nibble of 5 showing it is deflationary
                    1-7 byte number of sats that need to be burned
    
                 */
                if (this._aggregation!==0) throw "Invalid Rule Detected: Deflationary assets must be aggregable";
                if (BigInt(this._rules.deflate)<=0n) throw "Invalid Rule Detected: Deflation amount must be positive number";
                rulesBinary.appendHex("5");
                rulesBinary.appendFixedPrecision(this._rules.deflate);
            }



            //finish rules
            if (rulesBinary.length===0) throw "Invalid Rule Detected: set to false if not using rules";
            rulesBinary.appendHex("f");
            while (rulesBinary.length%8!==0) rulesBinary.appendBits("1");

            //quick check before we start doing anything asynchronous
            if (amountLeft<0n) throw "Not enough funds: short "+(0n-amountLeft).toString()+" sat";
        }

        //compute issuance flags
        const issuanceFlags=(this._divisibility<<5)|(this._locked?16:0)|(this._aggregation<<2);

        //get data that should be hashed to compute the DigiID
        let hashData;
        if (this._locked) {
            hashData=this._utxos[0].txid+":"+this._utxos[0].vout;
        } else {
            await helpers.includeScriptPubKey(this._utxos[0]);
            hashData = Buffer.from(this._utxos[0].scriptPubKey.hex,'hex');
        }

        //compute assetId
        const header = (['2e37', '2e6b', '2e4e', false, '20ce', '2102', '20e4', false])[(issuanceFlags & 0x1c) >>> 2];   //gets the assetId header based on lock status and aggregation
        const hash256 = crypto.createHash('sha256').update(hashData).digest();                      //do sha256
        const hash160 = crypto.createHash('ripemd160').update(hash256).digest('hex');       //do ripemd160
        ipfsData.data.assetId = base58check.encode(hash160 + '000' + this._divisibility, header, 'hex');              //convert to base58, add header and security check

        //add data to ipfs
        const cid=await ipfs.addRawJSON(ipfsData);

        //get ipfs data size
        let referencedCids=[cid];
        helpers.findAllCids(ipfsData,referencedCids);
        /** @type {int} */let ipfsSize=0;
        for (let refCid of referencedCids) {
            let size=await ipfs.getSize(refCid)
            ipfsSize+=size;
        }

        //start creating op_return data
        let data=new BitIO();
        data.appendHex('444103');                     //header, version
        if (this._rules===false) {
            data.appendHex('01');
        } else {
            data.appendHex((this._rules.rewritable===true)?'03':'04');    //opcode 1 for normal, 3/4 for rules
        }
        const sha256Hash=ipfs.cidToHash(cid)
        data.appendHex(sha256Hash);                        //sha256 of ipfs data
        data.appendFixedPrecision(this._newAssets);      //amount to create
        if (this._rules!==false) data.appendBuffer(rulesBinary.toBuffer());      //appends the rules if any

        //create output commands
        if (this._aggregation===0) {
            //for aggregatable try to compress using range
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
            //range not allowed so direct encode all
            if (assetCounts.length>32) throw "Asset can not be encoded to many outputs";
            for (let i in assetCounts) {
                data.appendInt(0,3);                            //skip=false,range=false,percent=false
                // noinspection JSCheckFunctionSignatures
                data.appendInt(i,5);     //current output
                data.appendFixedPrecision(assetCounts[i]);
            }
        }

        //add issuance flags to the end
        data.appendInt(issuanceFlags,8);

        //Add encoded data to outputs
        if (data.length/8>constants.maxOpReturnBytes) throw "Asset can not be encoded to many outputs";
        const dataBuffer=data.toBuffer();
        txOutputs.push({data:dataBuffer.toString('hex')});

        //pay ipfs nodes
        for (let address in permanentProviders) {
            let amountToPay=BigInt(Math.ceil(permanentProviders[address]*ipfsSize+10));    //add 10 sat just in case of rounding errors
            if (amountToPay<constants.nodeDust) amountToPay=constants.nodeDust;                   //make sure it is at least as big as dust
            txOutputs.push(outputPair(address,amountToPay));
            amountLeft-=amountToPay;
        }

        //remove tx fee at 1sat/byte
        amountLeft-=BigInt(dataBuffer.length);  //size of encoded data
        amountLeft-=180n*BigInt(this._utxos.length);  //size of inputs and sigs
        amountLeft-=34n*BigInt(txOutputs.length);//size of outputs
        amountLeft-=100n;               //headers, and buffer
        if (amountLeft<0n) throw "Not enough funds: short "+(0n-amountLeft).toString()+" sat";

        //save values
        this._encoded=this._addFinalOutputs(txOutputs,amountLeft);  //handles change and extra outputs
        this._assetId=ipfsData.data.assetId;
        this._sha256Hash=sha256Hash;
        this._cid=cid;
    }

    /**
     * Returns the created assetId
     * build must be run first
     * @returns {string}
     */
    get assetId() {
        if (typeof this._encoded!=="string") throw "Transaction not yet built";
        return this._assetId;
    }

    /**
     * Returns the IPFS cid for the meta data
     * build must be run first
     * @returns {string}
     */
    get cid() {
        if (typeof this._encoded!=="string") throw "Transaction not yet built";
        return this._cid;
    }

    /**
     * Returns the sha256 hash for the meta data
     * build must be run first
     * @returns {string}
     */
    get sha256Hash() {
        if (typeof this._encoded!=="string") throw "Transaction not yet built";
        return this._sha256Hash;
    }

    /**
     * Returns the amount of DigiByte that was left over
     * build must be run first
     * @returns {bigint}
     */
    get change() {
        if (typeof this._encoded!=="string") throw "Transaction not yet built";
        return this._change.DigiByte||0n;
    }

}
module.exports=DigiAssetIssuer;