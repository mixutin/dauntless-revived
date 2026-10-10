import {createConnection} from 'node:net';
import {performance} from 'node:perf_hooks';
import {Endpoint, request, parseJsonBody} from './http';
import {isValidHost} from '../shared/invite';

type Region = 'main' | 'aus' | 'ger' | 'us';
export type RegionProbe = {region:Region, host:string, port:number};
export function tcpLatency(probe:RegionProbe):Promise<number> {
    return new Promise(resolve => {
        const start=performance.now();
        const socket=createConnection({host:probe.host,port:probe.port});
        let done=false;
        const timer=setTimeout(()=>finish(Infinity),1500);
        const finish=(value:number) => { if(done)return; done=true; clearTimeout(timer); socket.destroy(); resolve(value); };
        socket.setTimeout(1500,()=>finish(Infinity));
        socket.once('error',()=>finish(Infinity));
        socket.once('connect',()=>finish(performance.now()-start));
    });
}
export async function fastestRegion(probes:RegionProbe[], measure=tcpLatency):Promise<Region|undefined> {
    const readings=await Promise.all(probes.map(async probe => {
        await measure(probe).catch(()=>Infinity);
        const latency=await measure(probe).catch(()=>Infinity);
        return {region:probe.region,latency};
    }));
    return readings.filter(r=>Number.isFinite(r.latency) && r.latency>=0).sort((a,b)=>a.latency-b.latency)[0]?.region;
}
export async function chooseClosestRegion(ep:Endpoint,key:string):Promise<Region|undefined> {
    try {
        const response=await request(ep,'/undaunted/api/HuntRegion',{
            headers:{'x-undaunted-user-api-key':key},timeoutMs:5000,maxBytes:8192
        });
        if(response.status!==200)return undefined;
        const body=parseJsonBody(response) as any;
        const probes:RegionProbe[]=[{region:'main',host:ep.host,port:ep.port}];
        if(Array.isArray(body?.probes)) for(const candidate of body.probes.slice(0,3)) {
            if(!candidate || !['main','aus','ger','us'].includes(candidate.region) || !isValidHost(candidate.host)
                || !Number.isInteger(candidate.port) || candidate.port<1 || candidate.port>65535)continue;
            const index=probes.findIndex(p=>p.region===candidate.region);
            if(index>=0)probes.splice(index,1);
            probes.push({region:candidate.region,host:candidate.host,port:candidate.port});
        }
        return await fastestRegion(probes) ?? (['main','aus','ger','us'].includes(body?.region) ? body.region : undefined);
    } catch { return undefined; }
}
