import { readFileSync } from "node:fs";
import path from "node:path";
import "./setup";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { DescribeGameservers, Gameserver, Gameservers, GetTrialsData, TrackGameserverForTests, KindOfGameserver, TRIAL_POOL, TRIAL_ROTATION_START, TrialBehemothForWeek, TrialSuffixForWeek, TrialWeekAt, ValidateTrialPool } from "../src/controllers/gameservers";
import MatchmakerTable from "../src/vendor/matchmaker_hunts_table.json";
import TrialsHardTable from "../src/vendor/trials_hard_table.json";
import TrialsEliteTable from "../src/vendor/trials_elite_table.json";
import { IsLoopbackAddress } from "../src/routes/gameservers";
import { app } from "../src/app";

// A spare port for this test only (61010-61029 and 62000-62099 are the test ranges)
const TEST_PORT = 62013;

function Fake(Overrides: Partial<Gameserver>): Gameserver {
    return {
        id: "00000000-0000-4000-8000-000000000000",
        port: 8770,
        map: "/Game/Maps/islands/1702/cora_jamima",
        behemoth: undefined,
        matchmakerHuntId: undefined,
        expectedPlayers: undefined,
        isRamsgate: false,
        isTrainingDojo: false,
        processId: process.pid,
        startTime: new Date("2026-09-21T12:00:00.000Z"),
        ...Overrides
    };
}

const Ramsgate = Fake({ id: "11111111-1111-4111-8111-111111111111", port: 8777, map: "/Game/Maps/ramsgate/ramsgate_01_persistent", isRamsgate: true });
const Dojo = Fake({ id: "22222222-2222-4222-8222-222222222222", port: 8776, map: "/Game/Maps/islands/dojo/training_dojo_persistent", isTrainingDojo: true });
const Tutorial = Fake({
    id: "33333333-3333-4333-8333-333333333333", port: 8775,
    map: "/Game/Maps/islands/1705/dia_moss_triforce",
    behemoth: "/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C"
});
const Hunt = Fake({
    id: "44444444-4444-4444-8444-444444444444", port: 8774,
    map: "/Game/Maps/islands/1705/dia_moss_triforce_2?game=/Game/Blueprints/GameMode/Some_GameMode.Some_GameMode_C",
    behemoth: "/Game/Monsters/lerawr/lerawr_beta_bp.lerawr_beta_bp_C",
    matchmakerHuntId: "CR19_MatchmakerHunt_Lerawr_Beta",
    expectedPlayers: [
        { playerUid: "UID-a", playerHuntId: "CR19_PlayerHunt_FTUE_Pursuit_Beta_LeRawr" },
        { playerUid: "UID-b", playerHuntId: "CR19_PlayerHunt_FTUE_Pursuit_Beta_LeRawr" }
    ]
});

