import {CityPool, CITY_PLAYER_LIMIT} from './citypool';
import {NativeCityOccupancy} from './nativeoccupancy';
import {CheckCpuAdmission} from './cpuadmission';
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { setTimeout } from "node:timers/promises";
import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IsUdpPortBound, WaitForServerReady } from "./readiness";

import crypto from "node:crypto";

import PlayerHuntTable from "../vendor/player_hunts_table.json";
import MatchmakerHuntTable from "../vendor/matchmaker_hunts_table.json";
import TrialsHardHuntTable from "../vendor/trials_hard_table.json";
import TrialsEliteHuntTable from "../vendor/trials_elite_table.json";
import TrialsPool from "../vendor/trials_pool.json";
import { kill } from "node:process";
import { logger } from "../logger";
import { CapacityUnavailable, memoryAdmission, HuntAdmission } from './capacity';

const RAMSGATE_MAP_PATH = "/Game/Maps/ramsgate/ramsgate_01_persistent";
const TRAINING_DOJO_MAP_PATH = "/Game/Maps/islands/dojo/training_dojo_persistent";
const TRIALS_MAP_PATH = "/Game/Maps/islands/arenas/arena_ramsgate_00";

export type Gameserver = {
    id: string,
    port: number,
    map: string,
    behemoth: string | undefined,
    matchmakerHuntId: string | undefined,
    expectedPlayers: ExpectedPlayer[] | undefined,
    isRamsgate: boolean,
    isTrainingDojo: boolean,
    processId: number,
    startTime: Date
};

type ExpectedPlayer = {
    playerUid: string,
    playerHuntId: string
};

export let Gameservers: Gameserver[] = [];
export function CityPoolEnabled() { return process.env.RAMSGATE_POOL !== '0'; }
const SpawnedChildren = new Map<string,ChildProcess>();
export function StopExpiredHunt(server:Gameserver):boolean {
    if(!Gameservers.includes(server)||server.isRamsgate||server.isTrainingDojo)return false;
    const child=SpawnedChildren.get(server.id);
    return !!child && child.pid===server.processId && child.exitCode===null && !child.killed && child.kill();
}
let FreePorts: number[] = [];

let RamsgateServer : Gameserver | undefined;
let TrainingDojoServer : Gameserver | undefined;

// How game processes are started and checked. Tests swap in stand-ins (UseProcessFunctionsForTests);
// nothing else changes them.
type SpawnFunction = (Command: string, Args: string[], Options: SpawnOptions) => ChildProcess;
let SpawnProcess: SpawnFunction = spawn;
let ProcessIsAlive: (ProcessId: number) => boolean = (ProcessId) => IsProcessAlive(ProcessId);
let PortIsBound: (Port: number) => Promise<boolean> = IsUdpPortBound;

const PORT_RANGE_BEGIN = Number(process.env.PORT_RANGE_BEGIN!);
const PORT_RANGE_END = Number(process.env.PORT_RANGE_END!);
const RAMSGATE_PORT = PORT_RANGE_END;
const TRAINING_DOJO_PORT = PORT_RANGE_END - 1;
const GAMESERVER_BINARY_PATH = process.env.GAMESERVER_BINARY_PATH!;
const STANDARD_GAMESERVER_ARGS = ["-EpicPortal", "-server", "-nullrhi"];
const METAGAME_API_KEY = process.env.METAGAME_API_KEY!;
const MY_IP = process.env.MY_IP!;
const SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP = Number(process.env.SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP!);

function GameserverStartupTimeoutMs(){
    const Raw = process.env.GAMESERVER_STARTUP_GRACE_MS;
    if(Raw === undefined){
        return 90000;
    }

    const Value = Number(Raw);

    if(!/^\d+$/.test(Raw) || !Number.isSafeInteger(Value) || Value < 0 || Value > 180000){
        throw new Error("Invalid GAMESERVER_STARTUP_GRACE_MS");
    }

    return Value;
}

async function TakeHuntPort(){
    const Busy: number[] = [];

    while(FreePorts.length > 0){
        const Port = FreePorts.pop()!;

        if(!(await PortIsBound(Port))){
            FreePorts.unshift(...Busy);
            return Port;
        }

        Busy.push(Port);
    }

    FreePorts.unshift(...Busy);
    throw new CapacityUnavailable('ports');
}

