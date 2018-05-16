/*
etcd-route53-node-init
---

Runs within a container on etcd cluster nodes in EC2 during boot; manages DNS SRV records in Route53 for maintainable discovery in a fluid cluster

this process expects the following 3 environment variables set:
    - HOST - the hostname of this host, private preferably
    - HOSTED_ZONE_ID - the id of the route53 zone we're updating
    - DOMAIN - the domain that DNS is managing; this is used to create new SRV records

mikejmacmillan@gmail.com
*/

const AWS = require('aws-sdk');
const route53 = new AWS.Route53();

//** credentials for aws-sdk are provided via ENV variables

//** localize some environment variables in config
const config = {
    hostname: process.env.HOSTNAME,
    hostedZoneId: process.env.HOSTED_ZONE_ID,
    domain: process.env.DOMAIN,
    ttl: process.env.TTL || 60
}

console.log('getting dns records');

//** retrieve the current dns record sets
route53.listResourceRecordSets({
    HostedZoneId: config.hostedZoneId 
}, (err, data) => {
    if(!!err) {
        console.log(err);
        throw new Error(err);
    }

    console.log('finding existing SRV records');

    //** get the SRV dns records, initializing a new record if none found
    let srv = (data.ResourceRecordSets || []).filter((item) => { return item.Type == 'SRV' });
    console.log(`  - found ${srv.length} record(s)`);

    //** provide the defaults
    srv.length == 0 && (srv = [
        createSrv('_etcd-client._tcp.'+ config.domain),
        createSrv('_etcd-server._tcp.'+ config.domain)
    ]);

    //** find the client and server record
    let clientSrv = srv.find((item) => /_etcd-client.*/.test(item.Name));
    let serverSrv = srv.find((item) => /_etcd-server.*/.test(item.Name));

    //** backfill either that's missing
    !clientSrv && srv.push(clientSrv = createSrv(`_etcd-client._tcp.${config.domain}`));
    !serverSrv && srv.push(serverSrv = createSrv(`_etcd-server._tcp.${config.domain}`));

    let gex = new RegExp('.*?'+ config.hostname.replace(/\./g, '\\.'));

    //** see if the client/server SRV records contains the hostname 
    let clientExists = clientSrv.ResourceRecords.find((item) => { return gex.test(item.Value) });
    let serverExists = serverSrv.ResourceRecords.find((item) => { return gex.test(item.Value) });

    //** if we're good to go, quit
    if(!!clientExists && !!serverExists)
        return console.log('SRV records are correct; no updates performed');

    //** build the params array for the route53 api
    let params = {
        ChangeBatch: {
            Changes: []
        }, 
        HostedZoneId: config.hostedZoneId
    }

    //** check/add the client/server SRV records for this node
    if(!clientExists) {
        clientSrv.ResourceRecords.push({ Value: '1 10 2379 '+ config.hostname});
        params.ChangeBatch.Changes.push(createBatch(clientSrv));
        console.log('client SRV record missing; added');
    }

    if(!serverExists) {
        serverSrv.ResourceRecords.push({ Value: '1 10 2380 '+ config.hostname });
        params.ChangeBatch.Changes.push(createBatch(serverSrv));
        console.log('server SRV record missing; added');
    }

    console.log('updating dns');

    //** update the DNS record via the route53 api
    route53.changeResourceRecordSets(params, (err2, data2) => {
        if(!!err2) {
            console.error(err2);
            throw new Error(err2);
        }

        console.log('hostname added discovery SRV:', config.hostname);
    });
});

//** a few shortcuts

function createSrv(name) {
    return {
            Name: name,
            Type: 'SRV',
            TTL: config.ttl,
            ResourceRecords: []
    }
}

function createBatch(srv) {
    return {
        Action: 'UPSERT',
        ResourceRecordSet: srv
    }
}
