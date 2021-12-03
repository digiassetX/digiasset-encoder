require('digiassetx-digibyte-stream-types');
const ipfs=require('ipfs-simple');
const lookup=require('digiasset-lookup');
const decoder=require('digiasset-decoder');
const DigiAssetIssuer=require('./lib/DigiAssetIssuer');
const DigiAssetTransferor=require("./lib/DigiAssetTransferor");

/**
 * Setup lookups s3 config
 * @param {{accessKeyId:string,secretAccessKey:string}|function} config
 */
module.exports.initS3=(config)=>{
    lookup.initS3(config);
    decoder({s3:config});
}

/**
 * If not using default use to change IPFS desktop path
 * @param {string|IPFS|true} config
 */
module.exports.initIPFS=async(config)=>{
    if (config===false) return; //not expected input but just in case
    if (config===true)  {
        await ipfs.create();
        config=ipfs.core;
    } else {
        ipfs.init(config);
    }
    lookup.initIPFS(config);
    await decoder({ipfs:config});
}

/**
 * DigiAssetTransferor class
 * @type {typeof DigiAssetTransferor}
 */
module.exports.DigiAssetTransferor=DigiAssetTransferor;

/**
 * Obsolete.  Should use object exported above
 *
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
 *     lookupUTXOs: boolean
 * }}                                       options
 * @return {Promise<{
 *     inputs:  {txid:string,vout:int}[],
 *     outputs: {}[],
 *     royalties: BigInt?,
 *     tx:      TxData,
 *     changes: Changes
 * }>}
 */
module.exports.transfer=async(utxos,assetOutputs,options={})=>{
    //create object
    let {assetChange,coinChange,lookupUTXOs=false}=options;
    let obj=new DigiAssetTransferor();
    obj.forceLookup=lookupUTXOs;
    if (coinChange!==undefined) obj.DigiByteChangeAddress=coinChange;
    switch (typeof assetChange) {
        case "undefined":
            break;

        case "string":
            obj.setAssetChangeAddress(assetChange);
            break;

        case "object":
            for (let assetId in assetChange) obj.setAssetChangeAddress(assetChange[assetId],assetId);
    }

    //add UTXOs
    await obj.addUTXOs(utxos);

    //add outputs
    for (let assetId in assetOutputs) {
        let outputs={};
        for (let address in assetOutputs[assetId]) outputs[address]=BigInt(assetOutputs[assetId][address]);
        await obj.addOutputs(assetId,outputs);
    }

    //build transaction
    await obj.build();
    let {inputs,outputs}=obj.tx;
    return {
        inputs,outputs,
        royalties:  obj.royalties,
        tx:         obj.decodedTx,
        changes:    obj.changes
    };
}


/**
 * DigiAssetIssuer class
 * @type {typeof DigiAssetIssuer}
 */
module.exports.DigiAssetIssuer=DigiAssetIssuer;

/**
 * Obsolete.  Should use object exported above
 *
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
 *         site:        {
 *             url:         string,
 *             type:        "web"
 *         },
 *     }}   metadata
 * @return {Promise<{
 *     inputs:  {txid:string,vout:int}[],
 *     outputs: {}[],
 *     metadata: string,
 *     assetId: string
 * }>}
 */
module.exports.issuance=async(utxos,outputs,metadata,options)=> {
    //create object
    let {divisibility=0,locked=true,aggregation="aggregatable",changeAddress,nodes,rules}=options;
    let obj=new DigiAssetIssuer(metadata, {divisibility,locked,aggregation,rules});
    if (changeAddress!==undefined) obj.DigiByteChangeAddress=changeAddress;
    if (nodes!==undefined) {
        obj.clearPermanentProviders();
        for (let address in nodes) obj.addPermanentProvider(address,nodes[address]);
    }

    //add UTXOs
    await obj.addUTXOs(utxos);

    //add outputs
    for (let address in outputs) outputs[address]=BigInt(outputs[address]);
    await obj.addOutputs(outputs);

    //build transaction
    await obj.build();
    let {inputs,outputs:txOutputs}=obj.tx;
    return {
        inputs,
        outputs:    txOutputs,
        assetId:    obj.assetId,
        sha256Hash: obj.sha256Hash,
        cid:        obj.cid
    }
}