function TransformExpectedPlayerArgs(ExpectedPlayers: ExpectedPlayer[]){
    let ToReturn = "";

    for(const Player of ExpectedPlayers){
        ToReturn = ToReturn + Player.playerUid + ":" + Player.playerHuntId + ",";
    }

    if(ToReturn.length > 0){
        ToReturn = ToReturn.slice(0, -1); // Remove trailing ','
    }

    return ToReturn;
}

// Called by the watchdog for a server whose process has exited. Ramsgate is started
// again (through the same shared launch as a player's request, so the two never start two processes
// on one port); a hunt's port goes back to the pool.
export async function CleanupServer(ServerToShutdown: Gameserver){
    if (!Gameservers.includes(ServerToShutdown)) return; // exit event and watchdog may race
    SpawnedChildren.delete(ServerToShutdown.id);
    if (ServerToShutdown.isRamsgate && process.env.GAMESERVER_READY_DIR)
        void unlink(path.join(process.env.GAMESERVER_READY_DIR, `city-occupancy-${ServerToShutdown.processId}.txt`)).catch(() => {});
    Gameservers = Gameservers.filter(Server => Server !== ServerToShutdown);

    if(ServerToShutdown.isRamsgate && CityPoolEnabled()){
        if (RamsgateServer === ServerToShutdown) RamsgateServer = undefined;
        if (ServerToShutdown.port !== RAMSGATE_PORT) FreePorts.push(ServerToShutdown.port);
    }
    else if(ServerToShutdown.isRamsgate){
        await EnsurePersistentWorld("ramsgate", "RAMSGATE HAS FALLEN! Restarting!");
    }
    else if(ServerToShutdown.isTrainingDojo){
        // The next SHARED request starts the Dojo on demand.
        if (TrainingDojoServer === ServerToShutdown) TrainingDojoServer = undefined;
    }
    else{
        FreePorts.push(ServerToShutdown.port);
    }
}

// Ramsgate and the Training Dojo: one process each, on a fixed port
type PersistentWorld = "ramsgate" | "dojo";

// The launch of a persistent world that is under way. The watchdog, CITY and SHARED requests and the
// Dojo's first start all wait for this one launch instead of starting their own.
const PersistentWorldLaunches = new Map<PersistentWorld, Promise<Gameserver>>();

function CurrentPersistentWorld(World: PersistentWorld){
    return World === "ramsgate" ? RamsgateServer : TrainingDojoServer;
}

// The record of a restarted world is stored here, so the next check looks at the new process.
// (Upstream's watchdog restart kept the old record, whose process had exited.)
function EnsurePersistentWorld(World: PersistentWorld, Why?: string, Level: "info" | "warn" = "warn"): Promise<Gameserver> {
    const Launching = PersistentWorldLaunches.get(World);

    if(Launching !== undefined){
        return Launching;
    }

    const Current = CurrentPersistentWorld(World);

    if(Current !== undefined && ProcessIsAlive(Current.processId)){
        return Promise.resolve(Current);
    }

    if(Current !== undefined){
        Gameservers = Gameservers.filter(Server => Server !== Current);
    }

    if(Why !== undefined){
        logger[Level](Why);
    }

    const IsRamsgate = World === "ramsgate";
    const DojoHuntId = IsRamsgate ? undefined : TRAINING_DOJO_MATCHMAKER_HUNT_ID;
    const WorldMap = IsRamsgate ? RAMSGATE_MAP_PATH
        : `${TRAINING_DOJO_MAP_PATH}?game=${GetGameModeOverrideFromMatchmakerHuntId(DojoHuntId!)}?MaxPlayers=${MaxPlayersFromTables(DojoHuntId!)}`;
    // Shared worlds have no fixed roster, but Training Grounds still needs its hunt rules and mode.
    const Launch = StartServer(WorldMap, undefined, DojoHuntId, undefined, IsRamsgate, !IsRamsgate)
        .then((Started) => {
            if(IsRamsgate){
                RamsgateServer = Started;
            }
            else{
                TrainingDojoServer = Started;
            }

            return Started;
        })
        .finally(() => { PersistentWorldLaunches.delete(World); });

    PersistentWorldLaunches.set(World, Launch);

    return Launch;
}

