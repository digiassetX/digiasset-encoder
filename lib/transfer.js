// noinspection JSUnfilteredForInLoop

const helpers=require('./helpers');
const lookup=require('digiasset-lookup');
const outputPair=require('outputpair');
const BitIO=require('bit-io');
const rulesVerifier=require('./rules_verify');
const constants=require('./constants');
const decoder=require('digiasset-decoder');

/**
 * This function shows how to handle most asset states.  Its output is in the format expected by
 * the core wallet.
 *
 * If you are using the signer rule you will need to include a fund utxo from each signer and
 * create the transaction as a PSBT(Partially Signed Bitcoin Transaction) and share it with all
 * signers to get all the necessary signatures.
 *
 * assetOutputs in the form of [assetId][address]=numberToSend
 * options.assetChange in form [assetId]=address  or just an address
 * if assetChange is set to a string only 1 asset type can be used since sending multiple assets to
 * a single output causes lots of problems
 *
 * @param {UTXO[]}                          utxos
 * @param {Object<Object<int|BigInt>>}      assetOutputs
 * @param {{
 *     assetChange: Object<string>|string,
 *     coinChange:  string,
 *     lookupUTXOs: boolean=true
 * }}                                       options
 * @return {Promise<{
 *     inputs:  {txid:string,vout:int}[],
 *     outputs: {}[],
 *     royalties: BigInt?,
 *     tx:      TxData,
 *     changes: Changes
 * }>}
 */
