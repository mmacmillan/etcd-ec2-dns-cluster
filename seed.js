/*
etcd-ec2-route53-cluster-seed
---

this process expects the following 3 environment variables set:
    - HOST - the hostname of this host, private preferably
    - HOSTED_ZONE_ID - the id of the route53 zone we're updating
    - DOMAIN - the domain that DNS is managing; this is used to create new SRV records
    - CLUSTER_SIZE - 3, 5, or 7; defaults to 3 if not provided
    - DNS_PREFIX - defaults to "node"; the prefix added to the # when making SRV records; ie node-1, node-2

mikejmacmillan@gmail.com
*/

const AWS = require('aws-sdk');
const route53 = new AWS.Route53();
const defaults = {
    ttl: 60,
    clusterSize: 3,
    dnsPrefix: 'node'
};

//** credentials for aws-sdk are provided via ENV variables

//** localize some environment variables in config
const config = {
    hostedZoneId: process.env.HOSTED_ZONE_ID,
    ttl: process.env.TTL || defaults.ttl,
    clusterSize: process.env.CLUSTER_SIZE || defaults.clusterSize,
    dnsPrefix: process.env.DNS_PREFIX || defaults.dnsPrefix
};


//** do all the things
getDomain()
    .then(findAndDeleteExistingRecords)
    .then(initializeDefaults)
    .then(createClusterDNS)
    .then(() => {
        console.log('cluster dns discovery initialized; cluster size', config.clusterSize);
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

function findAndDeleteExistingRecords(data) {

    return new Promise((resolve, reject) => {
        console.log('getting dns records');

        //** retrieve the current dns record sets
        route53.listResourceRecordSets({
            HostedZoneId: config.hostedZoneId 
        }, (err, data) => {
            if(!!err) return reject(err);

            console.log('finding existing SRV records');

            //** get the SRV dns records, initializing a new record if none found
            let records = (data.ResourceRecordSets || []).filter((item) => { return item.Type == 'SRV' });
            console.log(`  - found ${records.length} record(s)`);

            if(records.length > 0) {
                console.log('  - deleting existing records');

                let params = {
                    ChangeBatch: {
                        Changes: []
                    }, 
                    HostedZoneId: config.hostedZoneId
                }

                //** add a DELETE change for each SRV recore
                records.forEach((record) => {
                    params.ChangeBatch.Changes.push({
                        Action: 'DELETE',
                        ResourceRecordSet: record
                    });
                });

                //** update DNS, remove the SRV records
                route53.changeResourceRecordSets(params, (err, data) => {
                    if(!!err) return reject(err);

                    resolve();
                });
            } else
                resolve();
        });
    });
}

function initializeDefaults() {
    let createSrv = (name) => {
        return {
            Name: name,
            Type: 'SRV',
            TTL: config.ttl,
            ResourceRecords: []
        }
    }

    return new Promise((resolve, reject) => {

        //** return two fresh new SRV records 
        resolve([
            createSrv(`_etcd-client._tcp.${config.domain}`),
            createSrv(`_etcd-server._tcp.${config.domain}`)
        ]);

    });
}
 
function createClusterDNS(records) {
    let client = records.find((record) => { return /_etcd.client.*/.test(record.Name) });
    let server = records.find((record) => { return /_etcd.server.*/.test(record.Name) });
    let createBatch = (srv) => {
        return {
            Action: 'UPSERT',
            ResourceRecordSet: srv
        }
    };

    //** add/ensure an entry for each node in the cluster
    for(var i=1;i<=config.clusterSize;i++) {
        client.ResourceRecords.push({ Value: `10 20 2379 ${config.dnsPrefix}-${i}.${config.domain}` });
        server.ResourceRecords.push({ Value: `10 20 2380 ${config.dnsPrefix}-${i}.${config.domain}` });
    }

    //** build the params array for the route53 api
    let params = {
        ChangeBatch: {
            Changes: [
                createBatch(client),
                createBatch(server)
            ]
        }, 
        HostedZoneId: config.hostedZoneId
    }

    console.log('updating dns');

    return new Promise((resolve, reject) => {

        //** update the DNS record via the route53 api
        route53.changeResourceRecordSets(params, (err, data) => {
            if(!!err) {
                console.error(err);
                return rejecft(err);
            }

            resolve({ client: client, server: server });
        });

    });
}
