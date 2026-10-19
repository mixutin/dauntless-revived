type Hunt = {id:string;isRamsgate:boolean;isTrainingDojo:boolean;startTime:Date;readyAt?:number};

// Why a temporary world is retired. Each one is a different kind of proof:
//  'empty'   - continuously observed zero connections. The strongest signal, and the usual one.
//  'silent'  - no telemetry at all, while other instances on this host are still reporting. The
//              process is hung or never listened, so neither its own idle timer nor 'empty' can
//              ever end it.
//  'max-age' - the documented ceiling. Occupancy does not matter: nothing legitimate runs this long.
export type HuntRetirement = 'empty'|'silent'|'max-age';

// How recently some instance has to have reported for silence to mean anything. With native
// diagnostics switched off every instance reads undefined, and none of them may be touched.
const TELEMETRY_WINDOW_MS = 10*60000;

// A gap this long between two observations breaks the interval: a watchdog round that did not run
// (or a clock that went backwards) is not evidence of anything continuous.
const OBSERVATION_GAP_MS = 90000;

export class HuntLifetime {
    private emptySince = new Map<string,{since:number,last:number}>();
    private silentSince = new Map<string,{since:number,last:number}>();
    // When any instance last reported a real count, i.e. when telemetry last demonstrably worked.
    // Until one does, no amount of silence is evidence of anything.
    private telemetryAt = Number.NEGATIVE_INFINITY;

    constructor(private maxAgeMs=120*60000, private emptyMs=2*60000, private startupGraceMs=0,
                private silentMs=15*60000, private unreadyGraceMs=5*60000) {}

    prune(ids:Set<string>) {
        for(const id of this.emptySince.keys())if(!ids.has(id))this.emptySince.delete(id);
        for(const id of this.silentSince.keys())if(!ids.has(id))this.silentSince.delete(id);
    }

    reason(server:Hunt, connections:number|undefined, now=Date.now()): HuntRetirement|undefined {
        if(server.isRamsgate || server.isTrainingDojo)return;
        if(connections!==undefined && now>this.telemetryAt)this.telemetryAt=now;

        // The ceiling from HUNT_MAX_AGE_MINUTES, which the documented contract applies to occupied
        // instances too. Past it the process is holding a port and its memory whether or not anyone
        // is still attached, and no hunt lasts hours.
        if(now-server.startTime.getTime()>=this.maxAgeMs){this.forget(server.id);return 'max-age';}

        // A process that never wrote its ready file never got its net driver listening, and the
        // DLL's own idle shutdown is gated on listening. Judge it on occupancy like any other
        // instance once it has had its grace, instead of exempting it forever.
        const settled = (server.readyAt ?? server.startTime.getTime()+this.unreadyGraceMs)+this.startupGraceMs;
        if(now<settled){this.forget(server.id);return;}

        if(connections===undefined){
            this.emptySince.delete(server.id);
            if(now-this.telemetryAt>TELEMETRY_WINDOW_MS){this.silentSince.delete(server.id);return;}
            return this.elapsed(this.silentSince,server.id,now,this.silentMs)?'silent':undefined;
        }

        this.silentSince.delete(server.id);
        if(connections!==0){this.emptySince.delete(server.id);return;}
        return this.elapsed(this.emptySince,server.id,now,this.emptyMs)?'empty':undefined;
    }

    // How long this instance has been continuously observed empty, or undefined when it is not
    // empty or has not been seen empty yet. The launcher shows a world's age, which says nothing
    // about whether anyone is in it: a hunt that ran for ten minutes and emptied a moment ago
    // looks exactly like one that was never occupied.
    EmptyFor(id:string, now=Date.now()): number|undefined {
        const span=this.emptySince.get(id);
        return span===undefined ? undefined : Math.max(0, now-span.since);
    }

    private forget(id:string){this.emptySince.delete(id);this.silentSince.delete(id);}

    private elapsed(spans:Map<string,{since:number,last:number}>, id:string, now:number, needed:number) {
        let span=spans.get(id);
        if(!span||now<span.last||now-span.last>OBSERVATION_GAP_MS){span={since:now,last:now};spans.set(id,span);}
        span.last=now;
        return now-span.since>=needed;
    }
}

export function HuntLifetimeFromEnv(env:NodeJS.ProcessEnv=process.env) {
    const minutes=(name:string,fallback:number)=>{
        const value=env[name]===undefined?fallback:Number(env[name]);
        if(!Number.isInteger(value)||value<1||value>1440)throw new Error(`Invalid ${name}`);
        return value*60000;
    };
    return new HuntLifetime(minutes('HUNT_MAX_AGE_MINUTES',120),minutes('HUNT_EMPTY_MINUTES',2),
        env.HUNT_STARTUP_GRACE_MINUTES===undefined?0:minutes('HUNT_STARTUP_GRACE_MINUTES',1),
        minutes('HUNT_SILENT_MINUTES',15),minutes('HUNT_UNREADY_GRACE_MINUTES',5));
}