module.exports=async(utxos,assetOutputs,options={})=>{
    let lookupUTXOs=(options.lookupUTXOs === undefined);
    let royalties;

    //keep track of how many asset outputs there was
    let counts={};
    for (let assetId in assetOutputs) {
        counts[assetId]=Math.max(1,Object.keys(assetOutputs[assetId]).length);
    }

    //compute amount of funds we have
    let amountLeft=0n;
    for (let i in utxos) {
        if ((utxos[i].value===undefined)||(lookupUTXOs)) {
            utxos[i]=await lookup.getUTXO(utxos[i].txid, utxos[i].vout);
        }
        amountLeft+=utxos[i].value;
    }

    //get change addresses
    //if defined use them.  If not use the first non multisig address that the coins or assets came from
    let coinChange=options.coinChange;
    if (coinChange===undefined) {
        for (let utxo of utxos) {
            if (utxo.value >= constants.dust) {
                await helpers.includeScriptPubKey(utxo);                         //make sure we have the script pub key so we can lookup the address
                if (utxo.scriptPubKey.addresses.length!==1) continue;    //don't use multisig addresses for auto selected change
                coinChange=utxo.scriptPubKey.addresses[0];               //set this assets change address to source address
                break;
            }
        }
    }
    let assetChange=options.assetChange||{};
    /** @type {boolean|string} */let assetIdMust=false;
    if (typeof assetChange==="string") {
        //this only works if there is 1 asset out and same asset in
        let assetIds=Object.keys(assetOutputs);
        if (assetIds.length!==1) throw "Fixed Change Asset only works if only 1 assetId";
        const fixedAssetChange=assetChange;
        assetIdMust=assetIds[0];
        assetChange={};
        assetChange[assetIdMust]=fixedAssetChange;
    }
    /** @type {Object<BigInt>} */let assets= {};
    let assetHolderChanges={};
    for (let utxo of utxos) {
        if (utxo.assets===undefined) continue;
        await helpers.includeScriptPubKey(utxo);                         //make sure we have the script pub key so we can lookup the address
        let address=(utxo.scriptPubKey.addresses.length===1)?utxo.scriptPubKey.addresses[0]:undefined;
        for (let {assetId,amount} of utxo.assets) {
            //check if possible
            if ((assetIdMust!==false)&&(assetIdMust!==assetId))  throw "Fixed Change Asset only works if only 1 assetId";

            //keep track of assets we have
            if (assets[assetId]===undefined)  assets[assetId]=0n;
            assets[assetId]+=amount;

            //keep track of asset address changes
            if (assetHolderChanges[assetId]===undefined) assetHolderChanges[assetId]={};
            if (assetHolderChanges[assetId][address]===undefined) assetHolderChanges[assetId][address]=0n;
            assetHolderChanges[assetId][address]-=amount;

            //see if viable asset change address
            if ((assetChange[assetId]===undefined)&&(address!==undefined)) assetChange[assetId]=address;
        }
    }

    //lookup asset rules for all assets involved
    /** @type {Object<AssetRules>}*/let rules={};
    for (let assetId in assets) rules[assetId] = (await lookup.getRules(assetId)).pop();

    //make sure we have enough assets to send and handle change
    for (let assetId in assetOutputs) {
        if (assets[assetId]===undefined) throw assetId +" not found in inputs";
        let used=((rules[assetId]!==undefined) && (rules[assetId].deflate!==undefined))?rules[assetId].deflate:0n;
        for (let address in assetOutputs[assetId]) {
            //keep track how much was used
            assetOutputs[assetId][address]=BigInt(assetOutputs[assetId][address]);  //make sure input is a bigint
            used+=assetOutputs[assetId][address];

            //keep track of asset address changes
            if (assetHolderChanges[assetId]===undefined) assetHolderChanges[assetId]={};
            if (assetHolderChanges[assetId][address]===undefined) assetHolderChanges[assetId][address]=0n;
            assetHolderChanges[assetId][address]+=assetOutputs[assetId][address];
        }
        if (used>assets[assetId]) throw "Not enough of "+assetId+" found";
        if (used<assets[assetId]) {
            let address=assetChange[assetId];
            if (assetOutputs[assetId][address]===undefined) {
                assetOutputs[assetId][address]=0n;
            }
            assetOutputs[assetId][address]+=assets[assetId]-used;
        }
    }

    //see if there are any assets that are not in output list and assign to change address
    for (let assetId in assets) {
        if (assetOutputs[assetId]!==undefined) continue;

        //see how many are left over
        let changeAmount=assets[assetId];
        if ((rules[assetId]!==undefined) && (rules[assetId].deflate!==undefined)) changeAmount-=rules[assetId].deflate;
        if (changeAmount<0n) throw "Not enough of "+assetId+" found";
        if (changeAmount===0n) continue;

        //assign any change to change address
        let address=assetChange[assetId];
        assetOutputs[assetId]={};
        assetOutputs[assetId][address]=changeAmount;
    }

    /**
     * This for loop is redundant
     * Its here to create nice human readable errors if rules where not applied
     */
    for (let assetId in assets) {
        /** @type {AssetRules}*/let rule=rules[assetId];

        //make list of addresses that gained assets
        let outputAddresses=[];
        for (let address in assetHolderChanges[assetId]) {
            if (assetHolderChanges[assetId][address]>0n) {
                // noinspection JSUnfilteredForInLoop
                outputAddresses.push(address);
            }
        }

        //verify kyc rules
        await rulesVerifier.verifyKYC(rule,outputAddresses);

        //verify vote rules
        await rulesVerifier.verifyVote(rule,outputAddresses);

        //verify signers rules
        if (rule.signers!==undefined) {
            //get list of input addresses
            let inputAddresses=[];
            for (let i in utxos) {
                await helpers.includeScriptPubKey(utxos[i]);                             //make sure we have the script pub key so we can lookup the address
                if (utxos[i].scriptPubKey.addresses.length!==1) continue;        //don't use multisig addresses for auto selected change
                let address=utxos[i].scriptPubKey.addresses[0];
                if (inputAddresses.indexOf(address)===-1) inputAddresses.push(address);
            }

            //verify signers rule
            await rulesVerifier.verifySigners(rule,inputAddresses);
        }
    }

    //get list of assetIds
    const assetIds=Object.keys(assets);

    //go through inputs and create outputs
    let data=new BitIO();
    data.appendHex("44410315");

    //build tx outputs
    let txOutputs=[];
    if ((assetIds.length===1)&&(assetIds[0].substr(1,1)==="a")) {
        //only 1 asset and aggregable so try to minify output
        const assetId=assetIds[0];
        const outputs=assetOutputs[assetId];

        //order outputs from biggest to smallest
        let assetOutputOrder=[];
        for (let address in outputs) {
            // noinspection JSUnfilteredForInLoop
            assetOutputOrder.push({address,amount: BigInt(outputs[address])});
        }
        assetOutputOrder.sort((a,b)=>parseInt(b.amount-a.amount));

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
        //more then 1 asset or not aggregable

        //go through each inputs and make an array of sources in order
        /** @type {AssetCount[]}*/let assetInputs=[];
        for (let utxo of utxos) {
            if (utxo.assets===undefined) continue;
            for (let asset of utxo.assets) {
                let lastIndex=assetInputs.length-1;
                if (
                    (lastIndex<0)||                                         //if first element
                    (assetInputs[lastIndex].assetId!==asset.assetId)||      //if asset id not same as last
                    (asset.assetId.substr(1,1)!=='a')           //if not aggregable
                ) {
                    assetInputs.push(asset);                                //add asset to list
                } else {
                    assetInputs[lastIndex].amount+=assets.amount;           //add amount to last input since compatible
                }
            }
        }

        //create outputs and list of remaining assets needing to be sent
        /** @type {Object<int>}*/let outputAddresses={};
        /** @type {Object<{address:string,amount:BigInt}[]>}*/let outputAssets={};
        for (let assetId in assetOutputs) {
            for (let address in assetOutputs[assetId]) {

                //if address not already inn a output add to one
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

        //create instructions
        let currentInput={amount:0n};                                       //create fake first input with nothing in it
        while (assetInputs.length>0) {                                      //while still inputs keep going
            if (currentInput.amount===0n) currentInput=assetInputs.shift(); //if there is nothing left in input get next one
            let currentOutput=outputAssets[currentInput.assetId][0];        //gets the current output we are trying to fulfill
            let amountToTransfer=helpers.MathBigMin(currentInput.amount,currentOutput.amount);    //we can only move the smaller of the current input or amount needed
            data.appendInt(0,3);                                //skip=false,range=false,percent=false
            data.appendInt(outputAddresses[currentOutput.address],5); //current output
            data.appendFixedPrecision(amountToTransfer);                    //amount to send
            currentInput.amount-=amountToTransfer;                          //update amount left
            currentOutput.amount-=amountToTransfer;                         //update amount left to send
            if (currentOutput.amount===0n) outputAssets[currentInput.assetId].shift();//if all sent remove the entry from outputs
        }
    }

    //add encoded data
    let hexData=data.toBuffer().toString('hex');
    if (hexData.length>constants.maxOpReturnBytes*2) throw "Output encoding to large";
    txOutputs.push({"data":hexData});

    //check if any royalties need to be sent
    for (let assetId in assets) {
        royalties=await rulesVerifier.verifyRoyalties(rules[assetId],txOutputs,counts[assetId],true);
        amountLeft-=royalties;
    }

    //remove fees
    amountLeft-=BigInt(hexData.length/2);  //size of encoded data
    amountLeft-=180n*BigInt(utxos.length);  //size of inputs and sigs
    amountLeft-=34n*BigInt(txOutputs.length);//size of outputs
    amountLeft-=100n;               //headers, and buffer
    if (amountLeft<0n) throw "Not enough funds to create asset: short "+(0n-amountLeft).toString()+" sat";

    //if more then dust change send to coinChange
    if (amountLeft>=constants.dust) {
        //verify coin change address was not used
        for (let output of txOutputs) {
            if (output[coinChange] !== undefined) throw coinChange+" was already used so can't send change to it";
        }
        txOutputs.push(outputPair(coinChange,amountLeft));    //if hasn't been handled by search add to end
    }

    //create the output tx
    let tx={
        txid: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", //fake value
        vin:  utxos,
        vout: []
    };
    for (let vout in txOutputs) {
        let address=Object.keys(txOutputs[vout])[0];
        let output={
            value:  0n,
            vout:   vout,
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
    let changes=await decoder(tx);
    if (changes.type==="accidental burn") throw "Unknown Error Creating Transaction";

    //clean the input
    let cleanUTXOs=[];
    for (let {txid,vout} of utxos) cleanUTXOs.push({txid,vout});

    return {
        inputs: cleanUTXOs,
        outputs:txOutputs,
        royalties,
        tx,
        changes
    };
}