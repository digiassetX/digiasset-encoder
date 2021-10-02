let lookup=require('digiasset-lookup');
const outputPair=require('outputpair');

/**
 * output pair always returns a string with exactly 8 decimals so converting back to a BigInt is just a matter of removing the decimal
 * @param {string}  dgb
 * @return {BigInt}
 */
const dgbToSat=(dgb)=>{
    let parts=dgb.split(".");
    return BigInt(parts[0]+parts[1]);
}




/**
 * Throws an error if rule is broken
 * @param {AssetRules}  rule
 * @param {string[]}    addresses
 * @return {Promise<void>}
 */
module.exports.verifyKYC=async(rule,addresses)=>{
    //see if kyc required
    if (rule.kyc===undefined) return;

    //get rule data
    let ban=true;
    let list=[];
    if (rule.kyc!==true) {
        ban=(rule.kyc.ban!==undefined);
        list=rule.kyc.ban||rule.kyc.allow;
    }

    //verify all addresses are kyc verified and make country list
    for (let address of addresses) {
        let {country,revoked}=await lookup.getKYC(address)||{};
        if (country===undefined) throw address +" is not KYC verified";
        if (revoked!==undefined) throw "KYC on "+address+" has been revoked";
        if (ban) {
            //ban so country should not be in list
            if (list.indexOf(country)!==-1) throw address+" belongs to banned country";
        } else {
            if (list.indexOf(country)===-1) throw address+" does not belong to allowed country";
        }
    }
}

/**
 * Throws an error if rule is broken
 * @param {AssetRules}  rule
 * @param {string[]}    addresses
 * @return {Promise<void>}
 */
module.exports.verifyVote=async(rule,addresses)=>{
    //see if we need to check addresses
    if (rule.vote===undefined) return;
    if (rule.vote.movable) return;

    //make list of allowed addresses
    let allowed={};
    for (let {address} of rule.vote.options) allowed[address]=true;

    //only specific addresses allowed so check if only those addresses where used
    for (let address of addresses) {
        if (allowed[address]===undefined) throw address+" is not a valid vote option";
    }
}

/**
 * Throws an error if rule is broken
 * @param {AssetRules}  rule
 * @param {string[]}    addresses
 * @return {Promise<void>}
 */
module.exports.verifySigners=async(rule,addresses)=>{
    //see if we need to check addresses
    if (rule.signers===undefined) return;

    let {required,list}=rule.signers;
    let found=0;
    for (let address of addresses) {
        found+=(list[address]||0)
    }
    if (found<required) throw required+" signer weight was needed. "+found+" was found.";
}


/**
 * Throws an error if rule is broken unless addShort is true in which case it adds the needed outputs and returns the extra cost
 * @param {AssetRules}  rule
 * @param {{}[]}        outputs
 * @param {int}         count
 * @param {boolean}     addShort
 * @return {Promise<BigInt>}
 */
module.exports.verifyRoyalties=async(rule,outputs,count=1,addShort=false)=>{
    //see if we need to check addresses
    if (rule.royalties===undefined) return 0n;
    let exchangeRate=100000000n;
    if (rule.currency!==undefined) {
        exchangeRate=BigInt(Math.ceil(await lookup.getExchangeRate(rule.currency)));
    }

    //make sure royalties where paid
    let extra=0n;
    for (let address in rule.royalties) {
        //get amount we need to send
        let amount=BigInt(count)*BigInt(rule.royalties[address])*exchangeRate/100000000n;

        //see if already sent
        let found=false;
        for (let output of outputs) {
            if (output[address]===undefined) continue;
            let foundAmount=dgbToSat(output[address]);
            if (foundAmount>=amount) {
                //enough sent so stop looking
                found=true;
                break;
            } else {
                //some sent but not enough
                if (!addShort) throw "A royalty of "+amount+" must be sent to "+address;

                //check if output amount is 600sat if so throw an error because can't send assets to the royalty resipients address
                if (foundAmount===600n) throw "Can not send assets to the royalty address";

                //we are allowed to add short fall so modify the output
                let tempOutput=outputPair(address,amount);              //create a temporary output
                output[address]=tempOutput[address];                    //copy the string amount from the temp
                extra+=amount-foundAmount;                              //record extra funds needed
            }
        }

        //if not sent handle
        if (!found) {
            if (!addShort) throw "A royalty of "+amount+" must be sent to "+address;
            outputs.push(outputPair(address,amount));
            extra+=amount;
        }
    }
    return extra;
}