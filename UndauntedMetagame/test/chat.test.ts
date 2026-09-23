import { RemoveTestDb } from "./setup";
import "./authenv";
// Every stanza these tests make the server send is checked: none outside a room from the receiver's own account
import "./chatinvariant";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { ChatServer, ReadChatConfig, StartChat } from "../src/realtime/chat";
import { UrlEncodeLikeClient } from "../src/realtime/chatnick";
import { EscapeXml, ParseFrame } from "../src/realtime/xmpp";
import { ChatClientModel, JOINED, LookupFrom, NOT_JOINED } from "./chatclient";
import {
    Base64Plain, CaptureLogs, ClientFrame, DOMAIN, FRAMING, GameResource, Login, LoginOptions, LogCapture, RawClosed, RawUpgrade,
    WireClient
} from "./chatwire";
import { eq } from "drizzle-orm";
import { GetDb } from "../src/db";
import { guildmembers, guilds, users } from "../src/db/schema";
import { BlockPlayer, UnblockPlayer } from "../src/controllers/friends";
import { AcceptPartyInvite, InviteToParty, KickPartyMember, PollParty, ResetPartiesForTests } from "../src/controllers/party";
import { SignMetagameJWTForUid } from "../src/controllers/auth";

const A = "UID-chat-a";
const B = "UID-chat-b";
let server: ChatServer;
const sockets: WebSocket[] = [];
const queues = new WeakMap<WebSocket, { items: string[]; waiters: Array<(value: string) => void> }>();

function frame(socket: WebSocket, label = "chat frame"): Promise<string> {
    const queue = queues.get(socket)!;
    if (queue.items.length > 0) return Promise.resolve(queue.items.shift()!);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2000);
        queue.waiters.push((value) => { clearTimeout(timer); resolve(value); });
    });
}

async function connect(): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`, ["xmpp"]);
    sockets.push(socket);
    const queue = { items: [] as string[], waiters: [] as Array<(value: string) => void> };
    queues.set(socket, queue);
    socket.on("message", (data) => {
        const next = queue.waiters.shift();
        if (next) next(data.toString());
        else queue.items.push(data.toString());
    });
    await once(socket, "open");
    return socket;
}

async function login(id: string): Promise<WebSocket> {
    const socket = await connect();
    const opened = frame(socket);
    socket.send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="prod.ol.epicgames.com" version="1.0"/>');
    assert.match(await opened, /<open /);
    assert.match(await frame(socket), /PLAIN/);
    const success = frame(socket);
    const encoded = Buffer.from(`\0${id}\0${SignMetagameJWTForUid(id)}`).toString("base64");
    socket.send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${encoded}</auth>`);
    assert.match(await success, /success/);
    const reopening = frame(socket);
    socket.send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>');
    assert.match(await reopening, /<open /);
    assert.match(await frame(socket), /bind/);
    const bound = frame(socket);
    socket.send('<iq type="set" id="bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>game</resource></bind></iq>');
    assert.match(await bound, new RegExp(`${id}@prod.ol.epicgames.com/game`));
    return socket;
}

before(async () => {
    GetDb().insert(users).values([{ userId: A, name: "Alpha", notes: 0, isAdmin: false }, { userId: B, name: "Bravo", notes: 0, isAdmin: false }]).run();
    server = new ChatServer();
    await server.listen(0);
});

after(async () => {
    for (const socket of sockets) socket.terminate();
    await server.close();
    RemoveTestDb(() => GetDb().$client.close());
});

