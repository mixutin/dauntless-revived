import { RemoveTestDb } from "./setup";
import { FAKE_DEPLOYSERVER_PORT } from "./statusenv";
import "./authenv";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GetDb } from "../src/db";
import { userapikeys, users } from "../src/db/schema";
import { BehemothName, BuildLimitedServerStatus, BuildServerStatus, ClassifyPlace, ClearServerStatusCache, GetServerIdentity, GetServerStatus, InstanceTitle } from "../src/controllers/serverstatus";
import { GetOnlinePlayerActivity, UpdatePlayerActivity } from "../src/controllers/undauntedapi";
import { HandlePlayerMatchmaking } from "../src/controllers/matchmaking";
import { HashUserAPIKey, SignMetagameJWTForUid } from "../src/controllers/auth";
import { IsRegisteredCaller, IsSoftRegisteredCaller, SoftAccountAuth } from "../src/middleware/SoftAccountAuth";
import { FakeDeployServer, StartFakeDeployServer, ThreeServers, TUTORIAL_GAME_ARGS } from "./fakedeploy";

const STATUS_KEYS = ["name", "online", "version", "commit", "sourceUrl", "registration", "playersOnline", "players", "instances", "contentPort", "uptimeSeconds", "limited"];

let Fake: FakeDeployServer | undefined;

after(async () => {
    await Fake?.Close();
    RemoveTestDb(() => GetDb().$client.close());
});

function Account(UserId: string, Name: string){
    GetDb().insert(users).values({ userId: UserId, name: Name, notes: 0 }).run();
}

describe("ClassifyPlace", () => {
    it("reads the heartbeat's map as a package path or a bare name", () => {
        const Cases: [unknown, string | undefined, string][] = [
            ["/Game/Maps/Map_LoginMenu", undefined, "menu"],
            ["Map_LoginMenu", undefined, "menu"],
            ["/Game/Maps/ramsgate/ramsgate_01_persistent", undefined, "city"],
            ["ramsgate_01_persistent", undefined, "city"],
            ["/Game/Maps/islands/dojo/training_dojo_persistent", undefined, "dojo"],
            ["/Game/Maps/islands/1705/dia_moss_triforce", undefined, "tutorial"],
            ["/Game/Maps/islands/1705/dia_moss_triforce_2", undefined, "hunt"],
            ["/Game/Maps/islands/1702/cora_jamima", undefined, "hunt"],
            ["/Game/Maps/islands/arenas/arena_ramsgate_00", undefined, "hunt"],
            ["cora_jamima", undefined, "hunt"],
            ["", "city", "city"],
            [undefined, "menu", "menu"],
            [undefined, "lobby", "menu"],
            [undefined, "island", "hunt"],
            [undefined, undefined, "unknown"],
            [{}, undefined, "unknown"]
        ];

        for(const [Map, State, Expected] of Cases){
            assert.equal(ClassifyPlace(Map, State), Expected, `${JSON.stringify(Map)} / ${State}`);
        }
    });
});

describe("hunt titles", () => {
    it("names behemoths from the hunt tables, else by codename", () => {
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/lerawr/lerawr_beta_bp.lerawr_beta_bp_C", matchmakerHuntId: "CR19_MatchmakerHunt_Lerawr_Beta" }), "Lesser Embermane");
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/mcrollin/mcbeaver_alpha_bp.mcbeaver_alpha_bp_C", matchmakerHuntId: "CR19_MatchmakerHunt_Beaver_Heroic" }), "Heroic Ragetail Gnasher");
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/mcrollin/mcbeaver_alpha_bp.mcbeaver_alpha_bp_C", matchmakerHuntId: null }), "Ragetail Gnasher");
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/sq/electroquill/electroquill_alpha_bp.electroquill_alpha_bp_C", matchmakerHuntId: "Arena_MatchmakerHunt_Hard_001" }), "Shockjaw Nayzaga");
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C", matchmakerHuntId: null }), "Gnasher");
        assert.equal(BehemothName({ behemoth: "/Game/Monsters/fulgar/fulgar_umbral_bp.fulgar_umbral_bp_C", matchmakerHuntId: null }), "fulgar_umbral");
        assert.equal(BehemothName({ behemoth: null, matchmakerHuntId: null }), null);
        assert.equal(BehemothName({ behemoth: null, matchmakerHuntId: "toString" }), null);
    });

    it("titles Ramsgate, the Dojo, the tutorial and hunts", () => {
        assert.equal(InstanceTitle({ kind: "city", map: "/Game/Maps/ramsgate/ramsgate_01_persistent", huntId: null }, null), "Ramsgate");
        assert.equal(InstanceTitle({ kind: "dojo", map: "/Game/Maps/islands/dojo/training_dojo_persistent", huntId: null }, null), "Training Dojo");
        assert.equal(InstanceTitle({ kind: "tutorial", map: "/Game/Maps/islands/1705/dia_moss_triforce", huntId: null }, "Gnasher"), "Tutorial");
        assert.equal(InstanceTitle({ kind: "hunt", map: "/Game/Maps/islands/1702/cora_jamima", huntId: null }, "Lesser Embermane"), "Hunt: Lesser Embermane");
        assert.equal(InstanceTitle({ kind: "hunt", map: "/Game/Maps/islands/1702/cora_jamima", huntId: "CR19_PlayerHunt_Escalation_Randall_Easy" }, null), "Hunt: Umbral Escalation");
        assert.equal(InstanceTitle({ kind: "hunt", map: "/Game/Maps/islands/1702/cora_jamima?game=X", huntId: null }, null), "Hunt: cora_jamima");
    });
});