// The liveness check, the stored record of a restarted world and the error and exit listeners below
// follow Harmonic's fork (github.com/Harmonicrain/Undaunted 895f7c7), rebuilt around one shared launch.
//
// On (the default) unless PERSISTENT_WORLD_LIVENESS=0: before Ramsgate or the Dojo is handed to a
// player, its process must still be running, or it is started again first. Without the check a dead
// Ramsgate went unnoticed until the watchdog's next round (up to 60 s), and every player sent there in
// the meantime travelled to a port nothing listened on. 0 leaves restarts to the watchdog, as before.
export function IsPersistentWorldLivenessOn(){
    return process.env.PERSISTENT_WORLD_LIVENESS !== "0";
}

let ServerLaunchQueue: Promise<unknown> = Promise.resolve();
let NextServerLaunchAt = 0;
export const huntAdmission = new HuntAdmission(() => Gameservers.filter(server => !server.isRamsgate && !server.isTrainingDojo && ProcessIsAlive(server.processId)).length);

function StartServer(Map: string, Behemoth: string | undefined, MatchmakerHuntId: string | undefined, ExpectedPlayers: ExpectedPlayer[] | undefined, IsRamsgate: boolean, IsTrainingDojo: boolean){
    if(process.env.SERVER_ROLE === "database-only") throw new Error("Game allocation disabled on database-only node");
    if (!IsRamsgate && !IsTrainingDojo) CheckCpuAdmission();
    const ReleaseHunt = !IsRamsgate && !IsTrainingDojo ? huntAdmission.reserve() : () => {};
    const Previous = ServerLaunchQueue;
    let ReleaseLaunch!: () => void;
    ServerLaunchQueue = new Promise<void>(Resolve => { ReleaseLaunch = Resolve; });
    return Previous.catch(() => {}).then(async () => {
        if (!IsRamsgate && !IsTrainingDojo && FreePorts.length === 0) throw new CapacityUnavailable('ports');
        const Wait = NextServerLaunchAt - Date.now();
        if (Wait > 0) await setTimeout(Wait);
        return StartServerNow(Map, Behemoth, MatchmakerHuntId, ExpectedPlayers, IsRamsgate, IsTrainingDojo, () => {
            ReleaseHunt();
            NextServerLaunchAt = Date.now() + SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP * 1000;
            ReleaseLaunch();
        });
    }).finally(() => { ReleaseHunt(); ReleaseLaunch(); });
}