describe("Trials weekly rotation", () => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const Hard = TrialsHardTable[0].Rows as any;
    const Elite = TrialsEliteTable[0].Rows as any;
    const Blueprint = (Id: string) => ((Hard[Id] ?? Elite[Id]).SpecificBehemoth.BehemothAsset.AssetPathName as string).split(".").at(-1)!.replace(/_bp_C$/, "");

    it("pools only variants that have a Heroic hunt of the same variant", () => {
        const Matchmaker = MatchmakerTable[0].Rows as any;
        const Of = (Suffix: string) => new Set(Object.entries(Matchmaker)
            .filter(([Id]) => Id.endsWith(Suffix))
            .map(([, Row]: [string, any]) => (Row.SpecificBehemoth?.BehemothAsset?.AssetPathName ?? "").split(".").at(-1).replace(/_bp_C$/, "")));
        const Alpha = Of("_Alpha");
        const Heroic = Of("_Heroic");

        assert.equal(Object.keys(TRIAL_POOL).length, 12);
        for(const [Behemoth, Suffixes] of Object.entries(TRIAL_POOL)){
            assert.ok(Behemoth.endsWith("_alpha"), Behemoth);
            assert.ok(Alpha.has(Behemoth) && Heroic.has(Behemoth), Behemoth);
            for(const Suffix of Suffixes){
                assert.equal(Blueprint(`Arena_MatchmakerHunt_Hard_${Suffix}`), Behemoth);
                assert.equal(Blueprint(`Arena_MatchmakerHunt_Elite_${Suffix}`), Behemoth);
            }
        }
    });

    it("never launches a base behemoth and never repeats one two weeks running", () => {
        let Previous = "";

        for(let Week = -30; Week < 400; Week++){
            const Behemoth = TrialBehemothForWeek(Week);
            const Suffix = TrialSuffixForWeek(Week);

            assert.ok(Behemoth.endsWith("_alpha"));
            assert.ok(TRIAL_POOL[Behemoth].includes(Suffix));
            assert.notEqual(Behemoth, Previous, `week ${Week}`);
            Previous = Behemoth;
        }
    });

    it("uses every pooled behemoth once per cycle", () => {
        const Count = Object.keys(TRIAL_POOL).length;
        const Seen = new Set(Array.from({length: Count}, (_, Index) => TrialBehemothForWeek(5 * Count + Index)));

        assert.equal(Seen.size, Count);
    });

    it("matches the pool compiled into the DLL (UndauntedInternalServer/TrialsRotation.h)", () => {
        const Header = readFileSync(path.join(__dirname, "../../../UndauntedInternalServer/TrialsRotation.h"), "utf8");
        const Compiled = Object.fromEntries([...Header.matchAll(/\{"([a-z_]+)", \{([^}]*)\}\}/g)]
            .map((Match) => [Match[1], [...Match[2].matchAll(/"(\d{3})"/g)].map((Suffix) => Suffix[1])]));

        assert.deepEqual(Compiled, TRIAL_POOL);
    });

    it("rejects a pool row that does not match its behemoth", () => {
        const Pool = {lerawr_alpha: [...TRIAL_POOL.lerawr_alpha, TRIAL_POOL.host_alpha[0]]};

        assert.throws(() => ValidateTrialPool(Pool, Hard, Elite), /is not lerawr_alpha/);
        assert.throws(() => ValidateTrialPool({lerawr_normal: TRIAL_POOL.lerawr_alpha}, Hard, Elite), /not a variant/);
    });

    it("changes the pick at the Thursday 18:00 UTC reset and holds it all week", () => {
        const Start = new Date(TRIAL_ROTATION_START);
        const OneMsBefore = new Date(Start.getTime() - 1);
        const SameWeek = new Date(Start.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000);
        const NextWeek = new Date(Start.getTime() + WEEK_MS);

        assert.equal(Start.toISOString(), "2019-07-18T18:00:00.000Z");
        assert.equal(TrialWeekAt(Start), 0);
        assert.equal(TrialWeekAt(OneMsBefore), -1);

        const First = GetTrialsData(false, Start);
        assert.notEqual(GetTrialsData(false, OneMsBefore).Behemoth, First.Behemoth);
        assert.deepEqual(GetTrialsData(false, SameWeek), First);
        assert.notEqual(GetTrialsData(false, NextWeek).Behemoth, First.Behemoth);
    });

    it("gives Normal and Dauntless the same row and behemoth", () => {
        for(let Week = 0; Week < 50; Week++){
            const At = new Date(Date.parse(TRIAL_ROTATION_START) + Week * WEEK_MS);
            const Normal = GetTrialsData(false, At);
            const Dauntless = GetTrialsData(true, At);

            assert.equal(Normal.TrialsHuntId.replace("_Hard_", "_"), Dauntless.TrialsHuntId.replace("_Elite_", "_"));
            assert.equal(Normal.Behemoth, Dauntless.Behemoth);
            assert.ok(Normal.Behemoth.includes("_alpha_bp."));
        }
    });

    it("accepts a host override for the epoch and rejects a bad one", () => {
        const Old = process.env.TRIAL_ROTATION_START;

        try{
            process.env.TRIAL_ROTATION_START = "2026-10-01T00:00:00.000Z";
            assert.ok(GetTrialsData(false, new Date("2026-10-01T12:00:00.000Z")).TrialsHuntId.endsWith(`_${TrialSuffixForWeek(0)}`));

            process.env.TRIAL_ROTATION_START = "not-a-date";
            assert.throws(() => GetTrialsData(false, new Date()), /Invalid TRIAL_ROTATION_START/);
        }
        finally{
            if(Old === undefined) delete process.env.TRIAL_ROTATION_START;
            else process.env.TRIAL_ROTATION_START = Old;
        }
    });
});

