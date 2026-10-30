import { GetDb } from "../db";
import { logger } from "../logger";

// Time each account spends in the game, for the launcher's playtime (GET /undaunted/api/GetUserInfo,
// PlaytimeSeconds). It is counted here from the client heartbeats (POST /heartbeat, every 20 s), so
// a player cannot change it on their own PC.
//
// - Each player heartbeat adds the time since that account's previous one. A gap longer than
//   MAX_GAP_MS (a closed game, a dropped connection, a long loading screen) adds nothing, so time
//   away is never counted; at most one heartbeat interval is lost each time.
// - Two clients on one account count once: a heartbeat less than MIN_GAP_MS after the last one adds
//   nothing.
// - The seconds are kept in memory and written to account_playtime every FLUSH_MS (and by
//   FlushPlaytime at shutdown), so a crash loses at most that.

export const MAX_GAP_MS = 60_000;
export const MIN_GAP_MS = 5_000;
export const FLUSH_MS = 60_000;

const LastBeat = new Map<string, number>();
const Pending = new Map<string, number>(); // milliseconds not written yet
let Timer: ReturnType<typeof setInterval> | null = null;

export function RecordPlaytimeBeat(UserId: string, Now = Date.now()){
    const Last = LastBeat.get(UserId);
    if(Last !== undefined && Now - Last < MIN_GAP_MS) return;
    LastBeat.set(UserId, Now);
    if(Last !== undefined && Now - Last <= MAX_GAP_MS){
        Pending.set(UserId, (Pending.get(UserId) ?? 0) + (Now - Last));
    }
    if(Timer === null){
        Timer = setInterval(() => FlushPlaytime(), FLUSH_MS);
        Timer.unref?.();
    }
    // Accounts not heard from for a while: their last heartbeat no longer counts for anything
    if(LastBeat.size > 64){
        for(const [Id, At] of LastBeat){
            if(Now - At > MAX_GAP_MS && !Pending.has(Id)) LastBeat.delete(Id);
        }
    }
}

// Writes the counted seconds; the remainder under a second waits for the next flush.
export function FlushPlaytime(Now = Date.now()){
    if(Pending.size === 0) return;
    try{
        const Db = GetDb().$client;
        const Add = Db.prepare(`INSERT INTO account_playtime(account_id,seconds,updated_at)
            SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE userId=?)
            ON CONFLICT(account_id) DO UPDATE SET seconds=seconds+excluded.seconds,updated_at=excluded.updated_at`);
        Db.transaction(() => {
            for(const [Id, Ms] of Pending){
                const Seconds = Math.floor(Ms / 1000);
                if(Seconds > 0) Add.run(Id, Seconds, Now, Id);
                const Left = Ms - Seconds * 1000;
                if(Left > 0) Pending.set(Id, Left);
                else Pending.delete(Id);
            }
        })();
    }
    catch(e){
        logger.warn(`Playtime not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// Saved seconds plus what is counted but not written yet.
export function GetPlaytimeSeconds(UserId: string): number {
    const Row = GetDb().$client.prepare("SELECT seconds FROM account_playtime WHERE account_id=?").get(UserId) as { seconds: number } | undefined;
    return (Row?.seconds ?? 0) + Math.floor((Pending.get(UserId) ?? 0) / 1000);
}

// For tests
export function ResetPlaytimeTracking(){
    LastBeat.clear();
    Pending.clear();
    if(Timer !== null) clearInterval(Timer);
    Timer = null;
}