async function StartServerNow(Map: string, Behemoth: string | undefined, MatchmakerHuntId: string | undefined, ExpectedPlayers: ExpectedPlayer[] | undefined, IsRamsgate: boolean, IsTrainingDojo: boolean, Spawned: () => void){

    const ReadyDir = process.env.GAMESERVER_READY_DIR ?? path.join(tmpdir(), `dauntless-revived-ready-${process.pid}`);
    process.env.GAMESERVER_READY_DIR ??= ReadyDir;
    await mkdir(ReadyDir, { recursive: true, mode: 0o700 });
    if (!IsRamsgate && !IsTrainingDojo && FreePorts.length === 0) throw new CapacityUnavailable('ports');
    if (!IsRamsgate && !IsTrainingDojo) CheckCpuAdmission();
    const ReleaseReservation = memoryAdmission.reserve(!IsRamsgate && !IsTrainingDojo);
    
    let Port;

    if(IsRamsgate){
        try {
            Port = CityPoolEnabled() && (Gameservers.some(s => s.isRamsgate && s.port === RAMSGATE_PORT && ProcessIsAlive(s.processId)) || await PortIsBound(RAMSGATE_PORT))
                ? await TakeHuntPort() : RAMSGATE_PORT;
        } catch(error) { ReleaseReservation(); throw error; }
    }
    else if(IsTrainingDojo){
        Port = TRAINING_DOJO_PORT;
    }
    else{
        try { Port = await TakeHuntPort(); } catch(error) { ReleaseReservation(); throw error; }
    }

    const Id = crypto.randomUUID();
    const ReadyFile = path.join(ReadyDir, `${Id}.ready`);

    if(Port == undefined){
        ReleaseReservation();
        throw new CapacityUnavailable('ports');
    }

    const IsHunt = !IsRamsgate && !IsTrainingDojo;
    const BorrowedPort = !IsTrainingDojo && Port !== RAMSGATE_PORT;

    if(!IsHunt && await PortIsBound(Port)){
        ReleaseReservation();
        if (BorrowedPort) FreePorts.push(Port);
        throw new Error(`Persistent game server port ${Port} is already in use; refusing to reuse a stale listener`);
    }

    let Child: ChildProcess;
    await unlink(ReadyFile).catch(() => {});

    try{
        Child = SpawnProcess(GAMESERVER_BINARY_PATH, [
            METAGAME_API_KEY,
            Port.toString(),
            Map,
            Behemoth != undefined ? Behemoth : "NO_BEHEMOTH",
            MatchmakerHuntId != undefined ? MatchmakerHuntId : "NO_MM_HUNTID",
            ExpectedPlayers != undefined ? TransformExpectedPlayerArgs(ExpectedPlayers) : "NO_EXPECTED_PLAYERS",
            MY_IP + ":" + Port.toString(),
            ...STANDARD_GAMESERVER_ARGS
        ], {
            // Keep the long-running Ramsgate and Dojo diagnostic windows visible,
            // but do not flash a new command window for every temporary hunt.
            windowsHide: IsHunt,
            env: { ...process.env, GAMESERVER_READY_DIR: ReadyDir, DR_SERVER_READY_FILE: ReadyFile, DR_RAMSGATE_POOL: CityPoolEnabled() ? '1' : '0' }
        });
    }
    catch(error){
        ReleaseReservation();
        if(BorrowedPort){
            FreePorts.push(Port);
        }

        logger.error(`Could not start a game server on port ${Port}: ${(error as Error)?.message}`);
        throw new Error(`Could not start a game server on port ${Port}`);
    }

    // A process that cannot be started (a wrong GAMESERVER_BINARY_PATH, a missing file) reports it
    // as an "error" event. Without a listener that event took the whole deploy server down.
    Child.on("error", (error) => { ReleaseReservation(); logger.error(`Game server on port ${Port} failed: ${error.message} (GAMESERVER_BINARY_PATH is ${GAMESERVER_BINARY_PATH})`); });
    Child.on("exit", (Code, Signal) => {
        SpawnedChildren.delete(Id);
        ReleaseReservation();
        void unlink(ReadyFile).catch(() => {});
        // Release hunt ports immediately instead of waiting up to 60s for the watchdog.
        if (IsHunt || IsTrainingDojo || (IsRamsgate && CityPoolEnabled())) {
            const Finished = Gameservers.find(Server => Server.id === Id);
            if (Finished) void CleanupServer(Finished);
        }
        const Line = `Game server on port ${Port} (pid ${Child.pid}) exited ${Signal != null ? `on ${Signal}` : `with code ${Code}`}`;

        if(Code === 0){
            logger.info(Line);
        }
        else{
            logger.warn(Line);
        }
    });

    Child.unref();

    // No process id: the start failed and the "error" event follows. Nothing runs on the port, so a
    // hunt's port goes back to the pool and the caller (the matchmaking call) gets an error, which the
    // metagame reports to the player as FAILED instead of an address nothing listens on.
    if(Child.pid === undefined){
        ReleaseReservation();
        if(BorrowedPort){
            FreePorts.push(Port);
        }

        throw new Error(`Could not start a game server on port ${Port}`);
    }

    const NewGameserver: Gameserver = {
        id: Id,
        port: Port,
        map: Map,
        behemoth: Behemoth,
        matchmakerHuntId: MatchmakerHuntId,
        expectedPlayers: ExpectedPlayers,
        isRamsgate: IsRamsgate,
        isTrainingDojo: IsTrainingDojo,
        processId: Child.pid,
        startTime: new Date()
    };

    Gameservers.push(NewGameserver);
    SpawnedChildren.set(Id,Child);
    Spawned();
    try {
        const TimeoutMs = GameserverStartupTimeoutMs();
        if (TimeoutMs > 0) {
            await WaitForServerReady(Child, Port, ReadyFile, TimeoutMs);
            ReleaseReservation();
        }
    } catch (error) {
        if (Gameservers.includes(NewGameserver) && Child.pid && ProcessIsAlive(Child.pid)) Child.kill();
        else if (IsHunt || (IsRamsgate && CityPoolEnabled())) await CleanupServer(NewGameserver);
        throw error;
    }

    return NewGameserver;
}

