/* ****************************************************************
 * test/config.js is left out for security reasons.  It should be in the form
 * where REDACTED is replaced by you AWS keys
module.exports={
  s3: {
      accessKeyId: 'REDACTED',
      secretAccessKey: 'REDACTED'
  }
}
**************************************************************** */
const encoder = require('../index');
let configMissing=false;
let config= {
    s3: {
        accessKeyId: 'REDACTED',
        secretAccessKey: 'REDACTED'
    }
}
try {
    config=require('./config');
    encoder.initS3(config.s3);
} catch (e) {
    //config missing
    configMissing=true;
}
const {DigiAssetIssuer,DigiAssetTransferor}=encoder;

const expect    = require("chai").expect;

/**
 * Stringifies an object and converts bigint to string
 * @param {Object}  data
 * @return {string}
 */
const objectToString=(data)=>{
    return JSON.stringify(data,(key,value)=>
        (typeof value === "bigint")? value.toString():value
    );
}


describe("V3 Encoding(Obsolete Methods)",function() {
    this.timeout(20000);
    it('create royalty test', async function() {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx = await encoder.issuance(
            [
                {
                    txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
                    vout: 1,
                    value: 39999000n
                },{
                txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
                vout: 0,
                value: 100199970758n
            }
            ], {
                dgb1qh9tqqxe6k95y8vtlsp75yzavudav5lfyut0n3v: 5n,
                dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n,
                DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd: 100n,
                dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3: 100n
            }, {

                assetName: "V3 Test",
                description: "V3 test asset.  5DGB will be sent to DigiByte.rocks for each transfer.  Can only be sent to KYC addresses.",
                urls: [
                    {
                        name: "icon",
                        mimeType: "image/png",
                        url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                    }
                ]

            }, {
                rules: {
                    rewritable: true,
                    royalties: {
                        "DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY": 500000000n
                    }
                },
                locked: true,
                changeAddress: "DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"
            }
        );
        expect(tx.inputs[0].txid).to.equal("a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212");
        expect(tx.inputs[0].vout).to.equal(1);
        expect(tx.inputs[1].txid).to.equal("8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a");
        expect(tx.inputs[1].vout).to.equal(0);
        expect(tx.outputs[0]["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]).to.equal("0.00000600");
        expect(tx.outputs[1]["DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd"]).to.equal("0.00000600");
        expect(tx.outputs[2]["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]).to.equal("0.00000600");
        expect(tx.outputs[3]["dgb1qh9tqqxe6k95y8vtlsp75yzavudav5lfyut0n3v"]).to.equal("0.00000600");
        expect(tx.outputs[4]["DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY"]).to.equal("5.00000000");
        expect(tx.outputs[5]["data"]).to.equal("44410303937ebf5461050a066f75ef1c323e605fbbdf9fc926c49f0fdafe128b3a8d353e331010401f03054002201210");
        expect(parseFloat(tx.outputs[6]["dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x"])).to.greaterThan(0);
        expect(parseFloat(tx.outputs[7]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"])).to.greaterThan(0);
    });
    it('create royalty transfer', async()=> {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx=await encoder.transfer([
            {
                //has 100 assets
                txid:   "c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa",
                vout:   0,
                value:  600n,
                scriptPubKey:   {
                    addresses:  ["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]
                },
                assets: [
                    {
                        assetId:    "La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb",
                        amount:     100n,
                        decimals:   0
                    }
                ]
            },
            {
                txid:   "c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa",
                vout:   7,
                value:  98837586602n,
                scriptPubKey:   {
                    addresses:  ["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]
                }
            }
        ],{
            La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb: {
                "DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd": 5,
                "dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3": 90
            }
        },{
            lookupUTXOs:    false
        });
        expect(tx.inputs[0].txid).to.equal("c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa");
        expect(tx.inputs[0].vout).to.equal(0);
        expect(tx.inputs[1].txid).to.equal("c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa");
        expect(tx.inputs[1].vout).to.equal(7);
        expect(tx.outputs[0]["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]).to.equal("0.00000600");
        expect(tx.outputs[1]["DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd"]).to.equal("0.00000600");
        expect(tx.outputs[2]["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]).to.equal("0.00000600");
        expect(tx.outputs[3]["data"]).to.equal("44410315400205002550");
        expect(tx.outputs[4]["DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY"]).to.equal("10.00000000");
        expect(tx.outputs[5]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]).to.equal("978.37584762");
    });
    it('create royalty transfer with change', async()=> {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx=await encoder.transfer([
            {
                //has 100 assets
                txid:   "c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa",
                vout:   1,
                value:  600n,
                scriptPubKey:   {
                    addresses:  ["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]
                },
                assets: [
                    {
                        assetId:    "La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb",
                        amount:     100n,
                        decimals:   0
                    }
                ]
            },
            {
                txid:   "df6d53fc3bd4698306219e370719b81b2c80a11641a34607c97685f1fc370191",
                vout:   5,
                value:  98337584762n,
                scriptPubKey:   {
                    addresses:  ["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]
                }
            }
        ],{
            La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb: {
                "DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd": 50
            }
        },{
            lookupUTXOs:    false
        });
        expect(tx.inputs[0].txid).to.equal("c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa");
        expect(tx.inputs[0].vout).to.equal(1);
        expect(tx.inputs[1].txid).to.equal("df6d53fc3bd4698306219e370719b81b2c80a11641a34607c97685f1fc370191");
        expect(tx.inputs[1].vout).to.equal(5);
        expect(tx.outputs[0]["DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd"]).to.equal("0.00000600");
        expect(tx.outputs[1]["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]).to.equal("0.00000600");
        expect(tx.outputs[2]["data"]).to.equal("4441031540012051");
        expect(tx.outputs[3]["DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY"]).to.equal("5.00000000");
        expect(tx.outputs[4]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]).to.equal("978.37583558");
    });
    it('create vote asset',async()=>{
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx = await encoder.issuance(
            [
                {
                    "txid": "1892fb5840fc208af64c290da625be91ff6ad7fe09ef6dd05ed3ae64f6fb94da",
                    "vout": 1,
                    value: 49999000n
                }
            ], {
                dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3: 10n
            }, {

                assetName: "V3 Test Vote Issuance",
                description: "V3 vote test asset.  To vote send to one of the vote addresses.  Sending to any other address will burn the asset.  Vote expires at block 14Million"

            }, {
                rules: {
                    rewritable: false,
                    vote: {
                        movable: false,
                        cutoff: 14000000,
                        options:    [
                            "spaceX is the best",
                            "spaceX is cool",
                            "Why does Matthew care so much about spaceX",
                            "1+1=3"
                        ]
                    }
                },
                locked: false,
                changeAddress: "DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"
            }
        );
        expect(tx.inputs[0].txid).to.equal("1892fb5840fc208af64c290da625be91ff6ad7fe09ef6dd05ed3ae64f6fb94da");
        expect(tx.inputs[0].vout).to.equal(1);
        expect(tx.outputs[0]["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]).to.equal("0.00000600");
        expect(tx.outputs[1]["data"]).to.equal("444103047a9a016c2ef0dea7b423684acfa1b63d2bb18ca9af14b80de5641380915f8fec0a40420e600f000a00");
        expect(parseFloat(tx.outputs[2]["dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x"])).to.greaterThan(0);
        expect(parseFloat(tx.outputs[3]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"])).to.greaterThan(0);
    });
    it('move 1 vote to vote address 1', async()=> {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx=await encoder.transfer([
            {
                //has 100 assets
                txid:   "c9995bf82a24355b0ea9e0aafebf431b90d23cecf05e72d8069d7ed6ab033fac",
                vout:   0,
                value:  600n,
                scriptPubKey:   {
                    addresses:  ["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]
                },
                assets: [
                    {
                        assetId:    "Ua9hJ3q7zKnaRZS9E5frb3Ukon6aBNNgxLX3i5",
                        amount:     10n,
                        decimals:   0
                    }
                ]
            },
            {
                txid:   "9a6bac5ec84afa748dbe3a1c9760382ec53e608c339ed17a939cbcae2cf7e7e8",
                vout:   1,
                value:  82153247693n,
                scriptPubKey:   {
                    addresses:  ["DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB"]
                }
            }
        ],{
            Ua9hJ3q7zKnaRZS9E5frb3Ukon6aBNNgxLX3i5: {
                "D8LWk1fGksGDxZai17A5wQUVsRiV69Nk7J": 1n,
                "dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3":  9n
            }
        },{
            lookupUTXOs:    false
        });
        expect(tx.inputs[0].txid).to.equal("c9995bf82a24355b0ea9e0aafebf431b90d23cecf05e72d8069d7ed6ab033fac");
        expect(tx.inputs[0].vout).to.equal(0);
        expect(tx.inputs[1].txid).to.equal("9a6bac5ec84afa748dbe3a1c9760382ec53e608c339ed17a939cbcae2cf7e7e8");
        expect(tx.inputs[1].vout).to.equal(1);
        expect(tx.outputs[0]["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]).to.equal("0.00000600");
        expect(tx.outputs[1]["D8LWk1fGksGDxZai17A5wQUVsRiV69Nk7J"]).to.equal("0.00000600");
        expect(tx.outputs[2]["data"]).to.equal("4441031501010009");
        expect(tx.outputs[3]["DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB"]).to.equal("821.53246523");
    });
    it('move 1 vote to non vote address 1', async()=> {
        try {
            /**
             * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
             */
            let tx=await encoder.transfer([
                {
                    //has 100 assets
                    txid:   "c9995bf82a24355b0ea9e0aafebf431b90d23cecf05e72d8069d7ed6ab033fac",
                    vout:   0,
                    value:  600n,
                    scriptPubKey:   {
                        addresses:  ["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]
                    },
                    assets: [
                        {
                            assetId:    "Ua9hJ3q7zKnaRZS9E5frb3Ukon6aBNNgxLX3i5",
                            amount:     10n,
                            decimals:   0
                        }
                    ]
                },
                {
                    txid:   "9a6bac5ec84afa748dbe3a1c9760382ec53e608c339ed17a939cbcae2cf7e7e8",
                    vout:   1,
                    value:  82153247693n,
                    scriptPubKey:   {
                        addresses:  ["DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzA"]
                    }
                }
            ],{
                Ua9hJ3q7zKnaRZS9E5frb3Ukon6aBNNgxLX3i5: {
                    "DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB": 1n
                }
            },{
                lookupUTXOs:    false
            });
            expect(true).to.equal(false);
        } catch (e) {
            expect(e.toString()).to.equal("DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB is not a valid vote option");
        }
    });
    it('create royalty address with cad value', async()=> {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx=await encoder.issuance([
            {
                txid: '9629ea36fa55fc8aebfa127bc8f9b32c014ce100f4aa5911221d12af6b943516',
                vout: 3,
                amount: '82153246523'
            }
        ],{ DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB: '10000' },{
            assetName: 'fake test',
            issuer: 'Matthew Cornelisse',
            description: 'fake description',
            urls: []
        },{
            divisibility: 2,
            locked: true,
            aggregation: 'aggregatable',
            changeAddress: 'D7SU9Uenv9Nqi3Q1SMXE5gSC5EkLPMQu1F',
            rules: {
                rewritable: false,
                royalties: { DR9dkvsJzwmCwmPN5nXUkopVgirf2tRYoR: '100000000' },
                currency: 'CAD'
            }
        });
        expect(tx.inputs[0].txid).to.equal("9629ea36fa55fc8aebfa127bc8f9b32c014ce100f4aa5911221d12af6b943516");
        expect(tx.outputs[0]["DAPhmucYFtYg8CrHQNmsHYz55xKnijHYzB"]).to.equal("0.00000600");
        expect(tx.outputs[1]["DR9dkvsJzwmCwmPN5nXUkopVgirf2tRYoR"]).to.equal("1.00000000");
        expect(tx.outputs[2]["data"]).to.equal("44410304063ba3d95960798a9cbb8919ff09ba9ea3f99e177839af95f295a6add28284bd20149800101f00201450");
        expect(parseFloat(tx.outputs[3]["dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x"])).to.greaterThan(0);
        expect(parseFloat(tx.outputs[4]["D7SU9Uenv9Nqi3Q1SMXE5gSC5EkLPMQu1F"])).to.greaterThan(0);
    });
    it('royalty transfer to multiple addresses at once', async()=>{
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        let tx=await encoder.transfer([
            {
                //has 100 assets
                txid:   "c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa",
                vout:   1,
                value:  600n,
                scriptPubKey:   {
                    addresses:  ["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]
                },
                assets: [
                    {
                        assetId:    "La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb",
                        amount:     100n,
                        decimals:   0
                    }
                ]
            },
            {
                txid:   "df6d53fc3bd4698306219e370719b81b2c80a11641a34607c97685f1fc370191",
                vout:   5,
                value:  98337584762n,
                scriptPubKey:   {
                    addresses:  ["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]
                }
            }
        ],{
            La5fMQh1m8tbaBNDmyvh8Ug3f2Bd85nVbcrDvb: {
                "DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd": 10,
                "DFf3P5fE4ckcQnCTdvNtbmUjdL24gXZMVr": 10,
                "D6pnvTX4CiKhsEPuLy7oc1xCfmL8zReSLX": 10,
                "DKGxyPDySEVTWkQZsY6fbBGT1EdoziEGzr": 10
            }
        },{
            lookupUTXOs:    false
        });
        expect(tx.inputs[0].txid).to.equal("c57fc42847ebf7b3842fde56ed3ef1897d330413d3325e6b2043b78b5ed7f3fa");
        expect(tx.outputs[0]["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]).to.equal("0.00000600");
        expect(tx.outputs[1]["DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd"]).to.equal("0.00000600");
        expect(tx.outputs[2]["DFf3P5fE4ckcQnCTdvNtbmUjdL24gXZMVr"]).to.equal("0.00000600");
        expect(tx.outputs[3]["D6pnvTX4CiKhsEPuLy7oc1xCfmL8zReSLX"]).to.equal("0.00000600");
        expect(tx.outputs[4]["DKGxyPDySEVTWkQZsY6fbBGT1EdoziEGzr"]).to.equal("0.00000600");
        expect(tx.outputs[5]["data"]).to.equal("4441031540040a002051");
        expect(tx.outputs[6]["DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY"]).to.equal("20.00000000");
        expect(tx.outputs[7]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"]).to.equal("963.37581654");
    });
    

});

describe("V3 Encoding Object Oriented",function() {
    this.timeout(20000);
    it('create royalty test', async function () {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        /** @type {DigiAssetIssuer} */let assetCreator=new DigiAssetIssuer({

            assetName: "V3 Test",
            description: "V3 test asset.  5DGB will be sent to DigiByte.rocks for each transfer.  Can only be sent to KYC addresses.",
            urls: [
                {
                    name: "icon",
                    mimeType: "image/png",
                    url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                }
            ]

        }, {
            rules: {
                rewritable: true,
                royalties: {
                    "DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY": 500000000n
                }
            },
            locked: true
        });
        await assetCreator.addUTXO({
            txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
            vout: 1,
            value: 39999000n
        });
        await assetCreator.addUTXOs([{
            txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
            vout: 0,
            value: 100199970758n
        }]);
        await assetCreator.addOutput("dgb1qh9tqqxe6k95y8vtlsp75yzavudav5lfyut0n3v",5n);
        await assetCreator.addOutputs({
            dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n,
            DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd: 100n,
            dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3: 100n
        });
        assetCreator.DigiByteChangeAddress="DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM";
        await assetCreator.build();
        let {inputs,outputs}=assetCreator.tx;

        expect(inputs[0].txid).to.equal("a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212");
        expect(inputs[0].vout).to.equal(1);
        expect(inputs[1].txid).to.equal("8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a");
        expect(inputs[1].vout).to.equal(0);
        expect(outputs[0]["dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w"]).to.equal("0.00000600");
        expect(outputs[1]["DGSJMJpj3dwx2yhgGg2Hi6Gpmo5YvVsPRd"]).to.equal("0.00000600");
        expect(outputs[2]["dgb1qxfkysf0r79ucjc5c37v75aew49c8d76sh4tny3"]).to.equal("0.00000600");
        expect(outputs[3]["dgb1qh9tqqxe6k95y8vtlsp75yzavudav5lfyut0n3v"]).to.equal("0.00000600");
        expect(outputs[4]["DSXnZTQABeBrJEU5b2vpnysoGiiZwjKKDY"]).to.equal("5.00000000");
        expect(outputs[5]["data"]).to.equal("44410303937ebf5461050a066f75ef1c323e605fbbdf9fc926c49f0fdafe128b3a8d353e331010401f03054002201210");
        expect(parseFloat(outputs[6]["dgb1qjnzadu643tsfzjqjydnh06s9lgzp3m4sg3j68x"])).to.greaterThan(0);
        expect(parseFloat(outputs[7]["DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM"])).to.greaterThan(0);
        console.log(512);
        console.log(assetCreator.decodedTx);
        console.log(514);
        console.log(assetCreator.changes);
    });

    it('create expiry by block height test', async function () {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        /** @type {DigiAssetIssuer} */let assetCreator=new DigiAssetIssuer({

            assetName: "V3 Test",
            description: "V3 test asset",
            urls: [
                {
                    name: "icon",
                    mimeType: "image/png",
                    url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                }
            ]

        }, {
            rules: {
                rewritable: false,
                expires:    15000000n
            },
            locked: true
        });
        await assetCreator.addUTXO({
            txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
            vout: 1,
            value: 39999000n
        });
        await assetCreator.addUTXOs([{
            txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
            vout: 0,
            value: 100199970758n
        }]);
        await assetCreator.addOutputs({
            dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n
        });
        assetCreator.DigiByteChangeAddress="DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM";
        assetCreator.blockHeight=13965792;  //make sure test always good
        await assetCreator.build();
        let {inputs,outputs}=assetCreator.tx;
        expect(outputs[1]["data"]).to.equal("44410304b3c3558bb5eb52faf05c247f2869436fb81a822e6a374100aa4cdd49b4d1f376201248020f600f00201210");
        let changes=assetCreator.changes;
        expect(changes.rules.expires).to.equal(15000000n);
    });

    it('create expiry by block height test(already expired)', async function () {
        try {
            /**
             * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
             */
            /** @type {DigiAssetIssuer} */let assetCreator=new DigiAssetIssuer({

                assetName: "V3 Test",
                description: "V3 test asset",
                urls: [
                    {
                        name: "icon",
                        mimeType: "image/png",
                        url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                    }
                ]

            }, {
                rules: {
                    rewritable: false,
                    expires:    15000000n
                },
                locked: true
            });
            await assetCreator.addUTXO({
                txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
                vout: 1,
                value: 39999000n
            });
            await assetCreator.addUTXOs([{
                txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
                vout: 0,
                value: 100199970758n
            }]);
            await assetCreator.addOutputs({
                dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n
            });
            assetCreator.DigiByteChangeAddress="DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM";
            assetCreator.blockHeight=15000001;  //make sure test always good
            await assetCreator.build();
            expect(true).to.equal(false);
        } catch (e) {
            expect(e.toString()).to.equal("Invalid Rule Detected: Already Expired");
        }
    });

    it('create expiry by time test', async function () {
        /**
         * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
         */
        /** @type {DigiAssetIssuer} */let assetCreator=new DigiAssetIssuer({

            assetName: "V3 Test",
            description: "V3 test asset",
            urls: [
                {
                    name: "icon",
                    mimeType: "image/png",
                    url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                }
            ]

        }, {
            rules: {
                rewritable: false,
                expires:    1636144852000n
            },
            locked: true
        });
        await assetCreator.addUTXO({
            txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
            vout: 1,
            value: 39999000n
        });
        await assetCreator.addUTXOs([{
            txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
            vout: 0,
            value: 100199970758n
        }]);
        await assetCreator.addOutputs({
            dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n
        });
        assetCreator.DigiByteChangeAddress="DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM";
        assetCreator.blockTime=100199900;
        await assetCreator.build();
        let {inputs,outputs}=assetCreator.tx;
        expect(outputs[1]["data"]).to.equal("44410304b3c3558bb5eb52faf05c247f2869436fb81a822e6a374100aa4cdd49b4d1f3762012480830c2cb6a300f00201210");
        let changes=assetCreator.changes;
        expect(changes.rules.expires).to.equal(1636144852000n);
    });

    it('create expiry by time test(already expired)', async function () {
        try {
            /**
             * @type {{inputs: {txid: string, vout: int}[], outputs: {}[]}}
             */
            /** @type {DigiAssetIssuer} */let assetCreator=new DigiAssetIssuer({

                assetName: "V3 Test",
                description: "V3 test asset",
                urls: [
                    {
                        name: "icon",
                        mimeType: "image/png",
                        url: "ipfs://QmdtLCqzYNJdhJ545PxE247o6AxDmrx3YT9L5XXyddPR1M"
                    }
                ]

            }, {
                rules: {
                    rewritable: false,
                    expires:    1636144852000n
                },
                locked: true
            });
            await assetCreator.addUTXO({
                txid: "a3c0b13a3737f00ee593ae98f423c30f4a2004e7107e484927f2bf637b9c5212",
                vout: 1,
                value: 39999000n
            });
            await assetCreator.addUTXOs([{
                txid: "8bbedee99f2361e2773b79893e8e99340713c3dbc4050cf2294c3a609ed7157a",
                vout: 0,
                value: 100199970758n
            }]);
            await assetCreator.addOutputs({
                dgb1qx9mdulkmasph63c4v4e0x8zwhm62khsf83qc2w: 100n
            });
            assetCreator.DigiByteChangeAddress="DPb98QJ8GLR6yBC8Ybt57ybrELDkM6w3bM";
            await assetCreator.build();
            expect(true).to.equal(false);   //should not reach
        } catch (e) {
            expect(e.toString()).to.equal("Invalid Rule Detected: Already Expired");
        }
    });
});