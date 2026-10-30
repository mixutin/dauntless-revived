import { RemoveTestDb } from "./setup";
import "./authenv";
import "./friendsenv";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { app } from "../src/app";
import { GetDb } from "../src/db";
import { userapikeys, users } from "../src/db/schema";
import { HashUserAPIKey } from "../src/controllers/auth";
import { ClearServerStatusCache } from "../src/controllers/serverstatus";
import { GetOnlinePlayerActivity } from "../src/controllers/undauntedapi";
import { GetPlaytimeSeconds } from "../src/controllers/playtime";
import { FakeDeployServer, StartFakeDeployServer, ThreeServers } from "./fakedeploy";
import { FRIENDS_API_PORT, FRIENDS_DEPLOYSERVER_PORT } from "./friendsenv";

// The account routes and ServerStatus over HTTP, as the launcher and host scripts call them.
// The app listens on a spare loopback port; the deploy server is a fake on another.

const BASE = `http://127.0.0.1:${FRIENDS_API_PORT}`;
const ADMIN_KEY = "UUK_test_admin_key_for_this_process_only";

let Listening: Server | undefined;
let Fake: FakeDeployServer | undefined;

type Reply = { status: number, json: any, text: string, type: string | null, headers: Headers };

async function Call(Method: string, Path: string, Options: { body?: unknown, raw?: string, key?: string, token?: string } = {}): Promise<Reply> {
    const Headers: Record<string, string> = {};

    if(Options.body !== undefined || Options.raw !== undefined) Headers["content-type"] = "application/json";
    if(Options.key != undefined) Headers["x-undaunted-user-api-key"] = Options.key;
    if(Options.token != undefined) Headers["authorization"] = `bearer ${Options.token}`;

    const Response = await fetch(BASE + Path, { method: Method, headers: Headers, body: Options.raw ?? (Options.body === undefined ? undefined : JSON.stringify(Options.body)) });
    const Text = await Response.text();
    let Json: any;

    try{ Json = Text.length > 0 ? JSON.parse(Text) : undefined; } catch { Json = undefined; }

    return { status: Response.status, json: Json, text: Text, type: Response.headers.get("content-type"), headers: Response.headers };
}

async function Login(Key: string){
    const Reply = await Call("POST", "/account/api/oauth/token", { body: { grant_type: "exchange_code", exchange_code: Key } });
    assert.equal(Reply.status, 200);
    return Reply.json.access_token as string;
}

function AssertError(Reply: Reply, Status: number, Error: string){
    assert.equal(Reply.status, Status, Reply.text);
    assert.match(Reply.type ?? "", /application\/json/);
    assert.equal(Reply.json?.error, Error);
    assert.equal(typeof Reply.json?.message, "string");
}

before(async () => {
    GetDb().insert(users).values({ userId: "UID-admin", name: "Slayer", notes: 0, isAdmin: true }).run();
    GetDb().insert(userapikeys).values({ userId: "UID-admin", keyHash: HashUserAPIKey(ADMIN_KEY) }).run();

    Listening = await new Promise<Server>((Resolve, Reject) => {
        const Started = app.listen(FRIENDS_API_PORT, "127.0.0.1", (Error?: Error) => Error ? Reject(Error) : Resolve(Started));
    });
});

after(async () => {
    await Fake?.Close();
    Listening?.closeAllConnections();
    await new Promise<void>((Resolve) => Listening ? Listening.close(() => Resolve()) : Resolve());
    RemoveTestDb(() => GetDb().$client.close());
});

let Friend: { key: string, token: string, userId: string };

