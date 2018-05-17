/*
etcd-ec2-route53-cluster-member
---

this process expects the following 3 environment variables set:
    - INSTANCE_ID - id of the instance we are adding as a member to the cluster
    - REGION - the ec2 region we're making changes in

mikejmacmillan@gmail.com
*/
const DNS_NAME_TAG = 'dns-name';
const defaults = {
    region: 'us-west-2',
    ttl: 60
};
const config = {
    ip: process.env.IP,
    instanceId: process.env.INSTANCE_ID,
    region: process.env.REGION || defaults.region,
    hostedZoneId: process.env.HOSTED_ZONE_ID,
    ttl: process.env.TTL || defaults.ttl
};

console.log('cluster-member initializing');
console.log('  ip:', config.ip);
console.log('  instanceId:', config.instanceId);
console.log('  region:', config.region);
console.log('  hostedZoneId:', config.hostedZoneId);

const AWS = require('aws-sdk');
const ec2 = new AWS.EC2({ region: config.region });
const route53 = new AWS.Route53();

//** do all the things
getDomain()
    .then(getInstanceTags)
    .then(addDNSRecord)
    .then(() => {
        console.log('finished!');
    })
    .catch((err) => {
        console.log('error!', err);
    });



function getDomain() {
    console.log('getting TLD');

    return new Promise((resolve, reject) => {
        route53.getHostedZone({ Id: config.hostedZoneId }, (err, data) => {
            if(!!err) return reject(err);
            if(!data.HostedZone || !data.HostedZone.Id)
                return reject('hosted zone not found');

            //** grab the TLD from the hosted zone record
            resolve(console.log('  '+ (config.domain = data.HostedZone.Name)));
        });
    });
}

function getInstanceTags() {
    console.log('getting tags for instance');

    //** just filter tags for this instance
    let tagFilter = {
        Filters: [{
            Name: 'resource-id',
            Values: [config.instanceId]
        }]
    };

    return new Promise((resolve, reject) => {
        ec2.describeTags(tagFilter, (err, data) => {
            !!err 
                ? reject(err)
                : resolve(data);
        });
    });

}

function addDNSRecord(tags) {

    return new Promise((resolve, reject) => {

        //** get the tag indicating the members 
        let tag = (tags && tags.Tags || []).find((item) => item.Key == DNS_NAME_TAG );
        let dnsName = tag && tag.Value +'.'+ config.domain;

        if(!tag)
            return reject(`No ${DNS_NAME_TAG} tag found on this instance`);

        console.log(`  tag found, "${tag.Value}"`);

        //** create the params to upsert the new a-record with this instances IP
        let params = {
            ChangeBatch: {
                Changes: [{
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                        Name: dnsName,
                        Type: 'A',
                        TTL: config.ttl,
                        ResourceRecords: [{ Value: config.ip }]
                    }
                }]
            }, 
            HostedZoneId: config.hostedZoneId
        };

        console.log('modifying DNS')
        console.log('  '+ dnsName);

        //** update DNS
        route53.changeResourceRecordSets(params, (err, data) => {
            if(!!err)
                return reject(err);

            resolve(data);
        });
    });
}