describe("KindOfGameserver", () => {
    it("tells Ramsgate, the Dojo, the tutorial and hunts apart", () => {
        assert.equal(KindOfGameserver(Ramsgate), "city");
        assert.equal(KindOfGameserver(Dojo), "dojo");
        assert.equal(KindOfGameserver(Tutorial), "tutorial");
        assert.equal(KindOfGameserver(Hunt), "hunt");
    });

    it("does not take dia_moss_triforce_2 (a regular hunt map) for the tutorial island", () => {
        assert.equal(KindOfGameserver(Fake({ map: "/Game/Maps/islands/1705/dia_moss_triforce_2", behemoth: "/Game/Monsters/lerawr/lerawr_normal_bp.lerawr_normal_bp_C" })), "hunt");
        assert.equal(KindOfGameserver(Fake({ map: "/Game/Maps/islands/1705/dia_moss_triforce", behemoth: undefined })), "tutorial");
    });
});

describe("DescribeGameservers", () => {
    it("reports each server's port, kind, map, behemoth, hunt, expected players, limit and start", () => {
        const [City, Training, Solo, Group] = DescribeGameservers([Ramsgate, Dojo, Tutorial, Hunt], () => true);

        assert.deepEqual(City, {
            id: Ramsgate.id, port: 8777, kind: "city", map: "/Game/Maps/ramsgate/ramsgate_01_persistent", gameMode: null,
            behemoth: null, huntId: null, matchmakerHuntId: null, expectedPlayers: [], maxPlayers: 20, startedAt: "2026-09-21T12:00:00.000Z"
        });
        assert.equal(Training.kind, "dojo");
        assert.equal(Training.maxPlayers, 12);
        assert.equal(Solo.kind, "tutorial");
        assert.equal(Solo.maxPlayers, 1);
        assert.equal(Solo.behemoth, "/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C");
        assert.deepEqual(Group, {
            id: Hunt.id, port: 8774, kind: "hunt", map: "/Game/Maps/islands/1705/dia_moss_triforce_2",
            gameMode: "/Game/Blueprints/GameMode/Some_GameMode.Some_GameMode_C",
            behemoth: "/Game/Monsters/lerawr/lerawr_beta_bp.lerawr_beta_bp_C",
            huntId: "CR19_PlayerHunt_FTUE_Pursuit_Beta_LeRawr", matchmakerHuntId: "CR19_MatchmakerHunt_Lerawr_Beta",
            expectedPlayers: ["UID-a", "UID-b"], maxPlayers: 4, startedAt: "2026-09-21T12:00:00.000Z"
        });
    });

    it("leaves out a server whose process has exited", () => {
        const Listed = DescribeGameservers([Ramsgate, Hunt], (ProcessId) => ProcessId !== 999999 && ProcessId === process.pid);
        assert.equal(Listed.length, 2);
        assert.deepEqual(DescribeGameservers([Ramsgate, Fake({ processId: 999999 })], (ProcessId) => ProcessId === process.pid).map((Server) => Server.port), [8777]);
    });

    it("reads a trials hunt's limit from the trials tables and has no limit for an unknown hunt", () => {
        assert.equal(DescribeGameservers([Fake({ matchmakerHuntId: "Arena_MatchmakerHunt_Hard_001" })], () => true)[0].maxPlayers, 4);
        assert.equal(DescribeGameservers([Fake({ matchmakerHuntId: "No_Such_Hunt" })], () => true)[0].maxPlayers, null);
    });
});

describe("GET /gameservers", () => {
    let Listening: Server | undefined;

    after(() => {
        Listening?.close();
        Gameservers.length = 0;
    });

    it("answers the running servers to a loopback caller", async () => {
        TrackGameserverForTests(Ramsgate); TrackGameserverForTests(Hunt);
        Listening = await new Promise<Server>((Resolve, Reject) => {
            const Started = app.listen(TEST_PORT, "127.0.0.1", (Error?: Error) => Error ? Reject(Error) : Resolve(Started));
        });

        const Reply = await fetch(`http://127.0.0.1:${TEST_PORT}/gameservers`);
        assert.equal(Reply.status, 200);
        const Body: any = await Reply.json();
        assert.deepEqual(Body.servers.map((Server: any) => [Server.port, Server.kind, Server.huntId]), [[8777, "city", null], [8774, "hunt", "CR19_PlayerHunt_FTUE_Pursuit_Beta_LeRawr"]]);
    });

    it("refuses anyone not on loopback", () => {
        for(const Address of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]){
            assert.equal(IsLoopbackAddress(Address), true, Address);
        }

        for(const Address of ["100.64.0.7", "192.168.1.20", "::ffff:100.101.102.103", "fe80::1", "0.0.0.0", "", undefined]){
            assert.equal(IsLoopbackAddress(Address), false, String(Address));
        }
    });
});