const CityInstances = new CityPool<Gameserver>(
    () => Gameservers.filter(s => s.isRamsgate && ProcessIsAlive(s.processId)).map(s => ({
        id:s.id, players:NativeCityOccupancy(s.processId,s.startTime), startedAt:s.startTime.getTime()
    })),
    () => StartServer(`${RAMSGATE_MAP_PATH}?MaxPlayers=${CITY_PLAYER_LIMIT}`, undefined, undefined, undefined, true, false),
    id => Gameservers.find(s => s.id === id)!
);

export async function GetRamsgateConnectionDetails(size = 1){
    if (CityPoolEnabled()) {
        const server = await CityInstances.allocate(size);
        return {host:MY_IP, port:server.port, sessionId:server.id};
    }
    let Server = RamsgateServer;

    if(Server === undefined || IsPersistentWorldLivenessOn()){
        Server = await EnsurePersistentWorld("ramsgate", Server === undefined ? "Ramsgate is not running: starting it" : "Ramsgate is not running any more: starting it again before sending anyone there");
    }

    return {
        host: MY_IP,
        port: Server.port,
        sessionId: Server.id
    };
}

// The Dojo is started on demand the first time someone is matchmade into it,
// rather than at boot. It is a full game process that most sessions never
// visit, and on a single home PC that memory matters. Concurrent first
// requests share one launch instead of racing to start two.
export async function GetTrainingDojoConnectionDetails(){
    let Server = TrainingDojoServer;

    if(Server === undefined){
        Server = await EnsurePersistentWorld("dojo", "Starting the Training Dojo on demand", "info");
    }
    else if(IsPersistentWorldLivenessOn()){
        Server = await EnsurePersistentWorld("dojo", "The Training Dojo is not running any more: starting it again before sending anyone there");
    }

    return {
        host: MY_IP,
        port: Server.port,
        sessionId: Server.id
    };
}

export async function StartupGameserverWithArgs(GameArgs: string){
    const Map = GameArgs.split("?")[0];
    const Behemoth = GameArgs.split("?")[2].split("=")[1];

    const GameServerToReturn = await StartServer(Map, Behemoth, undefined, undefined, false, false);

    return {
        host: MY_IP,
        port: GameServerToReturn.port,
        sessionId: GameServerToReturn.id
    };
}

function GetMatchmakerHuntIdFromPlayerHuntId(PlayerHuntId: string){
    const MatchmakerHuntIDs = (PlayerHuntTable[0].Rows as any)[PlayerHuntId].MatchmakerHuntIDs;

    let MatchmakerHuntObject;

    if(MatchmakerHuntIDs.length !== 0){
        MatchmakerHuntObject = MatchmakerHuntIDs[crypto.randomInt(0, MatchmakerHuntIDs.length)];
    }

    return MatchmakerHuntObject?.RowName;
}

function GetBehemothPathFromMatchmakerHuntId(MatchmakerHuntId: string): string{
    const MatchmakerHuntObject = (MatchmakerHuntTable[0].Rows as any)[MatchmakerHuntId];

    return MatchmakerHuntObject.SpecificBehemoth.BehemothAsset.AssetPathName;
}

function GetMapPathFromMatchmakerHuntId(MatchmakerHuntId: string): string{
    const MatchmakerHuntObject = (MatchmakerHuntTable[0].Rows as any)[MatchmakerHuntId];

    const MapList = MatchmakerHuntObject.MapList;

    return MapList[crypto.randomInt(0, MapList.length)].MapAssetName.split(".")[0];
}

function GetGameModeOverrideFromMatchmakerHuntId(MatchmakerHuntId: string): string{
    const MatchmakerHuntObject = (MatchmakerHuntTable[0].Rows as any)[MatchmakerHuntId];

    return MatchmakerHuntObject.GameModeOverride.replaceAll("Archon/Content", "/Game");
}

export type TrialsData = {
    Behemoth: string;
    TrialsHuntId: string;
}

