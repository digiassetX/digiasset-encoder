const lookup=require('digiasset-lookup');



/**
 * @typedef {{
 *     name:    string,
 *     url:     string,
 *     mimeType:string,
 *     dataHash:string
 * }}   Url
 */

/**
 * @typedef {{
 *     key:     string,
 *     value:   string,
 *     type:    string
 * }}   Meta
 */

/**
 * @typedef {{
 *     key:     string,
 *     pubKey:  string,
 *     format:  "pem|der",
 *     type:    "pkcs1|pkcs8"
 * }}   Encryption
 */



/**
 * @typedef {{
 *     data: {
 *         assetId:     string,
 *         assetName:   string,
 *         issuer:      string,
 *         description: string,
 *         urls:        Url[]
 *         userData:    {
 *             meta:    Meta[]
 *         },
 *         encryptions: Encryption[]?,
 *         verifications:Object?
 *     }
 * }} metaData
 */


/**
 * Simple function that returns the smaller of 2 values.
 * @param {BigInt}  a
 * @param {BigInt}  b
 * @return {BigInt}
 */
module.exports.MathBigMin=(a,b)=>(a<b)?a:b;




/**
 * If possible compresses the last several outputs using range returns true if it could
 * @param {BitIO}       data
 * @param {BigInt[]}    assetCounts
 * @return {boolean}
 */
module.exports.compressLastOutputs=(data,assetCounts)=>{
    //go through each output from smallest to largest and if there are more then 1 of same value encode those using range
    let index=assetCounts.length-1;
    let rangeCount=0;
    let rangeValue=assetCounts[index];
    while ((index >= 0) && (assetCounts[index] === rangeValue)) {
        rangeCount++;
        index--;
    }
    if (rangeCount > 1) {
        //range can be used so encode it
        data.appendInt(2,3);                            //skip=false,range=true,percent=false
        data.appendInt(assetCounts.length-1,13);  //all outputs
        data.appendFixedPrecision(rangeValue);

        //remove values covered by range
        for (let /** @type {int} */i in assetCounts) {
            assetCounts[i]-=rangeValue;
            if (assetCounts[i]===0n) {
                //values have been remove
                assetCounts.splice(i,assetCounts.length);//delete all after and including this index
                break;
            }
        }
        return true;
    }
    return false;
}

/**
 * Makes sure that scriptPubKey is included in the utxo
 * @param {UTXO}    utxo
 * @return {Promise<string>}
 */
module.exports.includeScriptPubKey=async(utxo)=>{
    if (utxo.scriptPubKey===undefined) {
        utxo.scriptPubKey=(await lookup.getUTXO(utxo.txid, utxo.vout)).scriptPubKey;
    }
    return utxo.scriptPubKey.addresses[0];
}

/**
 * finds all ipfs cids in the json data
 * @param object
 * @param {string[]}   cids
 */
const findAllCids=(object,cids)=>{
    for (let i in object) {
        // noinspection JSUnfilteredForInLoop
        switch (typeof object[i]) {
            case "object":
                // noinspection JSUnfilteredForInLoop
                findAllCids(object[i],cids);
                break;

            case "string":
                // noinspection JSUnfilteredForInLoop
                if (object[i].toLowerCase().substr(0,7)==="ipfs://") {
                    // noinspection JSUnfilteredForInLoop
                    cids.push(object[i].substr(7));
                }
        }
    }
}
module.exports.findAllCids=findAllCids;