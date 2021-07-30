// noinspection  JSUnfilteredForInLoop

const helpers=require('./helpers');
const lookup=require('digiasset-lookup');
const ipfs=require('ipfs-simple');
const outputPair=require('outputpair');
const BitIO=require('bit-io');
const rulesVerifier=require('./rules_verify');
const base58check=require('base58check');
const constants=require('./constants');
const crypto=require('crypto');
const v3constants=require('digiasset_v3_constants');

/**
 * Returns inputs and outputs in the format expected by core wallet
 *
 * outputs is where to send assets to.  keys should be DigiByte addresses, value is in sats.
 *      if divisibility is set to 2 and value is 20 then 0.2 will be sent
 * options.divisibility is number of decimals 0 to 7
 * options.changeAddress is address to send any change to if there is any. if not provided will go to first utxos address
 * options.nodes is objects.  Keys are ipfs node addresses to pay, value is number of sats/byte to pay(float)
 *      by default sends $0.000000012 USD/byte to digiassetX to pin.  set to {} to self host
 * rules.signers.list   keys are DigiByte addresses value is weight which must be int between 1 and 128
 * rules.royalties      keys are DigiByte addresses value is number of satoshis that need to be sent
 * rules.kyc            if true then assets can only be sent to kyced addresses
 *                      alternatively can be an object with either allow or ban key which is a list of country codes(ISO Alpha 3).
 *                      To KYC an address use the tool at https://digiassetx.com/kyc-address/
 * if asset is to be KYC verified the first utxo should come from a KYC verified address.
 *                      If address is public KYC then the name will be included with the meta data.
 *                      if secret then only the kyc address will be included
 *
 * @param {UTXO[]}      utxos
 * @param {Object<int|BigInt>}      outputs
 * @param {{
 *         divisibility:    int,
 *         locked:          boolean,
 *         aggregation:     "aggregatable"|"hybrid"|"dispersed",
 *         changeAddress:   string,
 *         nodes:           Object<Number>,
 *         rules:           AssetRules|boolean
 *     }}   options
 * @param {{
 *         assetName:   string,
 *         issuer:      string,
 *         description: string,
 *         urls:        Url[],
 *         userData:    {
 *             meta:    Meta[]
 *         }
 *     }}   metadata
 * @return {Promise<{
 *     inputs:  {txid:string,vout:int}[],
 *     outputs: {}[],
 *     metadata: string,
 *     assetId: string
 * }>}
 */