// Trials reset every Thursday 18:00 UTC, counted from the historical row 001 week.
export const TRIAL_ROTATION_START = "2019-07-18T18:00:00.000Z";
const TRIAL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The weekly pool (vendor/trials_pool.json, mirrored in the metagame): elemental variants that also
// have a Heroic hunt of that same variant, each with the cooked Trial rows that use it at both
// difficulties. Base behemoths are never in it.
export type TrialPool = Record<string, string[]>;
export const TRIAL_POOL: TrialPool = (TrialsPool as {behemoths: TrialPool}).behemoths;
const TRIAL_POOL_BEHEMOTHS = Object.keys(TRIAL_POOL).sort();

function TrialBlueprint(Row: any){
    const Asset: string = Row?.SpecificBehemoth?.BehemothAsset?.AssetPathName ?? "";
    return Asset.split(".").at(-1)?.replace(/_bp_C$/, "") ?? "";
}

// Every pooled row must exist in both cooked tables with the pooled blueprint, so a stale pool file
// can never send a different behemoth than the one it names.
export function ValidateTrialPool(Pool: TrialPool, HardRows: Record<string, unknown>, EliteRows: Record<string, unknown>){
    if(Object.keys(Pool).length === 0) throw new Error("Trials pool is empty");

    for(const [Behemoth, Suffixes] of Object.entries(Pool)){
        if(!Behemoth.endsWith("_alpha")) throw new Error(`Trials pool behemoth ${Behemoth} is not a variant`);
        if(Suffixes.length === 0) throw new Error(`Trials pool behemoth ${Behemoth} has no rows`);

        for(const Suffix of Suffixes){
            const Hard = TrialBlueprint(HardRows[`Arena_MatchmakerHunt_Hard_${Suffix}`]);
            const Elite = TrialBlueprint(EliteRows[`Arena_MatchmakerHunt_Elite_${Suffix}`]);

            if(Hard !== Behemoth || Elite !== Behemoth){
                throw new Error(`Trials pool row ${Suffix} is not ${Behemoth} at both difficulties`);
            }
        }
    }
}

ValidateTrialPool(TRIAL_POOL, TrialsHardHuntTable[0].Rows as any, TrialsEliteHuntTable[0].Rows as any);

function Mod(Value: number, Divisor: number){
    return ((Value % Divisor) + Divisor) % Divisor;
}

function TrialScore(Seed: string){
    return crypto.createHash("sha256").update(Seed).digest("hex");
}

// Sorted by the hash of Prefix + item, compared byte for byte like the DLL (TrialsRotation.h).
function SortedByScore(Items: string[], Prefix: string){
    return Items
        .map((Item) => ({Item, Score: TrialScore(Prefix + Item)}))
        .sort((A, B) => A.Score < B.Score ? -1 : A.Score > B.Score ? 1 : 0)
        .map((Entry) => Entry.Item);
}

function TrialCycleOrder(Cycle: number){
    return SortedByScore(TRIAL_POOL_BEHEMOTHS, `trials-weekly-v1:${Cycle}:`);
}

// A seeded shuffle of the pool per cycle of N weeks: every behemoth once per cycle, in a random
// order, and never the same behemoth two weeks running (also across a cycle boundary).
// Deterministic, so the metagame computes the same pick without any shared state.
export function TrialBehemothForWeek(Week: number){
    const Count = TRIAL_POOL_BEHEMOTHS.length;
    const Cycle = Math.floor(Week / Count);
    const Order = TrialCycleOrder(Cycle);

    if(Count > 1 && Order[0] === TrialCycleOrder(Cycle - 1)[Count - 1]){
        [Order[0], Order[1]] = [Order[1], Order[0]];
    }

    return Order[Mod(Week, Count)];
}

// One of the behemoth's authored rows, shared by Normal and Dauntless.
export function TrialSuffixForWeek(Week: number){
    const Behemoth = TrialBehemothForWeek(Week);

    return SortedByScore(TRIAL_POOL[Behemoth], `trials-weekly-v1:row:${Week}:`)[0];
}