describe("experimental chat", () => {
    it("rejects a token for another account", async () => {
        const socket = await connect();
        socket.send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>');
        await frame(socket);
        await frame(socket);
        const failure = frame(socket);
        const encoded = Buffer.from(`\0${A}\0${SignMetagameJWTForUid(B)}`).toString("base64");
        socket.send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${encoded}</auth>`);
        assert.match(await failure, /not-authorized/);
    });

    it("routes a direct message and a shared room message between two authenticated accounts", async () => {
        const a = await login(A);
        const b = await login(B);
        const direct = frame(b, "direct message");
        a.send(`<message to="${B}@prod.ol.epicgames.com" type="chat" id="m1"><body>Hello &amp; welcome</body></message>`);
        assert.match(await direct, /Hello &amp; welcome/);
        // Names observed in the 1.4.4 client log, not a fabricated generic room. Rooms live on
        // muc.<domain>, and the client joins with <name>:<account id>:<resource> (docs/findings/chat.md).
        const city = "City-d147475b-7742-4e7b-8142-6c0f55dda06b@muc.prod.ol.epicgames.com";
        const alpha = `Alpha:${A}:game`;
        const bravo = `Bravo:${B}:game`;
        const joinedA = frame(a);
        a.send(`<presence to="${city}/${alpha}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
        const joinedAlpha = await joinedA;
        assert.match(joinedAlpha, /status code="110"/);
        assert.ok(joinedAlpha.includes(`from="${city}/${alpha}"`), "the nickname is kept as sent");
        assert.ok(joinedAlpha.includes(`jid="${A}@prod.ol.epicgames.com/game"`), "and the occupant's own JID");
        const seenByB = frame(b);
        b.send(`<presence to="${city}/${bravo}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
        const alphaForB = await seenByB;
        assert.ok(alphaForB.includes(`from="${city}/${alpha}"`) && !alphaForB.includes("110"), "B first hears of A");
        const joinedBravo = await frame(b);
        assert.match(joinedBravo, /status code="110"/);
        assert.ok(joinedBravo.includes(`from="${city}/${bravo}"`));
        assert.ok((await frame(a)).includes(`from="${city}/${bravo}"`), "A hears of B");
        const room = frame(b, "room message");
        a.send(`<message to="${city}" type="groupchat" id="m2"><body>Ready?</body></message>`);
        const delivered = await room;
        assert.match(delivered, /Ready\?/);
        assert.ok(delivered.includes(`from="${city}/${alpha}"`));
        assert.doesNotMatch(delivered, /<nick /, "no XEP-0172 nickname: the client never reads it");
        assert.match(await frame(a), /Ready\?/);
    });
});

// ---- The listener itself (docs/findings/chat.md): handshake, login, crash guard, start, logs ----
// These run on their own ChatServer with a test clock (port 0), next to the prototype's tests above.

const C = "UID-chat-c";
const D = "UID-chat-d";
const GONE = "UID-chat-gone"; // signed tokens for it exist, the account does not
const OLD = "UID-chat-old";
const OLD_NAME = "Sölve Ö"; // an older name outside today's username rules
const LOOP = "UID-chat-loop";
const FLOOD = "UID-chat-flood";
const JOINS = "UID-chat-joins";
let Now = Date.parse("2026-09-22T12:00:00Z");
let Wire: ChatServer;
let Logs: LogCapture;
const Opened: WireClient[] = [];
const SECRET_MARKERS: string[] = [];

async function Connected(Server = Wire, Headers: Record<string, string> = {}){
    const Client = await WireClient.Connect(Server.port, Headers);
    Opened.push(Client);
    return Client;
}

async function SignedIn(Uid: string, Options: LoginOptions = {}, Server = Wire){
    const Client = await Login(Server.port, Uid, Options);
    Opened.push(Client);
    return Client;
}

// Open and features, then the SASL answer to this payload
async function SaslAnswer(Client: WireClient, Payload: string, Mechanism = "PLAIN"){
    Client.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
    await Client.Expect("open");
    await Client.Expect("features");
    SECRET_MARKERS.push(Payload);
    Client.Send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="${Mechanism}">${Payload}</auth>`);
    return Client.Expect("sasl answer");
}

function SignWith(Uid: string, Options: jwt.SignOptions){
    const Key = Buffer.from(process.env.AUTH_SIGNING_PRIVKEY_B64!, "base64").toString("utf8");
    return jwt.sign({ userId: Uid }, Key, { algorithm: "RS256", issuer: "undaunted-metagame", audience: "undaunted-metagame", ...Options });
}

let Whispers = 0;

async function Whispered(From: WireClient, To: WireClient, Marker: string){
    From.Send(`<message to="${To.Uid}@${DOMAIN}" type="chat" id="w${++Whispers}"><body>${Marker}</body></message>`);
    await From.Barrier();
    return (await To.Barrier()).some((Frame) => Frame.includes(Marker));
}

describe("chat listener", () => {
    before(async () => {
        GetDb().insert(users).values([
            { userId: C, name: "Charlie", notes: 0, isAdmin: false }, { userId: D, name: "Delta", notes: 0, isAdmin: false },
            { userId: OLD, name: OLD_NAME, notes: 0, isAdmin: false }, { userId: LOOP, name: "Loop", notes: 0, isAdmin: false },
            { userId: FLOOD, name: "Flood", notes: 0, isAdmin: false }, { userId: JOINS, name: "Joins", notes: 0, isAdmin: false }
        ]).run();
        Logs = CaptureLogs();
        Wire = new ChatServer({ Clock: () => Now, AutoTick: false });
        await Wire.listen(0);
    });

    after(async () => {
        for(const Client of Opened) Client.Close();
        await Wire.close();
        Logs.Stop();
    });

    describe("handshake", () => {
        it("answers the game's handshake frame by frame, and echoes its 67-character resource", async () => {
            const Client = await Connected();
            const Resource = GameResource();
            const Token = SignMetagameJWTForUid(C);

            assert.equal(Resource.length, 67);
            Client.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
            assert.match(await Client.Expect(), /^<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="prod\.ol\.epicgames\.com" id="[0-9a-f]{16}" version="1\.0" xml:lang="en"\/>$/);
            assert.equal(await Client.Expect(), `<stream:features xmlns:stream="http://etherx.jabber.org/streams"><mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms></stream:features>`);
            SECRET_MARKERS.push(Base64Plain("", C, Token));
            Client.Send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${Base64Plain("", C, Token)}</auth>`);
            assert.equal(await Client.Expect(), `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
            Client.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
            assert.match(await Client.Expect(), /^<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="prod\.ol\.epicgames\.com" id="[0-9a-f]{16}" version="1\.0" xml:lang="en"\/>$/);
            assert.equal(await Client.Expect(), `<stream:features xmlns:stream="http://etherx.jabber.org/streams"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/></stream:features>`);
            Client.Send(`<iq type="set" id="_xmpp_bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${Resource}</resource></bind></iq>`);
            assert.equal(await Client.Expect(), `<iq xmlns="jabber:client" type="result" id="_xmpp_bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${C}@${DOMAIN}/${Resource}</jid></bind></iq>`);

            // Each server message is one complete stanza
            for(const Frame of Client.Frames){
                assert.ok(ParseFrame(Frame), Frame);
            }

            Client.Send(`<iq type="set" id="_xmpp_session1"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>`);
            assert.equal(await Client.Expect(), `<iq xmlns="jabber:client" type="result" id="_xmpp_session1"/>`);
            Client.Send(`<iq type="get" id="v1"><query xmlns="jabber:iq:version"/></iq>`);
            assert.equal(await Client.Expect(), `<iq xmlns="jabber:client" type="result" id="v1"/>`);
            assert.ok(Logs.Lines.some((Line) => Line.includes(`chat: bound c=`) && Line.includes(`uid=${C} resource=${Resource} domain=${DOMAIN} sessions=1`)));
        });

        it("takes a host or launcher host:port from <open to>, and falls back when it is missing or invalid", async () => {
            const Local = await SignedIn(D, { OpenTo: "dauntless.local" });
            assert.equal(Local.Domain, "dauntless.local");
            await Local.Logout();

            const Launcher = await SignedIn(D, { OpenTo: "127.0.0.1:61000" });
            assert.equal(Launcher.Domain, "127.0.0.1:61000");
            await Launcher.Logout();

            const Missing = await SignedIn(D, { OpenTo: null });
            assert.equal(Missing.Domain, DOMAIN);
            await Missing.Logout();

            const Odd = await SignedIn(D, { OpenTo: "not a host!" });
            assert.equal(Odd.Domain, DOMAIN);
            await Odd.Logout();
        });

        it("gives an empty resource a server one, and refuses an over-long one or one with control characters", async () => {
            const Empty = await SignedIn(D, { Resource: "" });
            assert.match(Empty.Resource, /^srv-[0-9a-f]{32}$/);

            for(const Bad of ["x".repeat(257), "V2:\tTab"]){
                const Client = await Connected();
                SECRET_MARKERS.push(Base64Plain("", D, SignMetagameJWTForUid(D)));
                assert.match(await SaslAnswer(Client, Base64Plain("", D, SignMetagameJWTForUid(D))), /<success/);
                Client.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
                await Client.Expect();
                await Client.Expect();
                Client.Send(`<iq type="set" id="_xmpp_bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${Bad}</resource></bind></iq>`);
                assert.equal(await Client.Expect(), `<iq xmlns="jabber:client" type="error" id="_xmpp_bind1"><error type="modify"><bad-request xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`);
                assert.ok(Client.IsOpen, "a refused bind does not hang up");
            }
        });

        it("answers the client's <close/> with its own and hangs up", async () => {
            const Client = await SignedIn(C);
            Client.Send(`<close xmlns="${FRAMING}"/>`);
            assert.equal(await Client.Expect(), `<close xmlns="${FRAMING}"/>`);
            assert.equal((await Client.Closed).Code, 1000);
            assert.ok(Logs.Lines.some((Line) => /chat: closed c=\d+ uid=UID-chat-c reason=close after=\d+s/.test(Line)));
        });
    });

    describe("login", () => {
        it("refuses a token for another account, then the legacy login the game tries next, and hangs up", async () => {
            const Client = await Connected();
            assert.equal(await SaslAnswer(Client, Base64Plain("", C, SignMetagameJWTForUid(D))), `<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><not-authorized/></failure>`);
            assert.ok(Client.IsOpen, "the game gets to send its legacy login");
            Client.Send(`<iq type="set" id="_xmpp_auth1"><query xmlns="jabber:iq:auth"><username>${C}</username><password>not-a-real-password-marker</password><resource>r</resource></query></iq>`);
            SECRET_MARKERS.push("not-a-real-password-marker");
            assert.equal(await Client.Expect(), `<iq xmlns="jabber:client" type="error" id="_xmpp_auth1"><error type="auth"><not-authorized xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`);
            await Client.Closed;
            assert.ok(Logs.Lines.some((Line) => /chat: login refused c=\d+ reason=uid-mismatch uid=UID-chat-c$/.test(Line)));
        });

        it("refuses an expired token, a deleted account, another mechanism and a malformed payload", async () => {
            const Cases: Array<[string, string, string, string]> = [
                ["expired", Base64Plain("", C, SignWith(C, { expiresIn: -60 })), "PLAIN", "not-authorized"],
                ["no-account", Base64Plain("", GONE, SignMetagameJWTForUid(GONE)), "PLAIN", "not-authorized"],
                ["bad-token", Base64Plain("", C, "not.a.token"), "PLAIN", "not-authorized"],
                ["bad-mechanism", Base64Plain("", C, SignMetagameJWTForUid(C)), "SCRAM-SHA-1", "invalid-mechanism"],
                ["bad-format", Buffer.from(`${C}\0only-two`).toString("base64"), "PLAIN", "not-authorized"],
                ["bad-format", Base64Plain(D, C, SignMetagameJWTForUid(C)), "PLAIN", "not-authorized"]
            ];

            for(const [Reason, Payload, Mechanism, Condition] of Cases){
                const Client = await Connected();
                assert.equal(await SaslAnswer(Client, Payload, Mechanism), `<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><${Condition}/></failure>`, Reason);
                Client.Close();
                assert.ok(Logs.Lines.some((Line) => Line.includes(`reason=${Reason}`)), Reason);
            }
        });

        it("holds an address back after 10 failed logins in 10 minutes", async () => {
            const Own = new ChatServer({ Clock: () => Now, AutoTick: false });
            await Own.listen(0);

            try{
                for(let Attempt = 0; Attempt < 10; Attempt++){
                    const Client = await Connected(Own);
                    assert.match(await SaslAnswer(Client, Base64Plain("", C, SignMetagameJWTForUid(D))), /not-authorized/);
                    Client.Close();
                }

                const Held = await Connected(Own);
                assert.equal(await SaslAnswer(Held, Base64Plain("", C, SignMetagameJWTForUid(C))), `<failure xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><temporary-auth-failure/></failure>`);
                Held.Close();

                Now += 10 * 60 * 1000;
                const Later = await Login(Own.port, C);
                Opened.push(Later);
                assert.ok(Later.IsOpen);
            }
            finally{
                await Own.close();
            }
        });

        it("hangs up on a connection that does not log in within 15 s, or bind within 10 s of its login", async () => {
            const Silent = await Connected();
            Now += 15 * 1000;
            Wire.Tick();
            await Silent.Closed;

            const Unbound = await Connected();
            Now += 12 * 1000;
            assert.match(await SaslAnswer(Unbound, Base64Plain("", C, SignMetagameJWTForUid(C))), /<success/);
            Now += 9 * 1000;
            Wire.Tick();
            assert.ok(Unbound.IsOpen, "10 s from the login, not from the connection");
            Now += 1000;
            Wire.Tick();
            await Unbound.Closed;
        });

        it("before login: a few frames only, and one SASL attempt per connection", async () => {
            // A flood of <open/> that is never read: the connection ends at the fifth frame, having been
            // answered four times
            const Before = Logs.Lines.length;
            const Flood = await Connected();
            Flood.Socket.pause();
            for(let Index = 0; Index < 200; Index++) Flood.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
            await new Promise((Resolve) => setTimeout(Resolve, 200));
            assert.ok(Logs.Lines.slice(Before).some((Line) => /^info chat: closed c=\d+ uid=- reason=refused after=\d+s$/.test(Line)));
            Flood.Socket.resume();
            await Flood.Closed;
            assert.ok(Flood.Frames.length <= 8, "at most two frames for each of the first four");

            // A second <auth> after a refused one ends the connection
            const Twice = await Connected();
            assert.match(await SaslAnswer(Twice, Base64Plain("", C, SignMetagameJWTForUid(D))), /not-authorized/);
            SECRET_MARKERS.push(Base64Plain("", C, SignMetagameJWTForUid(C)));
            Twice.Send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${Base64Plain("", C, SignMetagameJWTForUid(C))}</auth>`);
            assert.equal(await Twice.Next(), undefined, "closed without an answer");
        });

        it("one account has at most three connections: a new login closes the oldest one that has not bound", async () => {
            const Own = new ChatServer({ Clock: () => Now, AutoTick: false });
            await Own.listen(0);

            try{
                const Pending: WireClient[] = [];

                for(let Index = 0; Index < 5; Index++){
                    const Client = await Connected(Own);
                    assert.match(await SaslAnswer(Client, Base64Plain("", LOOP, SignMetagameJWTForUid(LOOP))), /<success/);
                    Pending.push(Client);
                }

                await Pending[0].Closed;
                await Pending[1].Closed;
                assert.ok(Pending.slice(2).every((Client) => Client.IsOpen), "the three newest stay");

                // They count toward the address's limit of 8 unfinished logins until they bind
                const More: WireClient[] = [];
                for(let Index = 0; Index < 5; Index++) More.push(await Connected(Own));
                await assert.rejects(Connected(Own), /503/);

                // Binding the same resource replaces the older session; the account's next login then waits 60 s
                const Resource = GameResource();
                for(const Client of Pending.slice(2)){
                    Client.Send(`<open xmlns="${FRAMING}" to="${DOMAIN}" version="1.0"/>`);
                    await Client.Expect();
                    await Client.Expect();
                    Client.Send(`<iq type="set" id="_xmpp_bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${Resource}</resource></bind></iq>`);
                    await Client.Expect("bind");
                }

                assert.ok(Pending[4].IsOpen);
                const Held = await Connected(Own);
                assert.match(await SaslAnswer(Held, Base64Plain("", LOOP, SignMetagameJWTForUid(LOOP))), /temporary-auth-failure/);
                for(const Client of [...More, Held]) Client.Close();
            }
            finally{
                await Own.close();
            }
        });

        it("three logins of one account in 10 minutes that never bind hold its logins back for 60 s", async () => {
            const Own = new ChatServer({ Clock: () => Now, AutoTick: false });
            await Own.listen(0);

            try{
                for(let Index = 0; Index < 3; Index++){
                    const Client = await Connected(Own);
                    assert.match(await SaslAnswer(Client, Base64Plain("", LOOP, SignMetagameJWTForUid(LOOP))), /<success/);
                    Now += 10 * 1000;
                    Own.Tick();
                    await Client.Closed;
                }

                const Held = await Connected(Own);
                assert.match(await SaslAnswer(Held, Base64Plain("", LOOP, SignMetagameJWTForUid(LOOP))), /temporary-auth-failure/);
                Held.Close();
                Now += 60 * 1000;
                Own.Tick();
                const Later = await Login(Own.port, LOOP);
                await Later.Logout();
            }
            finally{
                await Own.close();
            }
        });
    });

    describe("liveness", () => {
        it("pings a connection that was silent for 50 s, keeps it when it answers late (a long map load), and ends it 100 s after an unanswered ping", async () => {
            const Client = await SignedIn(C);
            Client.AutoPong = false;
            Now += 50 * 1000;
            Wire.Tick();

            // The game answers from its game-thread tick, which a map load holds up: 99 s later is in time
            const Ping = await Client.Expect("server ping");
            assert.match(Ping, new RegExp(`^<iq xmlns="jabber:client" type="get" id="(sp\\d+)" from="${DOMAIN}" to="${C}@${DOMAIN}/${Client.Resource}"><ping xmlns="urn:xmpp:ping"/></iq>$`));
            Now += 99 * 1000;
            Wire.Tick();
            assert.ok(Client.IsOpen, "still waiting for the answer");
            Client.Send(`<iq type="result" id="${/id="(sp\d+)"/.exec(Ping)![1]}"/>`);
            await Client.Barrier();
            Now += 30 * 1000;
            Wire.Tick();
            assert.ok(Client.IsOpen, "answered, so still connected");

            Now += 20 * 1000;
            Wire.Tick();
            await Client.Expect("second ping");
            Now += 99 * 1000;
            Wire.Tick();
            assert.ok(Client.IsOpen);
            Now += 1000;
            Wire.Tick();
            await Client.Closed;
            assert.ok(Logs.Lines.some((Line) => /chat: closed c=\d+ uid=UID-chat-c reason=ping-timeout/.test(Line)));

            // A ping timeout does not hold the account's next login back: one reconnect is not a loop
            Opened.push(await Login(Wire.port, C));
        });
    });

    describe("crash guard", () => {
        it("survives oversized frames, bad UTF-8, bad opcodes, DTDs and garbage, and never hangs up a signed-in player over bad XML", async () => {
            const Sender = await SignedIn(C);
            const Receiver = await SignedIn(D);
            assert.ok(await Whispered(Sender, Receiver, "marker-before-guard"));

            // Before login: a DTD gets a stream error and the connection ends; so does garbage
            const Early = await Connected();
            Early.Send(`<!DOCTYPE lol [<!ENTITY lol "lol">]><open/>`);
            assert.match(await Early.Expect(), /<restricted-xml xmlns="urn:ietf:params:xml:ns:xmpp-streams"\/>/);
            await Early.Closed;
            const Garbage = await Connected();
            Garbage.Send("<<<not xml");
            await Garbage.Closed;

            // After login: dropped, never hung up
            const Player = await SignedIn(C);
            for(const Bad of [`<!DOCTYPE x><iq/>`, `<?xml version="1.0"?><iq type="get" id="x"/>`, "<<<not xml", `<iq type="get" id="half"`, `<message><body>&bogus;</body></message>`, `<nonsense/>`]){
                Player.Send(Bad);
            }
            assert.deepEqual(await Player.Barrier(), []);
            assert.ok(Player.IsOpen);

            // A binary frame is read as text
            Player.Send(Buffer.from(`<iq type="get" id="bin1"><ping xmlns="urn:xmpp:ping"/></iq>`), true);
            assert.equal(await Player.Expect(), `<iq xmlns="jabber:client" type="result" id="bin1"/>`);

            // An oversized frame: ws closes with 1009, the metagame stays up
            const Big = await SignedIn(D);
            Big.Send(`<message to="${C}@${DOMAIN}" type="chat"><body>${"x".repeat(33 * 1024)}</body></message>`);
            assert.equal((await Big.Closed).Code, 1009);

            // Invalid UTF-8 in a text frame, a reserved opcode and an unmasked frame, over raw sockets
            for(const Frame of [ClientFrame(0x1, Buffer.from([0x3c, 0xff, 0xfe, 0x3e])), ClientFrame(0x3, Buffer.from("x")), ClientFrame(0x1, Buffer.from("<iq/>"), false)]){
                const Raw = await RawUpgrade(Wire.port);
                Raw.write(Frame);
                assert.ok(await RawClosed(Raw), "the bad connection is closed");
            }

            assert.ok(await Whispered(Sender, Receiver, "marker-after-guard"), "the others still chat");
        });

        it("refuses new connections with 503 past 8 unfinished logins from one address", async () => {
            const Own = new ChatServer({ Clock: () => Now, AutoTick: false });
            await Own.listen(0);

            try{
                const Pending: WireClient[] = [];

                for(let Index = 0; Index < 8; Index++){
                    Pending.push(await Connected(Own));
                }

                await assert.rejects(Connected(Own), /503/);

                for(const Client of Pending) Client.Close();
            }
            finally{
                await Own.close();
            }
        });

        it("a player who stops reading: at most the cap of unsent output is held for it, then it ends (backlog) and its logins wait 60 s", async () => {
            const Limit = 64 * 1024;
            const Own = new ChatServer({ Clock: () => Now, AutoTick: false, OutputLimit: Limit });
            await Own.listen(0);

            try{
                const Room = `City-backlog@muc.${DOMAIN}`;
                const Slow = await Login(Own.port, C);
                const Fast = await Login(Own.port, D);
                Opened.push(Slow, Fast);

                for(const [Client, Name] of [[Slow, "Charlie"], [Fast, "Delta"]] as const){
                    Client.Send(`<presence to="${EscapeXml(`${Room}/${Name}:${Client.Uid}:${Client.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                    await Client.Barrier();
                }

                await Slow.Barrier();
                Slow.Socket.pause();
                const Big = EscapeXml("<".repeat(2048));
                const Ended = () => Logs.Lines.some((Line) => new RegExp(`^info chat: closed c=\\d+ uid=${C} reason=backlog`).test(Line));
                let Largest = 0;

                for(let Round = 0; Round < 400 && !Ended(); Round++){
                    for(let Index = 0; Index < 8; Index++){
                        Fast.Send(`<message type="groupchat" to="${Room}" id="bl${Round}-${Index}"><body>${Big}</body></message>`);
                    }

                    await Fast.Barrier();
                    Largest = Math.max(Largest, Own.LargestBacklog);
                    // Still talking, so it is neither idle nor pinged; its next frame is where the server checks
                    Slow.Send(`<iq type="get" id="alive${Round}"><ping xmlns="urn:xmpp:ping"/></iq>`);
                    await new Promise((Resolve) => setImmediate(Resolve));
                    Now += 8 * 1000;
                }

                assert.ok(Ended(), "ended for its backlog");
                assert.ok(Largest <= Limit + 9 * 1024, `held ${Largest} bytes`);
                Slow.Socket.resume();
                await Slow.Closed;
                assert.ok(Fast.IsOpen, "the others chat on");

                const Next = await Connected(Own);
                assert.match(await SaslAnswer(Next, Base64Plain("", C, SignMetagameJWTForUid(C))), /temporary-auth-failure/);
                Next.Close();
            }
            finally{
                await Own.close();
            }
        });
    });

    describe("public mode", () => {
        it("takes the player's address from the gateway only when it carries the secret", async () => {
            const Secret = crypto.randomBytes(24).toString("hex");
            SECRET_MARKERS.push(Secret);
            process.env.GATEWAY_SECRET = Secret;

            try{
                await Connected(Wire, { "X-Dauntless-Gateway": Secret, "X-Forwarded-For": "203.0.113.7" });
                await Connected(Wire, { "X-Dauntless-Gateway": "wrong-secret-value-000", "X-Forwarded-For": "203.0.113.8" });
                await new Promise((Resolve) => setTimeout(Resolve, 50));
                assert.ok(Logs.Lines.some((Line) => /chat: connect c=\d+ from=203\.0\.113\.7 via=gateway$/.test(Line)));
                assert.ok(Logs.Lines.some((Line) => /chat: connect c=\d+ from=127\.0\.0\.1 via=direct$/.test(Line)));
                assert.ok(!Logs.Lines.some((Line) => Line.includes("203.0.113.8")));
            }
            finally{
                delete process.env.GATEWAY_SECRET;
            }
        });
    });

    describe("settings and start", () => {
        it("reads CHAT, CHAT_PORT and CHAT_BIND_HOST, with 127.0.0.1 the only host in public mode", () => {
            assert.equal(ReadChatConfig({}).Enabled, false);
            assert.deepEqual(ReadChatConfig({ CHAT: "1" }), { Enabled: true, Port: 61099, Host: "127.0.0.1", NickCheck: "enforce", Trace: false, Errors: [], Warnings: [] });
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_NICK_CHECK: "log" }).NickCheck, "log");
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_NICK_CHECK: "off" }).NickCheck, "enforce");
            assert.match(ReadChatConfig({ CHAT: "1", CHAT_NICK_CHECK: "off" }).Warnings[0], /CHAT_NICK_CHECK=off is not enforce or log/);
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_BIND_HOST: "::1" }).Errors.length, 0);
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_BIND_HOST: "::1", GATEWAY_SECRET: "x".repeat(32) }).Errors.length, 1);
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_BIND_HOST: "0.0.0.0" }).Errors.length, 1);
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_PORT: "70000" }).Errors.length, 1);
            assert.equal(ReadChatConfig({ CHAT: "1", CHAT_TRACE: "1" }).Trace, true);
            assert.match(ReadChatConfig({ EXPERIMENTAL_CHAT: "1" }).Warnings[0], /no longer read.*CHAT=1/);
        });

        it("logs one error line and starts nothing on a port in use or a bad host; the metagame starts anyway", async () => {
            const Blocker = net.createServer();
            await new Promise<void>((Resolve) => Blocker.listen(0, "127.0.0.1", () => Resolve()));
            const Taken = (Blocker.address() as net.AddressInfo).port;

            try{
                assert.equal(await StartChat({ CHAT: "1", CHAT_PORT: String(Taken) }), undefined);
                assert.ok(Logs.Lines.some((Line) => Line === `error chat: not started: could not listen on 127.0.0.1:${Taken} (EADDRINUSE). The metagame runs without chat.`));
                assert.equal(await StartChat({ CHAT: "1", CHAT_BIND_HOST: "0.0.0.0" }), undefined);
                assert.equal(await StartChat({}), undefined);

                // The real metagame process with chat on and its port taken: it still serves
                const Output = await RunMetagame({ CHAT: "1", CHAT_PORT: String(Taken) });
                assert.match(Output, /chat: not started: could not listen on 127\.0\.0\.1:\d+ \(EADDRINUSE\)/);
                assert.match(Output, /Clear Skies, Slayer\./);
            }
            finally{
                Blocker.close();
            }
        });
    });

    describe("rooms and names", () => {
        const CITY = "City-5f1c0000-aaaa-4bbb-8ccc-000000000001";
        const MUC_DOMAIN = `muc.${DOMAIN}`;

        // A player with a client model beside its connection: the model's stanzas go out, every reply comes in
        async function Player(Uid: string, Name: string, Options: LoginOptions = {}){
            const Wire = await SignedIn(Uid, Options);
            const Model = new ChatClientModel({ LocalUid: Uid, Resource: Wire.Resource, LocalSocialName: Name, Domain: Wire.Domain });
            return { Wire, Model, Name };
        }

        type Player_ = Awaited<ReturnType<typeof Player>>;

        async function Settle(...Players: Player_[]){
            const Seen: string[][] = [];

            for(const Each of Players){
                const Frames = await Each.Wire.Barrier();
                Each.Model.ReceiveAll(Frames);
                Seen.push(Frames);
            }

            return Seen;
        }

        function JoinAs(Who: Player_, Room: string, Name = Who.Name){
            const Stanza = Who.Model.JoinPublicRoom(Room, Name);
            assert.ok(Stanza);
            Who.Wire.Send(Stanza);
        }

        function Presence(Room: string, Nick: string, Occupant: Player_, To: Player_, Self = false){
            return `<presence xmlns="jabber:client" from="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Nick}`)}" to="${EscapeXml(`${To.Wire.Uid}@${DOMAIN}/${To.Wire.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc#user"><item affiliation="none" role="participant" jid="${EscapeXml(`${Occupant.Wire.Uid}@${DOMAIN}/${Occupant.Wire.Resource}`)}"/>${Self ? `<status code="110"/>` : ""}</x></presence>`;
        }

        function Unavailable(Room: string, Nick: string, Occupant: Player_, To: Player_, Self = false){
            return `<presence xmlns="jabber:client" type="unavailable" from="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Nick}`)}" to="${EscapeXml(`${To.Wire.Uid}@${DOMAIN}/${To.Wire.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc#user"><item affiliation="none" role="none" jid="${EscapeXml(`${Occupant.Wire.Uid}@${DOMAIN}/${Occupant.Wire.Resource}`)}"/>${Self ? `<status code="110"/>` : ""}</x></presence>`;
        }

        const Lookup = LookupFrom({ [A]: "Alpha", [B]: "Bravo", [C]: "Charlie", [D]: "Delta" });

        // Fresh buckets and no login hold-backs left over from the test before; every test logs its players out
        beforeEach(() => {
            Now += 61 * 1000;
        });

        afterEach(async () => {
            for(const Client of Opened.splice(0)) await Client.Logout();
        });

        it("two players: joins in order, <item jid> everywhere, 110 only on self, every message to both with one from and id; both see usernames", async () => {
            const Alpha = await Player(A, "Alpha");
            const Bravo = await Player(B, "Bravo");
            const NickA = Alpha.Model.Nickname("Alpha");
            const NickB = Bravo.Model.Nickname("Bravo");

            JoinAs(Alpha, CITY);
            assert.deepEqual((await Settle(Alpha))[0], [Presence(CITY, NickA, Alpha, Alpha, true)]);

            JoinAs(Bravo, CITY);
            const [ForB, ForA] = await Settle(Bravo, Alpha);
            assert.deepEqual(ForB, [Presence(CITY, NickA, Alpha, Bravo), Presence(CITY, NickB, Bravo, Bravo, true)], "B hears of A, then itself");
            assert.deepEqual(ForA, [Presence(CITY, NickB, Bravo, Alpha)], "A hears of B");

            const Text = "©héllo & <b>marker-room</b>";
            Alpha.Wire.Send(Alpha.Model.RoomMessage(CITY, Text, "3F2504E04F8911D39A0C0305E82C3301"));
            const [MineA, MineB] = await Settle(Alpha, Bravo);
            const Expected = (To: Player_) => `<message xmlns="jabber:client" type="groupchat" id="3F2504E04F8911D39A0C0305E82C3301" from="${EscapeXml(`${CITY}@${MUC_DOMAIN}/${NickA}`)}" to="${EscapeXml(`${To.Wire.Uid}@${DOMAIN}/${To.Wire.Resource}`)}"><body>${EscapeXml(Text)}</body></message>`;
            assert.deepEqual(MineA, [Expected(Alpha)], "the sender gets its own line back");
            assert.deepEqual(MineB, [Expected(Bravo)]);

            Bravo.Wire.Send(Bravo.Model.RoomMessage(CITY, "marker-reply", "g2"));
            await Settle(Bravo, Alpha);
            assert.deepEqual(await Alpha.Model.ShownLines(Lookup), [`Alpha: ${Text}`, "Bravo: marker-reply"]);
            assert.deepEqual(await Bravo.Model.ShownLines(Lookup), [`Alpha: ${Text}`, "Bravo: marker-reply"]);
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join room=${CITY} uid=${B} name=Bravo occupants=1`));
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: message room=${CITY} uid=${A} len=${[...Text].length} to=2`));
        });

        it("rooms accept the 1.4.4 muc and legacy conference aliases for the authenticated domain", async () => {
            const Local = await Player(C, "Charlie", { OpenTo: "dauntless.local" });

            JoinAs(Local, CITY);
            await Settle(Local);
            assert.equal(Local.Model.RoomOf(CITY)!.State, JOINED, "joined on muc.dauntless.local");

            Local.Wire.Send(`<presence to="Hunt-legacy@conference.dauntless.local/${Local.Model.Nickname("Charlie")}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
            const [Legacy] = await Settle(Local);
            assert.equal(Legacy.length, 1);
            assert.match(Legacy[0], /^<presence xmlns="jabber:client" from="Hunt-legacy@conference\.dauntless\.local\//);

            for(const Domain of [`conference.${DOMAIN}`, `muc.${DOMAIN}`]){
                Local.Wire.Send(`<presence to="Hunt-1@${Domain}/${Local.Model.Nickname("Charlie")}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                const [Frames] = await Settle(Local);
                assert.equal(Frames.length, 1, Domain);
                assert.match(Frames[0], /^<presence xmlns="jabber:client" type="error" from="Hunt-1@[^"]+"[^>]*><x xmlns="http:\/\/jabber.org\/protocol\/muc"\/><error type="cancel"><not-allowed xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error><\/presence>$/, Domain);
            }
        });

        it("three players: the last one hears of both; leaves and a dropped connection are told to the rest", async () => {
            const Alpha = await Player(A, "Alpha");
            const Bravo = await Player(B, "Bravo");
            const Charlie = await Player(C, "Charlie");
            const [NickA, NickB, NickC] = [Alpha.Model.Nickname("Alpha"), Bravo.Model.Nickname("Bravo"), Charlie.Model.Nickname("Charlie")];

            JoinAs(Alpha, CITY);
            await Settle(Alpha);
            JoinAs(Bravo, CITY);
            await Settle(Bravo, Alpha);
            JoinAs(Charlie, CITY);
            const [ForC] = await Settle(Charlie, Alpha, Bravo);
            assert.deepEqual(ForC, [Presence(CITY, NickA, Alpha, Charlie), Presence(CITY, NickB, Bravo, Charlie), Presence(CITY, NickC, Charlie, Charlie, true)]);

            Alpha.Wire.Send(Alpha.Model.ExitRoom(CITY)!);
            const [LeftA, LeftB, LeftC] = await Settle(Alpha, Bravo, Charlie);
            assert.deepEqual(LeftA, [Unavailable(CITY, NickA, Alpha, Alpha, true)]);
            assert.deepEqual(LeftB, [Unavailable(CITY, NickA, Alpha, Bravo)]);
            assert.deepEqual(LeftC, [Unavailable(CITY, NickA, Alpha, Charlie)]);
            assert.equal(Alpha.Model.RoomOf(CITY)!.State, NOT_JOINED);

            Charlie.Wire.Close();
            await Charlie.Wire.Closed;
            await new Promise((Resolve) => setTimeout(Resolve, 50));
            const [Dropped] = await Settle(Bravo);
            assert.deepEqual(Dropped, [Unavailable(CITY, NickC, Charlie, Bravo)]);
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: leave room=${CITY} uid=${C} reason=disconnect`));
        });

        it("refuses a nickname with another account's id, another name, the wrong resource or characters the client never writes", async () => {
            const Alpha = await Player(A, "Alpha");
            const Res = Alpha.Wire.Resource;
            const Cases: Array<[string, string]> = [
                [`Alpha:${B}:${Res}`, "nick-account"],
                [`Alpha`, "nick-account"],
                [`Bravo:${A}:${Res}`, "nick-name"],
                [`Al+pha:${A}:${Res}`, "nick-format"],
                [`Al pha:${A}:${Res}`, "nick-format"],
                [`%ZZ:${A}:${Res}`, "nick-format"],
                [`%FF:${A}:${Res}`, "nick-format"],
                [`Alpha:${A}:V2:Other:WIN::0`, "nick-resource"]
            ];

            for(const [Nick, Reason] of Cases){
                Alpha.Wire.Send(`<presence to="${EscapeXml(`Hunt-9@${MUC_DOMAIN}/${Nick}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                const [Frames] = await Settle(Alpha);
                assert.equal(Frames.length, 1, Nick);
                assert.match(Frames[0], /<error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/, Nick);
                assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=Hunt-9 uid=${A} reason=${Reason}`), `${Nick}: ${Reason}`);
            }

            // Another account's id hidden in a bound resource is refused too
            const Forged = await Player(B, "Bravo", { Resource: `V2:${A}:WIN::0` });
            JoinAs(Forged, "Hunt-10");
            await Settle(Forged);
            assert.equal(Forged.Model.RoomOf("Hunt-10"), undefined);
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=Hunt-10 uid=${B} reason=nick-account`));
        });

        it("accepts the client's own encodings: %41lpha, lower-case hex, InvalidMCPUser and an older non-ASCII name", async () => {
            const Old = await Player(OLD, OLD_NAME);
            const Res = Old.Wire.Resource;

            assert.equal(UrlEncodeLikeClient(OLD_NAME), "S%C3%B6lve%20%C3%96");

            for(const [Room, Nick] of [["Hunt-20", `${UrlEncodeLikeClient(OLD_NAME)}:${OLD}:${Res}`], ["Hunt-21", `S%c3%b6lve%20%c3%96:${OLD}:${Res}`], ["Hunt-22", `InvalidMCPUser:${OLD}:${Res}`]]){
                Old.Wire.Send(`<presence to="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Nick}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                const [Frames] = await Settle(Old);
                assert.match(Frames.at(-1)!, /<status code="110"\/>/, Nick);
            }

            const Alpha = await Player(A, "Alpha");
            Alpha.Wire.Send(`<presence to="${EscapeXml(`Hunt-23@${MUC_DOMAIN}/%41lpha:${A}:${Alpha.Wire.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
            const [Frames] = await Settle(Alpha);
            assert.match(Frames.at(-1)!, /<status code="110"\/>/);
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join room=Hunt-23 uid=${A} name=Alpha occupants=0`));
        });

        it("CHAT_NICK_CHECK=log admits a bad name or resource with a warning, but never another account's id", async () => {
            const Lenient = new ChatServer({ Clock: () => Now, AutoTick: false, NickCheck: "log" });
            await Lenient.listen(0);

            try{
                const Alpha = await Login(Lenient.port, A);
                const Bravo = await Login(Lenient.port, B);

                Alpha.Send(`<presence to="${EscapeXml(`Hunt-30@${MUC_DOMAIN}/Somebody:${A}:${Alpha.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                assert.match((await Alpha.Barrier()).at(-1)!, /<status code="110"\/>/, "admitted");
                assert.ok(Logs.Lines.some((Line) => Line === `warn chat: join nickname not checked room=Hunt-30 uid=${A} reason=nick-name (CHAT_NICK_CHECK=log)`));

                Alpha.Send(`<presence to="${EscapeXml(`Hunt-32@${MUC_DOMAIN}/Alpha:${A}:V2:Other:WIN::0`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                assert.match((await Alpha.Barrier()).at(-1)!, /<status code="110"\/>/, "another resource is admitted");

                // Another account's id: refused in log mode too, as part 2 or anywhere else in the nickname
                for(const [Room, Nick] of [["Hunt-31", `Alpha:${A}:${Alpha.Resource}`], ["Hunt-33", `${A}:${B}:${Bravo.Resource}`], ["Hunt-34", `Bravo`]]){
                    Bravo.Send(`<presence to="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Nick}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                    const Refused = await Bravo.Barrier();
                    assert.equal(Refused.length, 1, Nick);
                    assert.match(Refused[0], /<error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/, Nick);
                }

                // Logged once per connection, room kind and reason
                assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=Hunt-31 uid=${B} reason=nick-account`));
                assert.ok(!Logs.Lines.some((Line) => Line.startsWith(`info chat: join refused room=Hunt-33 `)));

                await Alpha.Logout();
                await Bravo.Logout();
            }
            finally{
                await Lenient.close();
            }
        });

        it("whispers: a bare JID reaches every session of the account, a full JID one, from the sender's full JID; offline and self are dropped", async () => {
            const Alpha = await Player(A, "Alpha");
            const Bravo1 = await Player(B, "Bravo");
            const Bravo2 = await Player(B, "Bravo");

            Alpha.Wire.Send(`<message type="chat" to="${B}@${DOMAIN}" id="w1"><body>marker-psst</body></message>`);
            const [, One, Two] = await Settle(Alpha, Bravo1, Bravo2);
            const Expected = (To: Player_) => `<message xmlns="jabber:client" type="chat" from="${EscapeXml(`${A}@${DOMAIN}/${Alpha.Wire.Resource}`)}" to="${EscapeXml(`${B}@${DOMAIN}/${To.Wire.Resource}`)}" id="w1"><body>marker-psst</body></message>`;
            assert.deepEqual(One, [Expected(Bravo1)]);
            assert.deepEqual(Two, [Expected(Bravo2)]);
            assert.deepEqual(await Bravo1.Model.ShownWhispers(Lookup), ["Alpha: marker-psst"]);

            Alpha.Wire.Send(`<message type="chat" to="${EscapeXml(`${B}@${DOMAIN}/${Bravo2.Wire.Resource}`)}"><body>marker-only-two</body></message>`);
            const [, OnlyOne, OnlyTwo] = await Settle(Alpha, Bravo1, Bravo2);
            assert.equal(OnlyOne.length, 0);
            assert.equal(OnlyTwo.length, 1);

            Alpha.Wire.Send(`<message type="chat" to="${D}@${DOMAIN}"><body>marker-offline</body></message>`);
            Alpha.Wire.Send(`<message type="chat" to="${A}@${DOMAIN}"><body>marker-self</body></message>`);
            assert.deepEqual((await Settle(Alpha))[0], [], "no error goes back");
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: whisper from=${A} to=${D} len=14 reason=offline`));
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: whisper from=${A} to=${A} len=11 reason=self`));
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: whisper from=${A} to=${B} len=11 delivered=2`));
        });

        it("two sessions of one account never see each other; the newer takes a room over; a third replaces the silent one; a ghost is pinged out in 10 s", async () => {
            const First = await Player(D, "Delta");
            const Second = await Player(D, "Delta");
            const Room = "City-7d1f0000-0000-4000-8000-00000000000d";
            const Other = "City-7d1f0000-0000-4000-8000-00000000000e";

            JoinAs(First, Room);
            await Settle(First);
            JoinAs(Second, Room);
            const [ForSecond, ForFirst] = await Settle(Second, First);
            assert.equal(ForSecond.length, 1, "only its own presence");
            assert.equal(ForFirst.length, 0, "nothing about the other session, not even that it lost the room");
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: leave room=${Room} uid=${D} reason=replaced`));

            First.Wire.Send(First.Model.RoomMessage(Room, "marker-same", "s1"));
            const [Mine, Theirs] = await Settle(First, Second);
            assert.deepEqual(Mine.map((Frame) => /type="(\w+)"/.exec(Frame)![1]), ["error"], "the older session is no longer in the room");
            assert.equal(Theirs.length, 0, "the other session hears nothing");

            // In a room of its own, the older one still chats; the other session hears nothing of it
            JoinAs(First, Other);
            await Settle(First);
            First.Wire.Send(First.Model.RoomMessage(Other, "marker-own", "s2"));
            const [MineAgain, TheirsAgain] = await Settle(First, Second);
            assert.equal(MineAgain.length, 1, "its own line comes back");
            assert.equal(TheirsAgain.length, 0);

            // A third session: the one silent longest goes (reason replaced), and the new bind pings the
            // other one, which is ended as a ghost when it stays silent for 10 s
            Now += 1000;
            await Settle(Second);
            Second.Wire.AutoPong = false;
            const Third = await Player(D, "Delta");
            await First.Wire.Closed;
            assert.ok(Logs.Lines.some((Line) => /chat: closed c=\d+ uid=UID-chat-d reason=replaced/.test(Line)));
            Now += 10 * 1000;
            Wire.Tick();
            await Second.Wire.Closed;
            assert.ok(Logs.Lines.some((Line) => /chat: closed c=\d+ uid=UID-chat-d reason=ping-timeout/.test(Line)));
            assert.ok(Third.Wire.IsOpen);

            // The replacement holds the account's next login back for 60 s (the ping timeout would not)
            await assert.rejects(Player(D, "Delta"), /was refused/);
        });

        it("a reconnect while the old connection lingers: the new one takes the room over, and the others keep the name", async () => {
            // The client keeps one room member per account id (0x1408fe300) and removes it by the account id
            // in a leaving nickname (0x1408c0680 -> 0x1408e1ce0). If the old connection stayed in the room
            // until its ping timeout, its leave would remove the member the new connection had just
            // updated, and every later line of that player would show as [unknown] to the others.
            const Alpha = await Player(A, "Alpha");
            const Bravo1 = await Player(B, "Bravo");
            const Room = "City-7d1f0000-0000-4000-8000-0000000000b2";

            JoinAs(Alpha, Room);
            await Settle(Alpha);
            JoinAs(Bravo1, Room);
            await Settle(Bravo1, Alpha);

            // B's connection drops without a close; the game reconnects and joins the room again
            Bravo1.Wire.AutoPong = false;
            const Seen = Bravo1.Wire.Frames.length;
            const Bravo2 = await Player(B, "Bravo");
            JoinAs(Bravo2, Room);
            const [ForBravo2, ForAlpha] = await Settle(Bravo2, Alpha);
            assert.deepEqual(ForAlpha, [Unavailable(Room, Bravo1.Model.Nickname("Bravo"), Bravo1, Alpha), Presence(Room, Bravo2.Model.Nickname("Bravo"), Bravo2, Alpha)], "the old one leaves first, then the new one comes");
            assert.deepEqual(ForBravo2, [Presence(Room, Alpha.Model.Nickname("Alpha"), Alpha, Bravo2), Presence(Room, Bravo2.Model.Nickname("Bravo"), Bravo2, Bravo2, true)]);
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: leave room=${Room} uid=${B} reason=replaced`));

            // The old connection is pinged out 10 s later; nobody hears of it again
            Now += 10 * 1000;
            Wire.Tick();
            await Bravo1.Wire.Closed;
            await new Promise((Resolve) => setTimeout(Resolve, 50));
            assert.ok(!Bravo1.Wire.Frames.slice(Seen).some((Frame) => Frame.includes(Room)), "the old connection is not told");
            assert.deepEqual((await Settle(Alpha))[0], [], "no second leave");

            Bravo2.Wire.Send(Bravo2.Model.RoomMessage(Room, "marker-back", "rb1"));
            await Settle(Bravo2, Alpha);
            assert.deepEqual(await Alpha.Model.ShownLines(Lookup), ["Bravo: marker-back"]);
            assert.deepEqual(await Bravo2.Model.ShownLines(Lookup), ["Bravo: marker-back"]);
        });

        it("a flood of refused joins: each takes a join token and counts toward the abuse limit; the log says it once per room kind and reason, with the room name cut", async () => {
            const Joiner = await Player(JOINS, "Joins");
            const Before = Logs.Lines.length;
            const Long = `Lobby-${"x".repeat(1800)}`;

            for(let Index = 0; Index < 150; Index++){
                Joiner.Wire.Send(`<presence to="${EscapeXml(`${Long}${Index}@${MUC_DOMAIN}/${Joiner.Model.Nickname("Joins")}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
            }

            await Joiner.Wire.Closed;
            const Lines = Logs.Lines.slice(Before);
            const Refused = Lines.filter((Line) => Line.includes("chat: join refused"));
            assert.deepEqual(Refused.map((Line) => /reason=(\S+)$/.exec(Line)![1]), ["not-allowed", "limit"], "the first ten take the burst, the rest are over the rate");
            assert.ok(Refused.every((Line) => Line.includes(`room=Lobby-${"x".repeat(74)}... `)), "the room name is cut to 80 characters");
            assert.ok(Lines.some((Line) => /^info chat: closed c=\d+ uid=UID-chat-joins reason=abuse/.test(Line)));
        });

        it("limits: a 2049-character body and a message burst get the room error; a stanza flood ends the session and holds its logins", async () => {
            const Flooder = await Player(FLOOD, "Flood");

            JoinAs(Flooder, "Hunt-40");
            await Settle(Flooder);
            Flooder.Wire.Send(`<message type="groupchat" to="Hunt-40@${MUC_DOMAIN}" id="big"><body>${"x".repeat(2049)}</body></message>`);
            const [Big] = await Settle(Flooder);
            assert.deepEqual(Big, [`<message xmlns="jabber:client" type="error" id="big" from="Hunt-40@${MUC_DOMAIN}" to="${EscapeXml(`${FLOOD}@${DOMAIN}/${Flooder.Wire.Resource}`)}"><error type="modify"><not-acceptable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></message>`]);

            for(let Index = 0; Index < 9; Index++){
                Flooder.Wire.Send(`<message type="groupchat" to="Hunt-40@${MUC_DOMAIN}" id="r${Index}"><body>marker-burst</body></message>`);
            }

            const [Burst] = await Settle(Flooder);
            assert.equal(Burst.filter((Frame) => Frame.includes("<body>")).length, 8, "a burst of 8");
            assert.equal(Burst.filter((Frame) => Frame.includes(`type="error"`)).length, 1);

            for(let Index = 0; Index < 200; Index++){
                Flooder.Wire.Send(`<iq type="get" id="f${Index}"><ping xmlns="urn:xmpp:ping"/></iq>`);
            }

            await Flooder.Wire.Closed;
            assert.ok(Logs.Lines.some((Line) => /chat: closed c=\d+ uid=UID-chat-flood reason=abuse/.test(Line)));

            const Next = await Connected();
            assert.match(await SaslAnswer(Next, Base64Plain("", FLOOD, SignMetagameJWTForUid(FLOOD))), /temporary-auth-failure/);
            Next.Close();
        });

        // ---- Who may join, and blocks ----

        function Evicted(Room: string, Nick: string, Occupant: Player_, To: Player_, Self: boolean){
            return `<presence xmlns="jabber:client" type="unavailable" from="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Nick}`)}" to="${EscapeXml(`${To.Wire.Uid}@${DOMAIN}/${To.Wire.Resource}`)}"><x xmlns="http://jabber.org/protocol/muc#user"><item affiliation="none" role="none" jid="${EscapeXml(`${Occupant.Wire.Uid}@${DOMAIN}/${Occupant.Wire.Resource}`)}"/>${Self ? `<status code="110"/>` : ""}<status code="307"/></x></presence>`;
        }

        async function PartyOf(Leader: string, ...Members: string[]){
            const PartyId = ((await PollParty(Leader)) as { partyId: string }).partyId;

            for(const Member of Members){
                await PollParty(Member);
                assert.equal(InviteToParty(Leader, Member, PartyId).Status, 200);
                assert.equal((await AcceptPartyInvite(Member, PartyId)).Status, 200);
            }

            return PartyId;
        }

        it("party rooms: members only; a kicked member is removed at their next message, or by the 60 s sweep", async () => {
            ResetPartiesForTests();
            const PartyId = await PartyOf(A, B);
            await PollParty(C);
            const Room = `Party-${PartyId}`;
            const Alpha = await Player(A, "Alpha");
            const Bravo = await Player(B, "Bravo");
            const Charlie = await Player(C, "Charlie");

            JoinAs(Alpha, Room);
            await Settle(Alpha);
            JoinAs(Bravo, Room);
            await Settle(Bravo, Alpha);
            assert.equal(Bravo.Model.RoomOf(Room)!.State, JOINED);

            JoinAs(Charlie, Room);
            const [Refused] = await Settle(Charlie);
            assert.match(Refused[0], /<error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/);
            assert.equal(Charlie.Model.RoomOf(Room), undefined, "the client drops the room");
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=${Room} uid=${C} reason=not-member`));

            // The leader kicks B: B's next line is refused and B is removed; A sees B go (307)
            assert.equal(KickPartyMember(A, B).Status, 200);
            Bravo.Wire.Send(Bravo.Model.RoomMessage(Room, "marker-kicked", "k1"));
            const [ForBravo, ForAlpha] = await Settle(Bravo, Alpha);
            assert.match(ForBravo[0], /^<message xmlns="jabber:client" type="error" id="k1"/);
            assert.equal(ForBravo[1], Evicted(Room, Bravo.Model.Nickname("Bravo"), Bravo, Bravo, true));
            assert.deepEqual(ForAlpha, [Evicted(Room, Bravo.Model.Nickname("Bravo"), Bravo, Alpha, false)]);
            assert.equal(Bravo.Model.RoomOf(Room)!.State, NOT_JOINED, "server initiated room exit");
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: leave room=${Room} uid=${B} reason=evicted`));

            // C joins the party, then is kicked without saying anything: the sweep removes it
            assert.equal(InviteToParty(A, C, PartyId).Status, 200);
            assert.equal((await AcceptPartyInvite(C, PartyId)).Status, 200);
            JoinAs(Charlie, Room);
            await Settle(Charlie, Alpha);
            assert.equal(Charlie.Model.RoomOf(Room)!.State, JOINED);
            assert.equal(KickPartyMember(A, C).Status, 200);
            Now += 60 * 1000;
            Wire.Tick();
            const [SweptC, SweptA] = await Settle(Charlie, Alpha);
            assert.deepEqual(SweptC, [Evicted(Room, Charlie.Model.Nickname("Charlie"), Charlie, Charlie, true)]);
            assert.deepEqual(SweptA, [Evicted(Room, Charlie.Model.Nickname("Charlie"), Charlie, Alpha, false)]);

            // D joins, is kicked, and sends its join again: removed from the room and refused
            const Delta = await Player(D, "Delta");
            assert.equal(InviteToParty(A, D, PartyId).Status, 200);
            assert.equal((await AcceptPartyInvite(D, PartyId)).Status, 200);
            const Join = Delta.Model.JoinPublicRoom(Room, "Delta")!;
            Delta.Wire.Send(Join);
            await Settle(Delta, Alpha);
            assert.equal(KickPartyMember(A, D).Status, 200);
            Delta.Wire.Send(Join);
            const [RejoinD, RejoinA] = await Settle(Delta, Alpha);
            assert.equal(RejoinD[0], Evicted(Room, Delta.Model.Nickname("Delta"), Delta, Delta, true));
            assert.match(RejoinD[1], /<error type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/);
            assert.deepEqual(RejoinA, [Evicted(Room, Delta.Model.Nickname("Delta"), Delta, Alpha, false)]);
            ResetPartiesForTests();
        });

        it("guild rooms: members only; a member whose row is gone is removed at the next message", async () => {
            const GuildId = crypto.randomUUID();
            const Stamp = Date.now();
            GetDb().insert(guilds).values({ guildId: GuildId, name: "Chatters", nameKey: "chatters", leaderId: A, createdAt: Stamp, updatedAt: Stamp }).run();
            GetDb().insert(guildmembers).values([
                { accountId: A, guildId: GuildId, rank: "Leader", joinedAt: Stamp, updatedAt: Stamp },
                { accountId: B, guildId: GuildId, rank: "Member", joinedAt: Stamp, updatedAt: Stamp }
            ]).run();

            const Room = `Guild-${GuildId}`;
            const Alpha = await Player(A, "Alpha");
            const Bravo = await Player(B, "Bravo");
            const Charlie = await Player(C, "Charlie");

            JoinAs(Alpha, Room);
            await Settle(Alpha);
            JoinAs(Bravo, Room);
            await Settle(Bravo, Alpha);
            JoinAs(Charlie, Room);
            await Settle(Charlie);
            assert.equal(Alpha.Model.RoomOf(Room)!.State, JOINED);
            assert.equal(Bravo.Model.RoomOf(Room)!.State, JOINED);
            assert.equal(Charlie.Model.RoomOf(Room), undefined, "not a member");

            GetDb().delete(guildmembers).where(eq(guildmembers.accountId, B)).run();
            Alpha.Wire.Send(Alpha.Model.RoomMessage(Room, "marker-guild", "gm1"));
            const [ForAlpha, ForBravo] = await Settle(Alpha, Bravo);
            assert.deepEqual(ForBravo, [Evicted(Room, Bravo.Model.Nickname("Bravo"), Bravo, Bravo, true)], "removed, not served");
            assert.equal(ForAlpha.length, 2, "A's own line and B's removal");
            assert.ok(ForAlpha.some((Frame) => Frame.includes("marker-guild")));
            GetDb().delete(guildmembers).run();
            GetDb().delete(guilds).run();
        });

        it("refuses rooms the client never names (Lobby-, other case, bad ids), the 9th room, and joins past the rate", async () => {
            const Alpha = await Player(A, "Alpha");

            for(const Room of ["Lobby-x", "party-x", "CITY-x", "City-", "Hunt-a_b", "Whatever"]){
                Alpha.Wire.Send(`<presence to="${EscapeXml(`${Room}@${MUC_DOMAIN}/${Alpha.Model.Nickname("Alpha")}`)}"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
                const [Frames] = await Settle(Alpha);
                assert.match(Frames[0], /<error type="cancel"><not-allowed xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/, Room);
            }

            // Refused joins take join tokens too; a minute later the burst is full again
            Now += 61 * 1000;

            for(let Index = 1; Index <= 8; Index++){
                JoinAs(Alpha, `City-room${Index}`);
                await Settle(Alpha);
                assert.equal(Alpha.Model.RoomOf(`City-room${Index}`)!.State, JOINED);
            }

            JoinAs(Alpha, "City-room9");
            const [Ninth] = await Settle(Alpha);
            assert.match(Ninth[0], /<error type="wait"><service-unavailable xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"\/><\/error>/);

            // A tenth join fits the burst of 10 joins (after a leave); the eleventh does not
            Alpha.Wire.Send(Alpha.Model.ExitRoom("City-room8")!);
            await Settle(Alpha);
            JoinAs(Alpha, "City-room10");
            await Settle(Alpha);
            assert.equal(Alpha.Model.RoomOf("City-room10")!.State, JOINED);
            Alpha.Wire.Send(Alpha.Model.ExitRoom("City-room7")!);
            await Settle(Alpha);
            JoinAs(Alpha, "City-room11");
            const [Eleventh] = await Settle(Alpha);
            assert.match(Eleventh[0], /<error type="wait"><service-unavailable/);

            // Each is logged once per connection, room kind and reason
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=Lobby-x uid=${A} reason=not-allowed`));
            assert.ok(!Logs.Lines.some((Line) => Line === `info chat: join refused room=party-x uid=${A} reason=not-allowed`));
            assert.ok(Logs.Lines.some((Line) => Line === `info chat: join refused room=City-room9 uid=${A} reason=limit`));
            assert.ok(!Logs.Lines.some((Line) => Line === `info chat: join refused room=City-room11 uid=${A} reason=limit`));
        });

        it("blocks: a room line skips whoever blocked its sender; whispers need neither player to have blocked the other", async () => {
            const Alpha = await Player(A, "Alpha");
            const Bravo = await Player(B, "Bravo");
            const Charlie = await Player(C, "Charlie");
            const Room = "City-blocks";

            for(const Each of [Alpha, Bravo, Charlie]){
                JoinAs(Each, Room);
                await Settle(Each);
                await Settle(Alpha, Bravo, Charlie);
            }

            assert.ok(BlockPlayer(B, A).ok);

            try{
                Alpha.Wire.Send(Alpha.Model.RoomMessage(Room, "marker-blocked", "b1"));
                const [FromA, ToB, ToC] = await Settle(Alpha, Bravo, Charlie);
                assert.equal(FromA.length, 1, "A still sees its own line");
                assert.equal(ToB.length, 0, "B blocked A");
                assert.equal(ToC.length, 1);
                assert.ok(Logs.Lines.some((Line) => Line === `info chat: message room=${Room} uid=${A} len=14 to=2 blocked=1`));

                Charlie.Wire.Send(Charlie.Model.RoomMessage(Room, "marker-free", "b2"));
                const [, ToB2] = await Settle(Charlie, Bravo, Alpha);
                assert.equal(ToB2.length, 1, "C's lines still reach B");

                Alpha.Wire.Send(`<message type="chat" to="${B}@${DOMAIN}"><body>marker-w1</body></message>`);
                Bravo.Wire.Send(`<message type="chat" to="${A}@${DOMAIN}"><body>marker-w2</body></message>`);
                const [WA, WB] = await Settle(Alpha, Bravo);
                assert.deepEqual([WA, WB], [[], []]);
                assert.ok(Logs.Lines.some((Line) => Line === `info chat: whisper from=${A} to=${B} len=9 reason=blocked`));
                assert.ok(Logs.Lines.some((Line) => Line === `info chat: whisper from=${B} to=${A} len=9 reason=blocked`));
            }
            finally{
                assert.ok(UnblockPlayer(B, A).ok);
            }

            Alpha.Wire.Send(Alpha.Model.RoomMessage(Room, "marker-again", "b3"));
            const [, Again] = await Settle(Alpha, Bravo, Charlie);
            assert.equal(Again.length, 1, "after the unblock the lines arrive again");
        });
    });

    describe("logs", () => {
        it("CHAT_TRACE=1 logs frames with the login, passwords, message text and tokens redacted", async () => {
            const Traced = new ChatServer({ Clock: () => Now, AutoTick: false, Trace: true });
            await Traced.listen(0);

            try{
                const Sender = await Login(Traced.port, C);
                const Receiver = await Login(Traced.port, D);
                Opened.push(Sender, Receiver);
                assert.ok(await Whispered(Sender, Receiver, "marker-traced-body"));
                assert.ok(Logs.Lines.some((Line) => Line.includes("chat: trace c=") && Line.includes("<auth") && Line.includes("[redacted]")));
                assert.ok(Logs.Lines.some((Line) => Line.includes("chat: trace c=") && Line.includes("<body>[18 chars]</body>")));
            }
            finally{
                await Traced.close();
            }
        });

        it("never logs a token, a login payload, a password, message text or the gateway secret", () => {
            const Text = Logs.Lines.join("\n");

            assert.ok(Logs.Lines.length > 20);
            assert.ok(!Text.includes("eyJ"), "no token");
            assert.ok(!/marker-/.test(Text), "no message text");

            for(const Marker of SECRET_MARKERS){
                assert.ok(!Text.includes(Marker), "no login payload, password or secret");
            }
        });
    });
});