module.exports=async(utxos,outputs,metadata,options)=> {
    //set defaults if not provided
    const divisibility=options.divisibility||0;
    const locked=!(options.locked===false);     //always true unless explicitly set false
    const aggregation={aggregatable:0,hybrid:1,dispersed:2}[options.aggregation||"aggregatable"];
    const nodes=(options.nodes===undefined)?{dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x:0.000000012*(await lookup.getLatestExchangeRates()).USD[0]}:options.nodes;
    //change address at end in case not needed
    const rules=options.rules||false;



    //compute amount of funds we have
    let amountLeft=0n;
    for (let i in utxos) {
        if (utxos[i].value===undefined) {
            utxos[i]=await lookup.getUTXO(utxos[i].txid, utxos[i].vout);
        }
        utxos[i].value=BigInt(utxos[i].value);
        amountLeft+=utxos[i].value;
    }

    //compute amount to be created
    let amountToCreate = 0n;
    for (let address in outputs) {
        amountToCreate += BigInt(outputs[address]);
    }

    //order outputs from biggest to smallest
    let assetOutputOrder=[];
    for (let address in outputs) {
        assetOutputOrder.push({address,amount: BigInt(outputs[address])});
    }
    assetOutputOrder.sort((a,b)=>parseInt(b.amount-a.amount));

    //create asset outputs
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
    let ipfsData = {data: metadata};







    //compute hex rules data
    let rulesBinary=new BitIO();
    if (rules!==false) {
        //verify only valid rules where used
        let allowedRules=['rewritable','signers','royalties','kyc','vote','expires','currency','deflate'];
        let usedRules=Object.keys(rules);
        for (let rule of usedRules) {
            if (!allowedRules.includes(rule)) throw "Invalid Rule Detected";
        }





        if (rules.signers!==undefined) {
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
            let required = BigInt(rules.signers.required || 1);
            rulesBinary.appendFixedPrecision(required);

            //check required is less then sum of all weights
            let listLeft = {};
            let found = 0n;
            for (let address in rules.signers.list) {
                listLeft[address] = BigInt(rules.signers.list[address]);  //copy and make sure value is a BigInt
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


        if (rules.royalties!==undefined) {
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
                if (rules.royalties[address] !== undefined) throw "Invalid Rule Detected: royalty addresses can not be sent assets or used as signer addresses";
            }

            //create rule data
            rulesBinary.appendHex((rules.currency===undefined)?"1":"9");
            if (rules.currency!==undefined) {
                if (typeof rules.currency==="string") {
                    //standard exchange used
                    let i;
                    for (let index in v3constants.exchangeRate) {
                        if (v3constants.exchangeRate[index].name===rules.currency) {
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
                        (typeof rules.currency!=="object")||
                        (typeof rules.currency.address!=="string")||
                        (typeof rules.currency.name!=="string")||
                        (!Number.isInteger(rules.currency.index))||
                        (rules.currency.index<0)||
                        (rules.currency.index>9)
                    ) throw "Invalid Rule Detected: invalid exchange rate option";
                    rulesBinary.appendFixedPrecision(txOutputs.length);   //next output to be added
                    txOutputs.push(outputPair(rules.currency.address, 600+rules.currency.index));
                }
            }
            rulesBinary.appendFixedPrecision(txOutputs.length);   //next output to be added
            rulesBinary.appendFixedPrecision(Object.keys(rules.royalties).length);   //number of outputs
            for (let address in rules.royalties) {
                let balance = BigInt(rules.royalties[address]);                            //encode weight in output balance
                txOutputs.push(outputPair(address, balance));
                amountLeft -= balance;
            }
        }




        if (rules.kyc!==undefined) {
            /*
                KYC restricts what countries an asset can be sent to

                1 hex nibble of 2 showing it is a kyc rule
                2 bytes per country code(0xf9ff is used to mark end - ...)

             */

            //kyc rules must be obeyed on issuance
            await rulesVerifier.verifyKYC(rules,Object.keys(outputs));

            //true is the same as ban no country
            if (rules.kyc===true) {
                rules.kyc={ban:[]};
            }

            //make sure both allow and ban are not both used
            if ((rules.kyc.allow!==undefined)&&(rules.kyc.ban!==undefined)) throw "Invalid Rule Detected: can't use both allow and ban";
            let list=rules.kyc.allow||rules.kyc.ban;
            rulesBinary.appendHex((rules.kyc.allow!==undefined)?"2":"3");   //allow:ban
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



        if ((rules.vote!==undefined)||(rules.expires!==undefined)) {
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
            if (rules.rewritable===true) throw "Invalid Rule Detected: Votes can not be part of rewritable rule asset";
            if ((rules.vote!==undefined)&&(rules.expires!==undefined)) throw "Invalid Rule Detected: can't use both vote and expires";
            if (rules.expires!==undefined) {
                // noinspection JSValidateTypes
                rules.vote={options: [],movable: true,cutoff:rules.expires};
            }

            //quick check on vote length
            let voteCount=Object.keys(rules.vote.options).length;
            if (voteCount>127) throw "Invalid Rule Detected: To many vote options";

            //record rule header
            rulesBinary.appendHex("4");                                         //header
            rulesBinary.appendBits(rules.vote.movable ? "1" : "0");         //movable
            rulesBinary.appendInt(voteCount,7);       //length
            rulesBinary.appendFixedPrecision(rules.vote.cutoff || 0);       //cutoff

            if ((rules.vote.options.length===0)||(typeof rules.vote.options[0]=="string")) {
                if (voteCount>constants.voteAddresses.length) throw "Invalid Rule Detected: To many vote options";

                //convert format to standard for purpose of ipfs data
                for (let index in rules.vote.options) {
                    if (typeof rules.vote.options[index]!="string") throw "Invalid Rule Detected: Can't mix vote option types";
                    rules.vote.options[index]={address:constants.voteAddresses[index],label:rules.vote.options[index]};
                }

                //handle defaults addresses.  Recommended because vote counts are auto counted and garbage collections is auto handled
                rulesBinary.appendFixedPrecision(0);

            } else {

                //see if any addresses are already in output list
                for (/** @type{int}*/let index in txOutputs) {
                    let address = Object.keys(txOutputs[index])[0];
                    if (rules.vote.options[address] !== undefined) throw "Invalid Rule Detected: royalty addresses can not be sent assets or used as signer addresses";
                }

                //record rule
                rulesBinary.appendFixedPrecision(txOutputs.length+1);

                //add outputs
                for (let index in rules.vote.options) {                          //encode weight in output balance
                    if (typeof rules.vote.options[index]=="string") throw "Invalid Rule Detected: Can't mix vote option types";
                    if (typeof rules.vote.options[index].label!=="string") throw "Invalid Rule Detected: Vote option label must be a string";

                    txOutputs.push(outputPair(rules.vote.options[index].address, 600n));
                    amountLeft -= 600n;
                }
            }

            //add votes to ipfs data
            ipfsData.votes=rules.vote.options;
        }

        if (rules.deflate!==undefined) {
            /*
                deflate if set requires a specific number be burned per transaction.  Value is in sats

                1 hex nibble of 5 showing it is deflationary
                1-7 byte number of sats that need to be burned

             */
            if (aggregation!==0) throw "Invalid Rule Detected: Deflationary assets must be aggregable";
            if (BigInt(rules.deflate)<=0n) throw "Invalid Rule Detected: Deflation amount must be positive number";
            rulesBinary.appendHex("5");
            rulesBinary.appendFixedPrecision(rules.deflate);
        }



        //finish rules
        if (rulesBinary.length===0) throw "Invalid Rule Detected: set to false if not using rules";
        rulesBinary.appendHex("f");
        while (rulesBinary.length%8!==0) rulesBinary.appendBits("1");

        //quick check before we start doing anything asynchronous
        if (amountLeft<0n) throw "Not enough funds to create asset: short "+(0n-amountLeft).toString()+" sat";
    }

    //compute issuance flags
    const issuanceFlags=(divisibility<<5)|(locked?16:0)|(aggregation<<2);

    //get data that should be hashed to compute the DigiID
    let hashData;
    if (locked) {
        hashData=utxos[0].txid+":"+utxos[0].vout;
    } else {
        await helpers.includeScriptPubKey(utxos[0]);
        hashData = Buffer.from(utxos[0].scriptPubKey.hex,'hex');
    }

    //compute assetId
    const header = (['2e37', '2e6b', '2e4e', false, '20ce', '2102', '20e4', false])[(issuanceFlags & 0x1c) >>> 2];   //gets the assetId header based on lock status and aggregation
    const hash256 = crypto.createHash('sha256').update(hashData).digest();                      //do sha256
    const hash160 = crypto.createHash('ripemd160').update(hash256).digest('hex');       //do ripemd160
    ipfsData.data.assetId = base58check.encode(hash160 + '000' + divisibility, header, 'hex');              //convert to base58, add header and security check

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
    if (rules===false) {
        data.appendHex('01');
    } else {
        data.appendHex((rules.rewritable===true)?'03':'04');    //opcode 1 for normal, 3/4 for rules
    }
    const sha256Hash=ipfs.cidToHash(cid)
    data.appendHex(sha256Hash);                        //sha256 of ipfs data
    data.appendFixedPrecision(amountToCreate);      //amount to create
    if (rules!==false) data.appendBuffer(rulesBinary.toBuffer());      //appends the rules if any

    //create output commands
    if (aggregation===0) {
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
    for (let address in nodes) {
        let amountToPay=BigInt(Math.ceil(nodes[address]*ipfsSize+10));    //add 10 sat just in case of rounding errors
        if (amountToPay<constants.nodeDust) amountToPay=constants.nodeDust;                   //make sure it is at least as big as dust
        txOutputs.push(outputPair(address,amountToPay));
        amountLeft-=amountToPay;
    }

    //remove tx fee at 1sat/byte
    amountLeft-=BigInt(dataBuffer.length);  //size of encoded data
    amountLeft-=180n*BigInt(utxos.length);  //size of inputs and sigs
    amountLeft-=34n*BigInt(txOutputs.length);//size of outputs
    amountLeft-=100n;               //headers, and buffer
    if (amountLeft<0n) throw "Not enough funds to create asset: short "+(0n-amountLeft).toString()+" sat";

    //if any change add it to txOutput
    if (amountLeft>=constants.dust) {
        const changeAddress=(options.changeAddress===undefined)?await helpers.includeScriptPubKey(utxos[0]):options.changeAddress;
        txOutputs.push(outputPair(changeAddress,amountLeft));
    }

    //create and send tx
    let cleanUTXOs=[];
    for (let {txid,vout} of utxos) cleanUTXOs.push({txid,vout});

    // noinspection JSUnresolvedVariable
    return {
        inputs: cleanUTXOs,
        outputs:txOutputs,
        assetId:ipfsData.data.assetId,
        sha256Hash,cid
    };
}