describe("POST /undaunted/api/Register", () => {
    it("answers 200 {UUK} and nothing else for a valid new name", async () => {
        const Reply = await Call("POST", "/undaunted/api/Register", { body: { Username: "Hunter_1" } });

        assert.equal(Reply.status, 200);
        assert.deepEqual(Object.keys(Reply.json), ["UUK"]);

        const Info = await Call("GET", "/undaunted/api/GetUserInfo", { key: Reply.json.UUK });
        assert.equal(Info.status, 200);
        assert.deepEqual(Object.keys(Info.json).sort(), ["IsAdmin", "UserId", "Username"]);
        assert.equal(Info.json.Username, "Hunter_1");
        assert.equal(Info.json.IsAdmin, false);

        Friend = { key: Reply.json.UUK, token: await Login(Reply.json.UUK), userId: Info.json.UserId };
    });

    it("refuses with the JSON errors of the contract", async () => {
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "ab" } }), 400, "username_invalid");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "bad name!" } }), 400, "username_invalid");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "SLAYER" } }), 409, "username_taken");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "hunter_1" } }), 409, "username_taken");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: {} }), 400, "bad_request");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: 7 } }), 400, "bad_request");
        AssertError(await Call("POST", "/undaunted/api/Register", {}), 400, "bad_request");
        AssertError(await Call("POST", "/undaunted/api/Register", { raw: "{\"Username\": " }), 400, "bad_request");
    });

    it("says whether a name is free", async () => {
        assert.deepEqual((await Call("GET", "/undaunted/api/UsernameAvailable?Username=Brand_New")).json, { available: true });
        assert.equal((await Call("GET", "/undaunted/api/UsernameAvailable?Username=HUNTER_1")).json.error, "username_taken");
        assert.equal((await Call("GET", "/undaunted/api/UsernameAvailable?Username=x")).json.error, "username_invalid");
        assert.equal((await Call("GET", "/undaunted/api/UsernameAvailable")).json.available, false);
    });
});