export function TrialWeekAt(At: Date = new Date()){
    const Epoch = Date.parse(process.env.TRIAL_ROTATION_START ?? TRIAL_ROTATION_START);

    if(Number.isNaN(Epoch)){
        throw new Error("Invalid TRIAL_ROTATION_START");
    }

    return Math.floor((At.getTime() - Epoch) / TRIAL_WEEK_MS);
}

export function GetTrialsData(IsElite: boolean, At: Date = new Date()): TrialsData{
    const Difficulty = IsElite ? "Elite" : "Hard";
    const TrialsHuntId = `Arena_MatchmakerHunt_${Difficulty}_${TrialSuffixForWeek(TrialWeekAt(At))}`;
    const Rows = IsElite ? (TrialsEliteHuntTable[0].Rows as any) : (TrialsHardHuntTable[0].Rows as any);
    const Row = Rows[TrialsHuntId];

    if(Row == undefined){
        throw new Error(`Trials rotation row ${TrialsHuntId} is missing`);
    }

    return {
        Behemoth: Row.SpecificBehemoth.BehemothAsset.AssetPathName,
        TrialsHuntId
    };
}

export async function StartupGameserverWithHuntIdAndPlayers(HuntId: string, ExpectedPlayers: string[]){
    const TrialsData = HuntId.includes("Arena") ? GetTrialsData(HuntId.includes("Elite")) : undefined;
    const MatchmakerHuntId = TrialsData == undefined ? GetMatchmakerHuntIdFromPlayerHuntId(HuntId) : TrialsData.TrialsHuntId;
    let BehemothPath = TrialsData == undefined ? GetBehemothPathFromMatchmakerHuntId(MatchmakerHuntId!) : TrialsData.Behemoth;
    let MapPath = TrialsData == undefined ? GetMapPathFromMatchmakerHuntId(MatchmakerHuntId!) : TRIALS_MAP_PATH;

    if(MatchmakerHuntId != undefined && !MatchmakerHuntId.includes("Arena")){
        const OverrideGameMode = GetGameModeOverrideFromMatchmakerHuntId(MatchmakerHuntId);

        if(OverrideGameMode != undefined && OverrideGameMode.includes("_C")){
            logger.info(`Overriding gamemode to ${OverrideGameMode}`);
            MapPath = `${MapPath}?game=${OverrideGameMode}`;
        }
    }

    const GameServerToReturn = await StartServer(MapPath, BehemothPath, MatchmakerHuntId, ExpectedPlayers.map((PlayerId) => {
        return {
            playerUid: PlayerId,
            playerHuntId: HuntId
        };
    }), false, false);

    return {
        host: MY_IP,
        port: GameServerToReturn.port,
        sessionId: GameServerToReturn.id
    }
}

// ---- GET /gameservers: what runs now, for the metagame's /undaunted/api/ServerStatus ----

export type GameserverKind = "city" | "hunt" | "dojo" | "tutorial";

// The tutorial is started from the client's own game args: the tutorial Gnasher on
// dia_moss_triforce (regular hunts use dia_moss_triforce_2, hence the exact match)
const TUTORIAL_MAP = /\/dia_moss_triforce(?:$|[.?])/i;
const TRAINING_DOJO_MATCHMAKER_HUNT_ID = "CR19_MatchmakerHunt_ShatteredIsles_TrainingDojo";

export function KindOfGameserver(Server: Gameserver): GameserverKind {
    if(Server.isRamsgate){
        return "city";
    }

    if(Server.isTrainingDojo){
        return "dojo";
    }

    if(/_tutorial_bp/i.test(Server.behemoth ?? "") || TUTORIAL_MAP.test(Server.map)){
        return "tutorial";
    }

    return "hunt";
}

function MaxPlayersFromTables(MatchmakerHuntId: string){
    const Row = (MatchmakerHuntTable[0].Rows as any)[MatchmakerHuntId]
        ?? (TrialsHardHuntTable[0].Rows as any)[MatchmakerHuntId]
        ?? (TrialsEliteHuntTable[0].Rows as any)[MatchmakerHuntId];

    return Number.isInteger(Row?.MaxPlayers) ? Row.MaxPlayers as number : null;
}

