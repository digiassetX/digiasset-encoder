require('digiassetx-digibyte-stream-types');
const ipfs=require('ipfs-simple');
const lookup=require('digiasset-lookup');
const decoder=require('digiasset-decoder');


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
 * @param {string} config
 */
module.exports.initIPFS=(config)=>{
    ipfs.path=config;
}


module.exports.transfer=require('./lib/transfer');
module.exports.issuance=require('./lib/issuance');
