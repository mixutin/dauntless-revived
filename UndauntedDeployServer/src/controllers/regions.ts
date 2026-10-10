import { CapacityUnavailable } from './capacity';
import { RemoteLaunch, ReadWorkerSnapshot, GameserverSnapshot } from './overflow';

export type RegionChoice = 'main' | 'aus' | 'ger' | 'us' | 'mixed';
type Request = Parameters<typeof RemoteLaunch>[1];
type Load = {running:number,pending:number,limit:number|null};
export function AusUrl(region: 'aus' | 'ger' | 'us' = 'aus') {
    const setting = region === 'us' ? 'US_DEPLOYSERVER_URL' : region === 'ger' ? 'GERMANY_DEPLOYSERVER_URL' : 'AUS_DEPLOYSERVER_URL';
    if (!process.env[setting]) return undefined;
    const url = new URL(process.env[setting]!);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error(`${setting} must be an HTTP loopback tunnel`);
    return url;
}
export function Utilization(load: Load) {
    return load.limit && load.limit > 0 ? (load.running + load.pending) / load.limit : Infinity;
}
export async function DescribeAusSnapshot(region: 'aus' | 'ger' | 'us' = 'aus'): Promise<GameserverSnapshot> {
    const url = AusUrl(region);
    if (!url) return {servers: [], complete: true};
    const snapshot = await ReadWorkerSnapshot(url);
    return {...snapshot, servers: snapshot.servers.map(server => ({...server, host: region, region}))};
}
export async function DescribeAus(region: 'aus' | 'ger' | 'us' = 'aus'): Promise<any[]> {
    return (await DescribeAusSnapshot(region)).servers;
}
export class RegionalRouter {
    constructor(private mainLoad: () => Promise<Load>, private remote = RemoteLaunch,
        private ausLoad = async (url: URL): Promise<Load> => {
            const response = await fetch(new URL('/gameservers', url), {signal:AbortSignal.timeout(2000),redirect:'error'});
            if (!response.ok) throw new Error('AUS capacity unavailable');
            const body = await response.json() as {capacity:Load};
            if (!body.capacity || !Number.isFinite(body.capacity.running) || !Number.isFinite(body.capacity.pending)) throw new Error('Invalid AUS capacity');
            return body.capacity;
        }) {}
    async launch<T>(body: Request, choice: RegionChoice, main: () => Promise<T>): Promise<T | NonNullable<Awaited<ReturnType<typeof RemoteLaunch>>>> {
        if (choice === 'ger' || choice === 'us') {
            const germany = AusUrl(choice);
            if (!germany) throw new CapacityUnavailable('hunts');
            const connection = await this.remote(germany, body);
            if (!connection) throw new CapacityUnavailable('hunts');
            const expectedHost = process.env[choice === 'us' ? 'US_PUBLIC_HOST' : 'GERMANY_PUBLIC_HOST'];
            if (expectedHost && connection.host !== expectedHost)
                throw new Error('Regional worker returned a destination outside the selected region');
            return connection;
        }
        const primary = main;
        main = async () => {
            try { return await primary(); }
            catch (error) {
                if (!(error instanceof CapacityUnavailable)) throw error;
                const germany = AusUrl('ger');
                const connection = germany && await this.remote(germany, {...body, Overflow:true});
                if (connection) return connection as T;
                throw error;
            }
        };
        const url = AusUrl();
        if (!['ISLAND','CITY','SHARED'].includes(body.GameMode)) return main();
        if (!url) { if (choice === 'aus') throw new CapacityUnavailable('hunts'); return main(); }
        let ausFirst = choice === 'aus';
        if (choice === 'mixed') {
            try {
                const [primary, aus] = await Promise.all([this.mainLoad(), this.ausLoad(url)]);
                ausFirst = Utilization(aus) < Utilization(primary);
            } catch { ausFirst = false; }
        }
        if (ausFirst) {
            const connection = await this.remote(url, body);
            if (connection) {
                if (choice === 'aus' && process.env.AUS_PUBLIC_HOST && connection.host !== process.env.AUS_PUBLIC_HOST)
                    throw new Error('AUS worker returned a destination outside the selected region');
                return connection;
            }
            if (choice === 'aus') throw new CapacityUnavailable('hunts');
            return main();
        }
        try { return await main(); }
        catch (error) {
            if (!(error instanceof CapacityUnavailable)) throw error;
            // EU overflow must leave slots for players who explicitly selected OCE.
            const reserve=Number(process.env.AUS_RESERVED_HUNTS??0);
            if(!Number.isSafeInteger(reserve)||reserve<0)throw new Error('Invalid AUS_RESERVED_HUNTS');
            if(reserve>0 && body.GameMode==='ISLAND') {
                try {const load=await this.ausLoad(url);if(load.limit===null||load.limit-load.running-load.pending<=reserve)throw error;}
                catch {throw error;}
            }
            const connection = await this.remote(url, {...body, Overflow:true});
            if (connection) return connection;
            throw error;
        }
    }
}
