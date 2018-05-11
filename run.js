/*
*/

const AWS = require('aws-sdk');
const route53 = new AWS.Route53();

//** credentials for aws-sdk are provided via ENV variables

//** localize some environment variables in config
const config = {
    ip: process.env.IP,
    hostedZoneId: process.env.HOSTED_ZONE_ID,
    domain: process.env.DOMAIN,
    ttl: process.env.TTL || 60
}

//** retrieve the current dns record sets
route53.listResourceRecordSets({
    HostedZoneId: config.hostedZoneId 
}, (err, data) => {
    if(!!err) {
        console.error(err);
        throw new Error(err);
    }

    //** get the SRV dns records, initializing a new record if none found
    let srv = (data.ResourceRecordSets || []).find((item) => { return item.Type == 'SRV' });
    !srv && (srv = {
        Name: '_etcd-server._tcp.'+ config.domain,
        Type: 'SRV',
        TTL: config.ttl,
        ResourceRecords: []
    });

    let gex = new RegExp('.*?'+ config.ip.replace(/\./g, '\\.'));
    let existing = srv.ResourceRecords.find((item) => { return gex.test(item.Value) });

    if(!!existing) {
        console.log('exists, doing nothing');
    } else {
        //** add the SRV record for this node
        srv.ResourceRecords.push({ Value: '1 10 2380 '+ config.ip });

        //** build the params array for the route53 api
        let params = {
            ChangeBatch: {
                Changes: [
                    {
                        Action: 'UPSERT',
                        ResourceRecordSet: srv
                    }
                ]
            }, 
            HostedZoneId: config.hostedZoneId
        }

        //** update the DNS record via the route53 api
        route53.changeResourceRecordSets(params, (err2, data2) => {
            if(!!err2) {
                console.error(err2);
                throw new Error(err2);
            }

            console.log('ip added to dns:', config.ip);
        });
    }
});