describe("GetServerIdentity", () => {
    it("has defaults and takes SERVER_NAME, SERVER_VERSION, GIT_COMMIT and SOURCE_URL", () => {
        const Saved = { ...process.env };

        try{
            for(const Key of ["SERVER_NAME", "SERVER_VERSION", "GIT_COMMIT", "SOURCE_URL"]){
                delete process.env[Key];
            }

            const Defaults = GetServerIdentity();
            assert.equal(Defaults.name, "Dauntless Revived");
            assert.equal(Defaults.sourceUrl, "https://github.com/mixutin/dauntless-revived");
            assert.equal(Defaults.version, "0.0.5");
            assert.equal(typeof Defaults.commit, "string");

            Object.assign(process.env, { SERVER_NAME: "Friday Hunts", SERVER_VERSION: "friends-v1", GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567-dirty", SOURCE_URL: "https://example.org/src" });
            assert.deepEqual(GetServerIdentity(), { name: "Friday Hunts", version: "friends-v1", commit: "0123456789abcdef0123456789abcdef01234567-dirty", sourceUrl: "https://example.org/src" });

            process.env.GIT_COMMIT = "not a commit; rm -rf";
            assert.notEqual(GetServerIdentity().commit, process.env.GIT_COMMIT);
        }
        finally{
            for(const Key of ["SERVER_NAME", "SERVER_VERSION", "GIT_COMMIT", "SOURCE_URL"]){
                if(Saved[Key] === undefined){ delete process.env[Key]; } else { process.env[Key] = Saved[Key]; }
            }
        }
    });
});

describe("ServerStatus", () => {
    before(async () => {
        Account("UID-status-alpha", "Alpha");
        Account("UID-status-bravo", "bravo");
        Account("UID-status-charlie", "Charlie");
        Account("UID-status-delta", "Delta");
        Account("UID-status-echo", "Echo");

        Fake = await StartFakeDeployServer(FAKE_DEPLOYSERVER_PORT, ThreeServers("UID-status-bravo"));

        // Charlie is sent to the tutorial server (8775) by matchmaking, as the client asks for it
        Fake.MatchmakingPort = 8775;
        assert.equal(await HandlePlayerMatchmaking("ISLAND", TUTORIAL_GAME_ARGS, undefined as any, "UID-status-charlie"), true);

        await UpdatePlayerActivity("UID-status-alpha", "/Game/Maps/ramsgate/ramsgate_01_persistent");
        await UpdatePlayerActivity("UID-status-bravo", "/Game/Maps/islands/1702/cora_jamima", "island");
        await UpdatePlayerActivity("UID-status-charlie", "/Game/Maps/islands/1705/dia_moss_triforce");
        await UpdatePlayerActivity("UID-status-delta", "/Game/Maps/Map_LoginMenu", "menu");
        await UpdatePlayerActivity("UID-status-echo", "/Game/Maps/islands/1803/frida_moss_falls");
        await UpdatePlayerActivity("UID-no-such-account", "/Game/Maps/ramsgate/ramsgate_01_persistent");
        await UpdatePlayerActivity(undefined as any, "/Game/Maps/ramsgate/ramsgate_01_persistent"); // a heartbeat without a player token
        ClearServerStatusCache();
    });

    it('uses native occupancy for instance counts, including an explicit zero', async () => {
        Fake!.Servers[0].connectedPlayers=7;
        Fake!.Servers[1].connectedPlayers=0;
        try {
            const status=await BuildServerStatus();
            assert.equal(status.instances.find(s=>s.id===Fake!.Servers[0].id)?.players,7);
            assert.equal(status.instances.find(s=>s.id===Fake!.Servers[1].id)?.players,0);
        } finally {delete Fake!.Servers[0].connectedPlayers;delete Fake!.Servers[1].connectedPlayers;}
    });

    it("lists who is where and the three servers, with titles and per-server counts", async () => {
        const Status = await BuildServerStatus();

        assert.deepEqual(Object.keys(Status), STATUS_KEYS);
        assert.equal(Status.online, true);
        assert.equal(Status.limited, false);
        assert.equal(Status.playersOnline, 5);
        assert.deepEqual(Status.players, [
            { name: "Alpha", where: "city", instance: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d01" },
            { name: "bravo", where: "hunt", instance: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d02" },
            { name: "Charlie", where: "tutorial", instance: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d03" },
            { name: "Delta", where: "menu", instance: null },
            { name: "Echo", where: "hunt", instance: null }
        ]);
        assert.deepEqual(Status.instances, [
            { id: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d01", kind: "city", title: "Ramsgate", map: "ramsgate_01_persistent", behemoth: null, players: 1, maxPlayers: 32, startedAt: "2026-09-21T10:00:00.000Z", emptyForMs: null },
            { id: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d02", kind: "hunt", title: "Hunt: Lesser Embermane", map: "cora_jamima", behemoth: "Lesser Embermane", players: 1, maxPlayers: 4, startedAt: "2026-09-21T11:00:00.000Z", emptyForMs: null },
            { id: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d03", kind: "tutorial", title: "Tutorial", map: "dia_moss_triforce", behemoth: "Gnasher", players: 1, maxPlayers: 1, startedAt: "2026-09-21T11:30:00.000Z", emptyForMs: null }
        ]);

        const Text = JSON.stringify(Status);
        assert.doesNotMatch(Text, /UID-|UUK_|127\.0\.0\.1|eyJ/);
    });

    it("answers from a 5 s cache", async () => {
        ClearServerStatusCache();
        const First = await GetServerStatus("full");
        const Requests = Fake!.Requests.length;

        await UpdatePlayerActivity("UID-status-alpha", "/Game/Maps/Map_LoginMenu");
        const [Second, Third] = await Promise.all([GetServerStatus("full"), GetServerStatus("full")]);

        assert.equal(Second, First);
        assert.equal(Third, First);
        assert.equal(Fake!.Requests.length, Requests, "no deploy-server call while cached");

        ClearServerStatusCache();
        const Fresh = await GetServerStatus("full");
        assert.equal(Fresh.players.find((Player) => Player.name === "Alpha")?.where, "menu");
    });

    it("limited: the same shape with no players and no servers, and it never asks the deploy server", async () => {
        ClearServerStatusCache();
        const Requests = Fake!.Requests.length;
        const Full = await BuildServerStatus();
        const Limited = BuildLimitedServerStatus();

        assert.equal(Fake!.Requests.length, Requests + 1, "only the full status asked the deploy server");
        assert.deepEqual(Object.keys(Limited), STATUS_KEYS);
        assert.deepEqual([Limited.playersOnline, Limited.players, Limited.instances, Limited.limited], [0, [], [], true]);
        assert.ok(Full.playersOnline > 0 && Full.instances.length > 0 && Full.limited === false);

        // Everything else is the same as the full answer
        for(const Key of ["name", "online", "version", "commit", "sourceUrl", "registration", "contentPort"] as const){
            assert.deepEqual(Limited[Key], Full[Key], Key);
        }
        assert.ok(Math.abs(Limited.uptimeSeconds - Full.uptimeSeconds) <= 1);
        assert.doesNotMatch(JSON.stringify(Limited), /Alpha|bravo|Charlie|Delta|Echo|5c0a9e36|UID-/);
    });

    it("caches each variant separately: a limited answer never serves the full one's data, and the other way round", async () => {
        ClearServerStatusCache();
        const Requests = Fake!.Requests.length;

        const [Limited, Full] = await Promise.all([GetServerStatus("limited"), GetServerStatus("full")]);
        assert.equal(Limited.limited, true);
        assert.equal(Limited.players.length, 0);
        assert.equal(Full.limited, false);
        assert.ok(Full.players.length > 0);

        const [LimitedAgain, FullAgain] = await Promise.all([GetServerStatus("limited"), GetServerStatus("full"), GetServerStatus("limited")]);
        assert.equal(LimitedAgain, Limited, "limited served from its cache");
        assert.equal(FullAgain, Full, "full served from its cache");
        assert.equal(Fake!.Requests.length, Requests + 1, "one deploy-server call for the full variant only");

        // A fresh limited build (its cache expired) still does not touch the full one
        const RealNow = Date.now;
        try{
            Date.now = () => RealNow() + 6 * 1000;
            const Later = await GetServerStatus("limited");
            assert.notEqual(Later, Limited);
            assert.equal(Later.limited, true);
            assert.equal(Fake!.Requests.length, Requests + 1);
        }
        finally{
            Date.now = RealNow;
        }
    });

    it("drops a heartbeat older than 90 s", async () => {
        const RealNow = Date.now;

        try{
            Date.now = () => RealNow() + 91 * 1000;
            assert.equal(GetOnlinePlayerActivity().length, 0);
        }
        finally{
            Date.now = RealNow;
        }

        assert.ok(GetOnlinePlayerActivity().length >= 5);
    });

    it("still answers, with no servers, when the deploy server is down", async () => {
        await Fake!.Close();
        Fake = undefined;
        ClearServerStatusCache();

        const Status = await GetServerStatus("full");

        assert.deepEqual(Status.instances, []);
        assert.equal(Status.playersOnline, 5);
        assert.ok(Status.players.every((Player) => Player.instance === null));
    });
});

// ---- Who counts as a registered player (middleware/SoftAccountAuth.ts) ----

describe("SoftAccountAuth", () => {
    const PLAYER_KEY = `UUK_${"0123456789abcdef".repeat(3)}`;
    const ADMIN_KEY = `UUK_${"fedcba9876543210".repeat(3)}`;
    const GONE_KEY = `UUK_${"00112233445566778899aabb".repeat(2)}`;

    before(() => {
        Account("UID-soft-player", "SoftPlayer");
        GetDb().insert(users).values({ userId: "UID-soft-admin", name: "SoftAdmin", notes: 0, isAdmin: true }).run();
        GetDb().insert(userapikeys).values({ userId: "UID-soft-player", keyHash: HashUserAPIKey(PLAYER_KEY) }).run();
        GetDb().insert(userapikeys).values({ userId: "UID-soft-admin", keyHash: HashUserAPIKey(ADMIN_KEY) }).run();
        // A key whose account no longer exists
        GetDb().insert(userapikeys).values({ userId: "UID-soft-gone", keyHash: HashUserAPIKey(GONE_KEY) }).run();
    });

    function Request(Headers: Record<string, unknown>): any {
        return { headers: Headers, method: "GET", path: "/undaunted/api/ServerStatus", socket: { remoteAddress: "127.0.0.1" } };
    }

    async function Run(Headers: Record<string, unknown>){
        const Req = Request(Headers);
        const Res: any = { status: () => { throw new Error("SoftAccountAuth must never answer"); }, send: () => { throw new Error("SoftAccountAuth must never answer"); } };
        let Nexts = 0;

        await SoftAccountAuth(Req, Res, (Error?: unknown) => {
            assert.equal(Error, undefined);
            Nexts++;
        });

        assert.equal(Nexts, 1);
        return IsSoftRegisteredCaller(Req);
    }

    it("no key: anonymous", async () => {
        assert.equal(await Run({}), false);
        assert.equal(await IsRegisteredCaller(Request({})), false);
    });

    it("a bad key: anonymous, never a 401", async () => {
        for(const Key of ["UUK_not_a_real_key", "", " ", PLAYER_KEY + "x", PLAYER_KEY.toUpperCase(), "UID-soft-player", GONE_KEY, "x".repeat(5000)]){
            assert.equal(await Run({ "x-undaunted-user-api-key": Key }), false, `key of length ${Key.length}`);
        }
        assert.equal(await Run({ "x-undaunted-user-api-key": [PLAYER_KEY, PLAYER_KEY] }), false, "a repeated header is not a key");
    });

    it("a player's key: registered", async () => {
        assert.equal(await Run({ "x-undaunted-user-api-key": PLAYER_KEY }), true);
    });

    it("an admin's key: registered, like any account", async () => {
        assert.equal(await Run({ "x-undaunted-user-api-key": ADMIN_KEY }), true);
    });

    it("a player's bearer token counts; a bad token, a token for a deleted account or a bad key next to a good token do not change that", async () => {
        const Token = SignMetagameJWTForUid("UID-soft-player");

        assert.equal(await Run({ authorization: `bearer ${Token}` }), true);
        assert.equal(await Run({ authorization: `Bearer ${Token}` }), true);
        assert.equal(await Run({ authorization: `bearer ${Token}`, "x-undaunted-user-api-key": "UUK_wrong" }), true);
        assert.equal(await Run({ authorization: `bearer ${Token.slice(0, -4)}AAAA` }), false, "a forged signature");
        assert.equal(await Run({ authorization: Token }), false, "no bearer scheme");
        assert.equal(await Run({ authorization: `bearer ${SignMetagameJWTForUid("UID-soft-deleted")}` }), false, "the account does not exist");
    });
});

it("attributes multiple Ramsgates by the player's allocated port", async () => {
    const {SelectPersistentInstance} = await import('../src/controllers/serverstatus');
    const main={port:8777}, worker={port:8761};
    assert.equal(SelectPersistentInstance([main,worker],8761),worker);
    assert.equal(SelectPersistentInstance([main,worker],8777),main);
    assert.equal(SelectPersistentInstance([main,worker],undefined),main);
    assert.equal(SelectPersistentInstance([],8761),undefined);
});