describe("invites", () => {
    after(async () => {
        await Call("POST", "/undaunted/api/RegistrationStatus", { body: { RegistrationStatus: "OPEN" }, key: ADMIN_KEY });
    });

    it("CreateInvite is admin-only", async () => {
        assert.equal((await Call("POST", "/undaunted/api/CreateInvite", { body: {} })).status, 401);
        assert.equal((await Call("POST", "/undaunted/api/CreateInvite", { body: {}, key: "UUK_not_a_key" })).status, 401);
        assert.equal((await Call("POST", "/undaunted/api/CreateInvite", { body: {}, key: Friend.key })).status, 403);
    });

    it("CreateInvite makes a code that registers exactly as many accounts as it has uses", async () => {
        assert.equal((await Call("POST", "/undaunted/api/RegistrationStatus", { body: { RegistrationStatus: "INVITECODE" }, key: ADMIN_KEY })).status, 200);

        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_1" } }), 401, "invite_invalid");
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_1", InviteCode: "NOPE-NOPE-NOPE" } }), 401, "invite_invalid");

        const Created = await Call("POST", "/undaunted/api/CreateInvite", { body: { uses: 2, name: "for the Tuesday group" }, key: ADMIN_KEY });
        assert.equal(Created.status, 200);
        assert.deepEqual(Object.keys(Created.json), ["code"]);
        assert.match(Created.json.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        const Code = Created.json.code;

        // A taken name does not use the code up
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Hunter_1", InviteCode: Code } }), 409, "username_taken");
        assert.equal((await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_1", InviteCode: Code } })).status, 200);
        assert.equal((await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_2", InviteCode: Code } })).status, 200);
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_3", InviteCode: Code } }), 401, "invite_invalid");

        const Single = await Call("POST", "/undaunted/api/CreateInvite", { body: {}, key: ADMIN_KEY });
        assert.equal((await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_3", InviteCode: Single.json.code } })).status, 200);
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Invited_4", InviteCode: Single.json.code } }), 401, "invite_invalid");

        const Listed = await Call("GET", "/undaunted/api/InviteCodes", { key: ADMIN_KEY });
        assert.equal(Listed.json.InviteCodes.find((Invite: any) => Invite.inviteCode === Code)?.usesRemaining, 0);
    });

    it("CreateInvite refuses a bad use count", async () => {
        for(const Body of [{ uses: 0 }, { uses: -1 }, { uses: 1.5 }, { uses: "2" }, { uses: 1001 }, { name: 5 }]){
            AssertError(await Call("POST", "/undaunted/api/CreateInvite", { body: Body, key: ADMIN_KEY }), 400, "bad_request");
        }

        AssertError(await Call("POST", "/undaunted/api/CreateInvite", { raw: "{uses:", key: ADMIN_KEY }), 400, "bad_request");
    });

    it("answers registration_closed when registration is off", async () => {
        assert.equal((await Call("POST", "/undaunted/api/RegistrationStatus", { body: { RegistrationStatus: "NONE" }, key: ADMIN_KEY })).status, 200);
        AssertError(await Call("POST", "/undaunted/api/Register", { body: { Username: "Too_Late", InviteCode: "ANY-CODE" } }), 400, "registration_closed");
    });
});

describe("POST /undaunted/api/RenameUser", () => {
    it("is admin-only", async () => {
        assert.equal((await Call("POST", "/undaunted/api/RenameUser", { body: { UserId: Friend.userId, NewUsername: "Renamed_1" } })).status, 401);
        assert.equal((await Call("POST", "/undaunted/api/RenameUser", { body: { UserId: Friend.userId, NewUsername: "Renamed_1" }, key: Friend.key })).status, 403);
    });

    it("renames, and the client sees the stored name everywhere it shows one", async () => {
        const Characters = await Call("GET", "/character", { token: Friend.token });
        assert.equal(Characters.json[0].name, "Hunter_1");

        const Renamed = await Call("POST", "/undaunted/api/RenameUser", { body: { UserId: Friend.userId, NewUsername: "Renamed_1" }, key: ADMIN_KEY });
        assert.equal(Renamed.status, 200);
        assert.deepEqual(Renamed.json, { UserId: Friend.userId, OldUsername: "Hunter_1", Username: "Renamed_1" });

        assert.equal((await Call("GET", "/character", { token: Friend.token })).json[0].name, "Renamed_1");
        assert.equal((await Call("GET", "/accountinfo", { token: Friend.token })).json.username, "Renamed_1");
        assert.equal((await Call("GET", "/account/api/public/account", { token: Friend.token })).json.displayName, "Renamed_1");
        assert.equal((await Call("POST", "/party", { token: Friend.token, body: {} })).json.playerStates[0].displayName, "Renamed_1");
        assert.equal((await Call("GET", "/undaunted/api/GetUserInfo", { key: Friend.key })).json.Username, "Renamed_1");
    });

    it("refuses a taken or invalid name and an unknown account", async () => {
        AssertError(await Call("POST", "/undaunted/api/RenameUser", { body: { UserId: Friend.userId, NewUsername: "slayer" }, key: ADMIN_KEY }), 409, "username_taken");
        AssertError(await Call("POST", "/undaunted/api/RenameUser", { body: { UserId: Friend.userId, NewUsername: "no" }, key: ADMIN_KEY }), 400, "username_invalid");
        AssertError(await Call("POST", "/undaunted/api/RenameUser", { body: { Username: "Nobody_At_All", NewUsername: "Fine_Name" }, key: ADMIN_KEY }), 404, "not_found");
        AssertError(await Call("POST", "/undaunted/api/RenameUser", { body: { NewUsername: "Fine_Name" }, key: ADMIN_KEY }), 400, "bad_request");
    });

    it("ACCOUNT_DISPLAY_NAME=0 puts the old {} display name back", async () => {
        process.env.ACCOUNT_DISPLAY_NAME = "0";

        try{
            assert.deepEqual((await Call("GET", "/account/api/public/account", { token: Friend.token })).json.displayName, {});
            assert.deepEqual((await Call("POST", "/party", { token: Friend.token, body: {} })).json.playerStates[0].displayName, {});
        }
        finally{
            delete process.env.ACCOUNT_DISPLAY_NAME;
        }
    });
});

const STATUS_KEYS = ["name", "online", "version", "commit", "sourceUrl", "registration", "playersOnline", "players", "instances", "contentPort", "uptimeSeconds", "limited"];

describe("GET /undaunted/api/ServerStatus", () => {
    it("shows a registered player who is online where and the deploy server's three servers, with no ids, keys or addresses", async () => {
        Fake = await StartFakeDeployServer(FRIENDS_DEPLOYSERVER_PORT, ThreeServers(Friend.userId));
        ClearServerStatusCache();

        // The friend is in the hunt, the admin in Ramsgate; a game-server heartbeat carries no player
        assert.equal((await Call("POST", "/heartbeat", { token: Friend.token, body: { map: "/Game/Maps/islands/1702/cora_jamima" } })).text, "20000");
        const AdminToken = await Login(ADMIN_KEY);
        assert.equal((await Call("POST", "/heartbeat", { token: AdminToken, body: { map: "/Game/Maps/ramsgate/ramsgate_01_persistent", state: "city" } })).status, 200);

        const Reply = await Call("GET", "/undaunted/api/ServerStatus", { key: Friend.key });
        assert.equal(Reply.status, 200);
        assert.match(Reply.type ?? "", /application\/json/);

        const Status = Reply.json;
        assert.deepEqual(Object.keys(Status), STATUS_KEYS);
        assert.equal(Status.limited, false);
        assert.equal(Status.name, "Dauntless Revived");
        assert.equal(Status.online, true);
        assert.equal(typeof Status.version, "string");
        assert.equal(typeof Status.commit, "string");
        assert.equal(Status.sourceUrl, "https://github.com/mixutin/dauntless-revived");
        assert.equal(Status.registration, "OPEN");
        assert.equal(Status.contentPort, 61002);
        assert.ok(Number.isInteger(Status.uptimeSeconds) && Status.uptimeSeconds >= 0);
        assert.equal(Status.playersOnline, 2);
        assert.deepEqual(Status.players, [
            { name: "Renamed_1", where: "hunt", instance: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d02" },
            { name: "Slayer", where: "city", instance: "5c0a9e36-8a51-4c1b-9d7e-1f2a3b4c5d01" }
        ]);
        assert.deepEqual(Status.instances.map((Instance: any) => [Instance.kind, Instance.title, Instance.behemoth, Instance.players, Instance.maxPlayers]), [
            ["city", "Ramsgate", null, 1, 32],
            ["hunt", "Hunt: Lesser Embermane", "Lesser Embermane", 1, 4],
            ["tutorial", "Tutorial", "Gnasher", 0, 1]
        ]);

        for(const Instance of Status.instances){
            assert.deepEqual(Object.keys(Instance), ["id", "kind", "title", "map", "behemoth", "players", "maxPlayers", "startedAt"]);
            assert.ok(!Number.isNaN(Date.parse(Instance.startedAt)));
        }

        assert.equal(Reply.text.includes(Friend.userId), false);
        assert.equal(Reply.text.includes("UID-admin"), false);
        assert.doesNotMatch(Reply.text, /UID-|UUK_|eyJ|127\.0\.0\.1/);
        assert.equal(Reply.headers.get("cache-control"), "no-store");
        assert.match(Reply.headers.get("vary") ?? "", /x-undaunted-user-api-key/i);
    });

    it("no key: 200, the same shape with no players and no servers, limited", async () => {
        const Full = (await Call("GET", "/undaunted/api/ServerStatus", { key: Friend.key })).json;
        const Requests = Fake!.Requests.length;
        ClearServerStatusCache();
        const Reply = await Call("GET", "/undaunted/api/ServerStatus");

        assert.equal(Reply.status, 200);
        assert.deepEqual(Object.keys(Reply.json), STATUS_KEYS);
        assert.deepEqual([Reply.json.playersOnline, Reply.json.players, Reply.json.instances, Reply.json.limited], [0, [], [], true]);
        for(const Key of ["name", "online", "version", "commit", "sourceUrl", "registration", "contentPort"]){
            assert.deepEqual(Reply.json[Key], Full[Key], Key);
        }
        assert.doesNotMatch(Reply.text, /Renamed_1|Slayer|5c0a9e36|UID-|UUK_|eyJ/);
        assert.equal(Fake!.Requests.length, Requests, "a limited answer never asks the deploy server");
    });

    it("a bad key or a bad token: 200 limited, never a 401", async () => {
        for(const Options of [{ key: "UUK_not_a_real_key_000000000000000000" }, { key: Friend.key + "0" }, { key: "UID-admin" }, { token: "not.a.token" }, { token: Friend.token.slice(0, -6) + "AAAAAA" }]){
            const Reply = await Call("GET", "/undaunted/api/ServerStatus", Options);
            assert.equal(Reply.status, 200, JSON.stringify(Object.keys(Options)));
            assert.deepEqual([Reply.json.limited, Reply.json.playersOnline, Reply.json.players.length, Reply.json.instances.length], [true, 0, 0, 0]);
        }
    });

    it("a player's key, an admin's key or a player's token: the full answer", async () => {
        for(const Options of [{ key: Friend.key }, { key: ADMIN_KEY }, { token: Friend.token }, { key: "UUK_wrong", token: Friend.token }]){
            const Reply = await Call("GET", "/undaunted/api/ServerStatus", Options);
            assert.equal(Reply.status, 200);
            assert.equal(Reply.json.limited, false, JSON.stringify(Object.keys(Options)));
            assert.equal(Reply.json.playersOnline, 2);
            assert.deepEqual(Reply.json.players.map((Player: any) => Player.name), ["Renamed_1", "Slayer"]);
            assert.equal(Reply.json.instances.length, 3);
        }
    });

    it("answers each variant from its own 5 s cache", async () => {
        ClearServerStatusCache();
        await Call("GET", "/undaunted/api/ServerStatus");
        await Call("GET", "/undaunted/api/ServerStatus", { token: Friend.token });
        const Requests = Fake!.Requests.length;
        const [A, B, C, D] = await Promise.all([
            Call("GET", "/undaunted/api/ServerStatus"),
            Call("GET", "/undaunted/api/ServerStatus"),
            Call("GET", "/undaunted/api/ServerStatus", { key: Friend.key }),
            Call("GET", "/undaunted/api/ServerStatus", { key: ADMIN_KEY })
        ]);

        assert.equal(A.status, 200);
        assert.equal(A.text, B.text);
        assert.equal(C.text, D.text);
        assert.notEqual(A.text, C.text);
        assert.equal(Fake!.Requests.length, Requests);
    });
});

describe("GET /dauntless-status", () => {
    it("keeps the nine fields the client reads and adds the source link, and says nothing about players", async () => {
        const Reply = await Call("GET", "/dauntless-status");
        const Keys = Object.keys(Reply.json);

        assert.deepEqual(Keys.slice(0, 9), ["show-status", "en", "fr", "it", "es", "de", "pt", "ru", "ja"]);
        assert.equal(Reply.json["show-status"], true);
        assert.deepEqual(Keys.slice(9), ["name", "version", "commit", "sourceUrl"]);
        assert.equal(Reply.json.sourceUrl, "https://github.com/mixutin/dauntless-revived");

        // Two players are online (the ServerStatus test's heartbeats), yet anyone may call this
        // route: not even the count is in it, with or without a key
        assert.equal(GetOnlinePlayerActivity().length, 2);
        for(const Options of [{}, { key: Friend.key }, { token: Friend.token }]){
            assert.deepEqual(Object.keys((await Call("GET", "/dauntless-status", Options)).json), Keys);
        }
    });

    it("STATUS_EXTRA=0 answers the nine fields alone", async () => {
        process.env.STATUS_EXTRA = "0";

        try{
            const Reply = await Call("GET", "/dauntless-status");
            assert.deepEqual(Object.keys(Reply.json), ["show-status", "en", "fr", "it", "es", "de", "pt", "ru", "ja"]);
            assert.equal(Reply.json.en, "Welcome to Dauntless Revived!");
        }
        finally{
            delete process.env.STATUS_EXTRA;
        }
    });

    // The banner the game draws: a welcome to the server by its name, translated for each
    // language the client asks for, with no version (upstream sent "Welcome to Undaunted v0.0.5!"
    // in English under every key)
    it("welcomes the player to the server by name, in each of the client's languages", async () => {
        const Saved = process.env.SERVER_NAME;

        try{
            delete process.env.SERVER_NAME;
            const Default = (await Call("GET", "/dauntless-status")).json;

            assert.deepEqual(StatusTexts(Default), {
                en: "Welcome to Dauntless Revived!",
                fr: "Bienvenue sur Dauntless Revived !",
                it: "Ti diamo il benvenuto su Dauntless Revived!",
                es: "¡Te damos la bienvenida a Dauntless Revived!",
                de: "Willkommen bei Dauntless Revived!",
                pt: "Boas-vindas ao Dauntless Revived!",
                ru: "Добро пожаловать в Dauntless Revived!",
                ja: "Dauntless Revivedへようこそ！"
            });
            assert.equal(Default.name, "Dauntless Revived");

            // Every language has its own text, none of them carries a version number
            const Texts = Object.values(StatusTexts(Default));
            assert.equal(new Set(Texts).size, Texts.length);
            for(const Text of Texts){
                assert.doesNotMatch(Text, /undaunted|\d+\.\d+/i);
            }

            process.env.SERVER_NAME = "Friday Hunts";
            const Named = (await Call("GET", "/dauntless-status")).json;

            assert.equal(Named.en, "Welcome to Friday Hunts!");
            assert.equal(Named.de, "Willkommen bei Friday Hunts!");
            assert.equal(Named.ja, "Friday Huntsへようこそ！");
            assert.equal(Named.name, "Friday Hunts");
            for(const Text of Object.values(StatusTexts(Named))){
                assert.ok(Text.includes("Friday Hunts") && !Text.includes("Dauntless Revived"), Text);
            }

            // Only printable ASCII of SERVER_NAME is used, as for the ServerStatus name
            process.env.SERVER_NAME = "  \u0007Night\u200bShift  ";
            assert.equal((await Call("GET", "/dauntless-status")).json.en, "Welcome to NightShift!");
        }
        finally{
            if(Saved === undefined){ delete process.env.SERVER_NAME; } else { process.env.SERVER_NAME = Saved; }
        }
    });
});

function StatusTexts(Reply: any){
    const Texts: Record<string, string> = {};

    for(const Language of ["en", "fr", "it", "es", "de", "pt", "ru", "ja"]){
        assert.equal(typeof Reply[Language], "string", Language);
        Texts[Language] = Reply[Language];
    }

    return Texts;
}

describe("GET /product/skus/public", () => {
    it("tells the player the store is not available, in plain English", async () => {
        // With every store off; Lady Luck and the Middleman are on by default
        const Old = [process.env.TRIALS_STORE, process.env.MIDDLEMAN_STORE];
        process.env.TRIALS_STORE = "off";
        process.env.MIDDLEMAN_STORE = "off";
        try{
            const Reply = await Call("GET", "/product/skus/public", { token: Friend.token });

            assert.equal(Reply.status, 400);
            assert.deepEqual(Reply.json, { code: "400", message: "The store is not available on Dauntless Revived yet." });
        }
        finally{
            for(const [Name, Value] of [["TRIALS_STORE", Old[0]], ["MIDDLEMAN_STORE", Old[1]]] as const){
                if(Value === undefined) delete process.env[Name]; else process.env[Name] = Value;
            }
        }
    });
});

// Nothing a player or the launcher is shown names upstream's product. Routes and headers
// (/undaunted/api/..., x-undaunted-...) are wire identifiers, not text anyone reads.
describe("player-visible replies", () => {
    it("never say Undaunted", async () => {
        const Calls: [string, { key?: string, token?: string }][] = [
            ["/dauntless-status", {}],
            ["/dauntless-status", { token: Friend.token }],
            ["/product/skus/public", { token: Friend.token }],
            ["/undaunted/api/ServerStatus", {}],
            ["/undaunted/api/ServerStatus", { key: Friend.key }],
            ["/undaunted/api/GetUserInfo", { key: Friend.key }],
            ["/undaunted/api/UsernameAvailable?Username=Someone_New", {}],
            ["/accountinfo", { token: Friend.token }],
            ["/character", { token: Friend.token }]
        ];

        for(const [Path, Options] of Calls){
            const Reply = await Call("GET", Path, Options);
            assert.ok(Reply.status < 500, `${Path}: ${Reply.status}`);
            assert.doesNotMatch(Reply.text.replace(/\/undaunted\/api\//gi, "/"), /undaunted/i, Path);
        }
    });
});

describe("GET /undaunted/api/Playtime", () => {
    it("answers the key's own account and nothing else", async () => {
        const Reply = await Call("GET", "/undaunted/api/Playtime", { key: Friend.key });

        assert.equal(Reply.status, 200);
        assert.deepEqual(Object.keys(Reply.json), ["PlaytimeSeconds"]);
        assert.equal(Reply.json.PlaytimeSeconds, GetPlaytimeSeconds(Friend.userId));
    });

    it("refuses without a valid key", async () => {
        assert.equal((await Call("GET", "/undaunted/api/Playtime")).status, 401);
        assert.equal((await Call("GET", "/undaunted/api/Playtime", { key: "UUK_wrong" })).status, 401);
    });
});