// null where the tables don't say (Ramsgate): the metagame fills in its default
function MaxPlayersOf(Server: Gameserver, Kind: GameserverKind): number | null {
    switch(Kind){
        case "city":
            return CityPoolEnabled() ? CITY_PLAYER_LIMIT : null;
        case "tutorial":
            return 1;
        case "dojo":
            return MaxPlayersFromTables(TRAINING_DOJO_MATCHMAKER_HUNT_ID);
        case "hunt":
            return Server.matchmakerHuntId != undefined ? MaxPlayersFromTables(Server.matchmakerHuntId) : null;
        default:
            return null;
    }
}

export function IsProcessAlive(ProcessId: number){
    try{
        kill(ProcessId, 0);

        return true;
    } catch {
        return false;
    }
}

// Servers whose process has exited are left out at once (the watchdog frees them within a minute)
export function DescribeGameservers(Servers: Gameserver[] = Gameservers, IsAlive: (ProcessId: number) => boolean = IsProcessAlive){
    return Servers.filter((Server) => IsAlive(Server.processId)).map((Server) => {
        const Kind = KindOfGameserver(Server);
        const [MapPath, ...Options] = Server.map.split("?");
        const GameMode = Options.find((Option) => Option.startsWith("game="))?.slice("game=".length);

        return {
            id: Server.id,
            port: Server.port,
            kind: Kind,
            map: MapPath,
            gameMode: GameMode != undefined && GameMode.length > 0 ? GameMode : null,
            behemoth: Server.behemoth != undefined && Server.behemoth.length > 0 && Server.behemoth !== "NO_BEHEMOTH" ? Server.behemoth : null,
            huntId: Server.expectedPlayers?.[0]?.playerHuntId ?? null,
            matchmakerHuntId: Server.matchmakerHuntId ?? null,
            expectedPlayers: (Server.expectedPlayers ?? []).map((Player) => Player.playerUid),
            maxPlayers: MaxPlayersOf(Server, Kind),
            startedAt: Server.startTime.toISOString()
        };
    });
}

// Both persistent worlds start through the shared launch, so a player's request that arrives while
// they are still starting waits for them instead of starting a second process
export async function Startup(){
    for(let i = PORT_RANGE_BEGIN; i <= PORT_RANGE_END - 2; i++){
        FreePorts.push(i);
    }

    if (process.env.HUNT_WORKER === '1' && process.env.WORKER_RAMSGATE !== '1') return;

    if (!CityPoolEnabled()) await EnsurePersistentWorld("ramsgate");

    // Upstream always started the Dojo here. Opt back in with ENABLE_DOJO=1 on
    // a machine with RAM to spare; otherwise it starts on first use.
    if (process.env.ENABLE_DOJO === "1") {
        await EnsurePersistentWorld("dojo");
    }
}

// For server.ts. A failed start (a wrong GAMESERVER_BINARY_PATH, say) is one fatal line and a
// non-zero exit code for when the process ends, instead of an unhandled rejection (the catch comes from
// github.com/Harmonicrain/Undaunted 895f7c7). The deploy server
// keeps answering: the next trip to Ramsgate tries to start it again.
export function StartupAndReportFailure(){
    return Startup().catch((error) => {
        logger.fatal(`Starting the game servers failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}

// The watchdog's check, with the same stand-in as everything else here in tests
export function IsGameserverAlive(Server: Gameserver){
    return ProcessIsAlive(Server.processId);
}

// ---- Tests only ----

export function UseProcessFunctionsForTests(Functions: {
    Spawn?: SpawnFunction,
    IsAlive?: (ProcessId: number) => boolean,
    IsPortBound?: (Port: number) => Promise<boolean>
}){
    SpawnProcess = Functions.Spawn ?? spawn;
    ProcessIsAlive = Functions.IsAlive ?? ((ProcessId) => IsProcessAlive(ProcessId));
    PortIsBound = Functions.IsPortBound ?? (async () => false);
}

export function ResetGameserversForTests(){
    CityInstances.reset();
    ServerLaunchQueue = Promise.resolve();
    NextServerLaunchAt = 0;
    Gameservers = [];
    FreePorts = [];
    RamsgateServer = undefined;
    TrainingDojoServer = undefined;
    PersistentWorldLaunches.clear();
}

export function GameserverStateForTests(){
    return { FreePorts: [...FreePorts], Ramsgate: RamsgateServer, Dojo: TrainingDojoServer };
}
