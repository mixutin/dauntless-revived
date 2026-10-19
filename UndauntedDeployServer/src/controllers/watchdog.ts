import { logger } from "../logger";
import { Gameservers, CleanupServer, IsGameserverAlive, StopExpiredHunt } from "./gameservers";
import { NativeOccupancy } from './nativeoccupancy';
import { HuntLifetimeFromEnv } from './huntlifetime';
const Lifetime=HuntLifetimeFromEnv();

// For GET /gameservers. The watchdog owns the only instance that has been observing these
// intervals, so the answer has to come from here rather than being recomputed per request.
export function EmptyForMs(id:string, now=Date.now()){
    return Lifetime.EmptyFor(id, now);
}

/**
 * TODO:
 * This watchdog is SUPER basic rn, only releases resources, the server itself handles cleaning itself up
 */

let running = false;
export async function RunWatchdog(){
    if (running) return;
    running = true;
    const cleanup: Promise<unknown>[] = [];
    try {
    logger.info(`Running Gameserver Watchdog!`);
    Lifetime.prune(new Set(Gameservers.map(server=>server.id)));

    for(const Gameserver of Gameservers){
        if(!IsGameserverAlive(Gameserver)){
            console.log(`Cleaning up Gameserver on port ${Gameserver.port}`);

            // A restart of Ramsgate or the Dojo that fails is logged; it must not end the deploy server
            cleanup.push(CleanupServer(Gameserver).catch((error) => logger.error(`Could not restart the game server on port ${Gameserver.port}: ${error instanceof Error ? error.message : String(error)}`)));
        }
        else {
            const reason=Lifetime.reason(Gameserver,NativeOccupancy(Gameserver.processId,Gameserver.startTime));
            if(reason){
                try {if(StopExpiredHunt(Gameserver))logger.warn({port:Gameserver.port,reason,ageMinutes:(Date.now()-Gameserver.startTime.getTime())/60000},'Hunt lifetime limit: stopping instance');}
                catch(error){logger.error({error,port:Gameserver.port},'Could not stop expired hunt');}
            }
        }
    }
    await Promise.all(cleanup);
    } finally { running = false; }
}