// Starts the built metagame (build/src/server.js) in its own process with a fresh database and waits
// for its "Clear Skies" line, or 20 s. Returns everything it printed.
async function RunMetagame(Extra: Record<string, string>): Promise<string> {
    const Probe = net.createServer();
    await new Promise<void>((Resolve) => Probe.listen(0, "127.0.0.1", () => Resolve()));
    const Port = (Probe.address() as net.AddressInfo).port;
    await new Promise<void>((Resolve) => Probe.close(() => Resolve()));

    const Dir = fs.mkdtempSync(path.join(os.tmpdir(), "undaunted-chat-start-"));
    const Child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
        cwd: path.join(__dirname, "..", ".."),
        env: {
            PATH: process.env.PATH ?? "",
            SystemRoot: process.env.SystemRoot ?? "",
            PORT: String(Port),
            BIND_HOST: "127.0.0.1",
            DB_FILENAME: path.join(Dir, "start.db"),
            NODE_ENV: "production",
            LOG_LEVEL: "info",
            AUTH_MODE: "APIKEY",
            AUTH_SIGNING_PRIVKEY_B64: process.env.AUTH_SIGNING_PRIVKEY_B64 ?? "",
            AUTH_SIGNING_PUBKEY_B64: process.env.AUTH_SIGNING_PUBKEY_B64 ?? "",
            MATCHMAKING_MODE: "DEPLOYSERVER",
            DEPLOYSERVER_URL: "127.0.0.1:1",
            REGISTRATION_MODE: "OPEN",
            QOS_TARGET_URL: "http://127.0.0.1:61000/QoS",
            TARGET_CHANGELIST: "239827",
            LOG_REQUESTS: "0",
            ...Extra
        }
    });
    let Output = "";

    try{
        await new Promise<void>((Resolve) => {
            const Timer = setTimeout(Resolve, 20000);
            const Read = (Chunk: Buffer) => {
                Output += Chunk.toString("utf8");
                if(Output.includes("Clear Skies")){ clearTimeout(Timer); Resolve(); }
            };

            Child.stdout.on("data", Read);
            Child.stderr.on("data", Read);
            Child.on("exit", () => { clearTimeout(Timer); Resolve(); });
        });
    }
    finally{
        Child.kill();
        await new Promise((Resolve) => Child.exitCode !== null ? Resolve(undefined) : Child.once("exit", Resolve));
        fs.rmSync(Dir, { recursive: true, force: true });
    }

    return Output;
}
