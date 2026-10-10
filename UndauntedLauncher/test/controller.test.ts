// The whole public-mode flow through the Controller, against a fake TLS gateway that serves the
// metagame routes and /content/*: invite v2 -> pinned ServerStatus -> Register -> install ->
// Play (relay + Engine.ini + launch args) -> game exit stops the relay.
// Ports: 62440 fake gateway (TLS), 62441 relay, 62442 relay for the busy-port case, 62443 a
// gateway whose certificate changes, 62444 a private-mode (plain HTTP, loopback) metagame.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Controller, type Platform } from "../src/main/controller";
import { validateManifest, type GameManifest } from "../src/main/manifest";
import { formatInvite } from "../src/shared/invite";
import { setSink } from "../src/main/log";
import { KeyStore } from "../src/main/keystore";
import type { SpawnFn } from "../src/main/launch";
import type { Snapshot } from "../src/shared/types";
import { FakeContentServer, FakeMetagame, makeFiles, manifestFor, sha256, TEST_BUILD } from "./fakes";
import { makeTestCert, type TestCert } from "./certs";

const GATEWAY_PORT = 62440;
const RELAY_PORT = 62441;
const BUSY_RELAY_PORT = 62442;
const SWAP_PORT = 62443;
const PRIVATE_PORT = 62444;
const ASSETS = path.resolve(__dirname, "..", "..", "assets");
const EXE = "Archon/Binaries/Win64/Fake-Game.exe";

let cert: TestCert;
let other: TestCert;
let gateway: https.Server;
let meta: FakeMetagame;
let content: FakeContentServer;
let gatewayRequests: string[] = [];
const files = makeFiles();
const manifest: GameManifest = (() => {
  const r = validateManifest(manifestFor(files), TEST_BUILD, false);
  if (!r.ok) throw new Error(r.reason);
  return r.manifest;
})();
const logLines: string[] = [];
const temps: string[] = [];

function temp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

before(async () => {
  cert = makeTestCert();
  other = makeTestCert();
  meta = new FakeMetagame({ name: "Friday Hunts", validCodes: new Set(["ABCD-EFGH-JKLM", "SECOND-CODE", "THIRD-CODE", "FOURTH-CODE", "FIFTH-CODE", "SIXTH-CODE", "EXPOSURE-CODE", "GAMELANG-CODE", "CONSOLE-CODE", "EXISTING-CODE", "PICKED-CODE", "SAVED-CODE"]) });
  content = new FakeContentServer({ key: "unused", files });
  gateway = https.createServer({ cert: cert.certPem, key: cert.keyPem }, (req, res) => {
    gatewayRequests.push(`${req.method} ${req.url}`);
    if ((req.url ?? "").startsWith("/content/")) {
      // The content server accepts any key the metagame knows.
      const key = req.headers["x-undaunted-user-api-key"];
      content.opts = { ...content.opts, key: typeof key === "string" && meta.users.has(key) ? key : "no-such-key" };
      content.handle(req, res);
    } else {
      meta.handle(req, res);
    }
  });
  await new Promise<void>((resolve) => gateway.listen(GATEWAY_PORT, "127.0.0.1", resolve));
  setSink((l) => logLines.push(l));
});

after(async () => {
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  cert.cleanup();
  other.cleanup();
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

interface Harness {
  c: Controller;
  last: () => Snapshot;
  spawns: { exe: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[];
  child: () => EventEmitter | null;
  configDir: string;
  installDir: string;
  userData: string;
}

// userDataDir: reuse another harness's settings and keys (the launcher opened again).
// chooseFolder: what the folder dialog answers (default: cancelled).
function harness(relayPort = RELAY_PORT, userDataDir?: string, chooseFolder: Platform["chooseFolder"] = async () => null): Harness {
  let snap: Snapshot | null = null;
  const spawns: Harness["spawns"] = [];
  let child: EventEmitter | null = null;
  const fakeSpawn = ((exe: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) => {
    spawns.push({ exe, args, cwd: opts.cwd, env: opts.env });
    child = new EventEmitter();
    const c = child;
    setImmediate(() => c.emit("spawn"));
    return child;
  }) as unknown as SpawnFn;
  const userData = userDataDir ?? temp("dr-ctl-user-");
  const installDir = temp("dr-ctl-game-");
  const configDir = temp("dr-ctl-cfg-");
  const p: Platform = {
    userDataDir: userData,
    resourcesDir: ASSETS,
    defaultInstallDir: installDir,
    appVersion: "0.0.0-test",
    packaged: false,
    defaultLanguage: "en",
    encryptor: {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from("enc:" + Buffer.from(plain).toString("base64")),
      decrypt: (data) => Buffer.from(data.toString().slice(4), "base64").toString(),
    },
    manifest,
    gameConfigDir: configDir,
    relayPort,
    exePin: { relativePath: EXE, sha256: sha256(files.find((f) => f.path === EXE)!.data) },
    chooseFolder,
    chooseSaveFile: async () => null,
    chooseOpenFile: async () => null,
    openExternal: async () => undefined,
    openPath: async () => undefined,
    emitSnapshot: (s) => {
      snap = s;
    },
    emitProgress: () => undefined,
    findTailscale: () => null,
    findRunningClients: async () => [],
    runtimeFilesExist: () => true,

    spawn: fakeSpawn,
  };
  const c = new Controller(p);
  return { c, last: () => snap ?? c.snapshot(), spawns, child: () => child, configDir, installDir, userData };
}

function invite(fp: string, code = "ABCD-EFGH-JKLM"): string {
  return formatInvite({ mode: "public", host: "127.0.0.1", port: GATEWAY_PORT, fp, code, name: "Friday Hunts", share: null });
}

function get(port: number, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, agent: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

test("public mode end to end: join, register, install, play through the relay, game exit", async () => {
  const hx = harness();
  await hx.c.init();
  assert.equal(hx.last().phase, "join");

  const joined = await hx.c.submitInvite(invite(cert.fingerprint));
  assert.deepEqual(joined, { ok: true });
  let s = hx.last();
  assert.equal(s.server?.mode, "public");
  assert.equal(s.server?.fingerprint, cert.fingerprint);
  assert.equal(s.connect.problem, null);
  assert.equal(s.phase, "register");
  assert.equal(s.install.contentAvailable, true, "content found behind the gateway");
  assert.equal(s.status?.name, "Friday Hunts");
  assert.equal(s.status?.limited, true, "not registered yet: the server hides who is online");
  assert.deepEqual([s.status?.playersOnline, s.status?.players, s.status?.instances], [0, [], []]);

  const reg = await hx.c.register("Slayer_42");
  assert.deepEqual(reg, { ok: true, username: "Slayer_42" });
  s = hx.last();
  assert.equal(s.phase, "install");
  assert.equal(s.account.username, "Slayer_42");
  assert.equal(s.status?.limited, false, "registered: the status is asked again with the key");
  assert.deepEqual(s.status?.players.map((p) => p.name), ["Aurora", "Borealis"]);
  assert.equal(meta.registrations.at(-1)?.code, "ABCD-EFGH-JKLM");

  const installed = await hx.c.startInstall();
  assert.deepEqual(installed, { ok: true });
  s = hx.last();
  assert.equal(s.phase, "ready");
  assert.equal(s.notice, "install_done");
  for (const f of files) assert.ok(readFileSync(path.join(hx.installDir, ...f.path.split("/"))).equals(f.data), f.path);
  for (const dll of ["dxgi.dll", "UndauntedInternalServer.dll"]) assert.ok(existsSync(path.join(hx.installDir, "Archon", "Binaries", "Win64", dll)), dll);
  assert.ok(gatewayRequests.some((r) => r.startsWith("GET /content/v1/files/")), "files came through the gateway");

  const played = await hx.c.play();
  assert.deepEqual(played, { ok: true });
  s = hx.last();
  assert.equal(s.phase, "running");
  assert.equal(s.game.relayPort, RELAY_PORT);
  assert.equal(hx.c.relayActive, true);

  // Launch line: the relay first, the key second, never in the log.
  assert.equal(hx.spawns.length, 1);
  const args = hx.spawns[0].args;
  assert.equal(args[0], `127.0.0.1:${RELAY_PORT}`);
  assert.match(args[1], /^-AUTH_PASSWORD=UUK_[0-9a-f]{48}$/);
  const key = args[1].slice("-AUTH_PASSWORD=".length);
  assert.ok(hx.spawns[0].exe.endsWith("Dauntless-Win64-Shipping.exe"));
  assert.ok(logLines.some((l) => l.includes("-AUTH_PASSWORD=<hidden>")), "the launch was logged, masked");
  for (const l of logLines) assert.ok(!l.includes(key), `key leaked into the log: ${l}`);

  // Chat goes to the relay too.
  const ini = readFileSync(path.join(hx.configDir, "Engine.ini"), "latin1");
  assert.ok(ini.includes('ServerAddr="ws://127.0.0.1"\r\nServerPort=' + RELAY_PORT + "\r\nbUseSSL=false"));

  // The game's own traffic crosses the relay to the gateway.
  const through = await get(RELAY_PORT, "/undaunted/api/ServerStatus");
  assert.equal(through.status, 200);
  assert.equal(JSON.parse(through.body).name, "Friday Hunts");

  // The game exits: the relay goes away with it.
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(hx.c.relayActive, false);
  assert.equal(hx.last().phase, "ready");
  await assert.rejects(get(RELAY_PORT, "/undaunted/api/ServerStatus"));
  assert.equal(hx.last().lastError, null);
  assert.deepEqual(await hx.c.play(), {ok:true});
  hx.child()!.emit('exit', -1073741515);
  await new Promise(r => setTimeout(r,100));
  assert.equal(hx.last().lastError?.code, 'launch_failed');
  assert.match(hx.last().lastError?.detail ?? '', /0xC0000135/);
  assert.equal(hx.c.relayActive, false);
  const storedUser = meta.users.get(key)!;
  meta.users.delete(key);
  const rejected = await hx.c.play();
  assert.deepEqual(rejected, {ok:false,error:{code:'key_rejected'}});
  assert.equal(hx.spawns.length, 2, 'rejected key never starts a game process');
  meta.users.set(key, storedUser);
  await hx.c.shutdown();
});

test("game language: automatic by default, stored when chosen, an unknown value changes nothing, sent as -epiclocale at PLAY", async () => {
  const hx = harness();
  await hx.c.init();
  assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "GAMELANG-CODE")), { ok: true });
  assert.deepEqual(await hx.c.register("GameLang_1"), { ok: true, username: "GameLang_1" });
  assert.deepEqual(await hx.c.startInstall(), { ok: true });
  assert.equal(hx.last().settings.gameLanguage, "auto");

  assert.equal((await hx.c.setSettings({ gameLanguage: "es-ES" })).gameLanguage, "es-ES");
  assert.equal((await hx.c.setSettings({ gameLanguage: "xx-XX" } as never)).gameLanguage, "es-ES", "an unknown value is ignored");
  assert.equal(JSON.parse(readFileSync(path.join(hx.userData, "settings.json"), "utf8")).gameLanguage, "es-ES");

  assert.deepEqual(await hx.c.play(), { ok: true });
  assert.ok(hx.spawns.at(-1)!.args.includes("-epiclocale=es-ES"), hx.spawns.at(-1)!.args.join(" "));
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));
  await hx.c.shutdown();
});

test("log window: hidden by default; when shown, the game gets DR_SHOW_CONSOLE=1 at PLAY", async () => {
  const hx = harness();
  await hx.c.init();
  assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "CONSOLE-CODE")), { ok: true });
  assert.deepEqual(await hx.c.register("Console_1"), { ok: true, username: "Console_1" });
  assert.deepEqual(await hx.c.startInstall(), { ok: true });
  assert.equal(hx.last().settings.showConsole, false);

  assert.deepEqual(await hx.c.play(), { ok: true });
  assert.equal(hx.spawns.at(-1)!.env?.DR_SHOW_CONSOLE, undefined, "hidden unless asked for");
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));

  assert.equal((await hx.c.setSettings({ showConsole: true })).showConsole, true);
  assert.equal(JSON.parse(readFileSync(path.join(hx.userData, "settings.json"), "utf8")).showConsole, true);
  assert.deepEqual(await hx.c.play(), { ok: true });
  assert.equal(hx.spawns.at(-1)!.env?.DR_SHOW_CONSOLE, "1");
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));
  await hx.c.shutdown();
});

test("saved servers: a server joined before comes back with one click, keeping its account, and can be removed from the list", async () => {
  const hx = harness();
  try {
    await hx.c.init();
    assert.deepEqual(hx.c.snapshot().savedServers, []);
    assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "SAVED-CODE")), { ok: true });
    assert.deepEqual(await hx.c.register("Saved_1"), { ok: true, username: "Saved_1" });
    const [entry] = hx.c.snapshot().savedServers;
    assert.deepEqual([entry.name, entry.current, entry.username], ["Friday Hunts", true, "Saved_1"]);
    assert.deepEqual(await hx.c.removeSavedServer(entry.id), { ok: false, error: { code: "busy" } }, "the current server stays");

    assert.deepEqual(await hx.c.forgetServer(), { ok: true });
    assert.equal(hx.c.snapshot().server, null);
    assert.deepEqual(hx.c.snapshot().savedServers.map((sv) => [sv.id, sv.current]), [[entry.id, false]]);

    assert.deepEqual(await hx.c.switchServer("0".repeat(24)), { ok: false, error: { code: "invite_invalid_format" } });
    assert.deepEqual(await hx.c.switchServer(entry.id), { ok: true });
    const back = hx.c.snapshot();
    assert.deepEqual([back.server?.host, back.server?.fingerprint, back.account.hasKey, back.server?.hasPendingInvite], ["127.0.0.1", cert.fingerprint, true, false]);

    assert.deepEqual(await hx.c.forgetServer(), { ok: true });
    assert.deepEqual(await hx.c.removeSavedServer(entry.id), { ok: true });
    assert.deepEqual(hx.c.snapshot().savedServers, []);
  } finally {
    await hx.c.shutdown();
  }
});

test("auto exposure: off by default; Basic is stored and written at the next PLAY, an unknown value changes nothing, Game default removes it", async () => {
  const hx = harness();
  await hx.c.init();
  assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "EXPOSURE-CODE")), { ok: true });
  assert.deepEqual(await hx.c.register("Exposure_1"), { ok: true, username: "Exposure_1" });
  assert.deepEqual(await hx.c.startInstall(), { ok: true });
  assert.equal(hx.last().settings.exposure, "game", "the game's own exposure unless the player opts in");

  assert.equal((await hx.c.setSettings({ exposure: "basic" })).exposure, "basic");
  assert.equal((await hx.c.setSettings({ exposure: "manual" })).exposure, "basic", "an unknown value is ignored");
  assert.equal(JSON.parse(readFileSync(path.join(hx.userData, "settings.json"), "utf8")).exposure, "basic");
  assert.equal(hx.last().settings.exposure, "basic");

  assert.deepEqual(await hx.c.play(), { ok: true });
  let ini = readFileSync(path.join(hx.configDir, "Engine.ini"), "latin1");
  assert.ok(ini.includes("r.EyeAdaptation.MethodOverride=2\r\n\r\n[OnlineSubsystemMcp.XMPP]"), ini);
  assert.ok(!ini.includes("EyeAdaptationQuality"), ini);
  assert.ok(logLines.some((l) => l.includes("game config: auto exposure basic")));
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));

  assert.equal((await hx.c.setSettings({ exposure: "game" })).exposure, "game");
  assert.deepEqual(await hx.c.play(), { ok: true });
  ini = readFileSync(path.join(hx.configDir, "Engine.ini"), "latin1");
  assert.ok(!/EyeAdaptation/i.test(ini), ini);
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));
  await hx.c.shutdown();
});

// A BaseGame144 folder as the 1.4.4 zip unpacks it: <base>\Dauntless\Archon\..., with every manifest file.
function existingGame(): { base: string; game: string } {
  const base = temp("dr-basegame144-");
  const game = path.join(base, "Dauntless");
  const shipping = path.join(game, "Archon", "Binaries", "Win64", "Dauntless-Win64-Shipping.exe");
  mkdirSync(path.dirname(shipping), { recursive: true });
  writeFileSync(shipping, "layout marker");
  for (const f of files) {
    const target = path.join(game, ...f.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.data);
  }
  return { base, game };
}

test("an existing BaseGame144 folder, pasted, is checked in place and launched from its Dauntless folder", async () => {
  const hx = harness();
  await hx.c.init();
  assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "EXISTING-CODE")), { ok: true });
  assert.deepEqual(await hx.c.register("ExistingSlayer"), { ok: true, username: "ExistingSlayer" });
  const dirBefore = hx.last().install.dir;

  // Refused before anything else happens: a network path, and a folder without the game.
  assert.deepEqual(await hx.c.useExistingGamePath("\\\\host.invalid\\share\\BaseGame144"), { ok: false, error: { code: "folder_invalid" } });
  assert.deepEqual(await hx.c.useExistingGamePath(temp("dr-empty-")), { ok: false, error: { code: "game_folder_not_found" } });
  assert.equal(hx.last().install.dir, dirBefore, "a refused path changes nothing");

  const { base, game } = existingGame();
  const before = gatewayRequests.length;
  assert.deepEqual(await hx.c.useExistingGamePath(`"${base}"`), { ok: true });
  assert.equal(hx.last().install.dir, game);
  assert.equal(hx.last().phase, "ready");
  assert.ok(!gatewayRequests.slice(before).some((r) => r.startsWith("GET /content/v1/files/")), "no game download for complete files");
  for (const dll of ["dxgi.dll", "UndauntedInternalServer.dll"]) assert.ok(existsSync(path.join(game, "Archon", "Binaries", "Win64", dll)), dll);
  assert.deepEqual(await hx.c.play(), { ok: true });
  assert.equal(hx.spawns[0].cwd, path.join(game, "Archon", "Binaries", "Win64"));
  hx.child()!.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 100));
  await hx.c.shutdown();
});

test("Change folder... on an existing game uses that game instead of a DauntlessRevived subfolder", async () => {
  const { base, game } = existingGame();
  const hx = harness(RELAY_PORT, undefined, async () => path.join(game, "Archon", "Binaries", "Win64"));
  await hx.c.init();
  assert.deepEqual(await hx.c.submitInvite(invite(cert.fingerprint, "PICKED-CODE")), { ok: true });
  assert.deepEqual(await hx.c.register("PickedSlayer"), { ok: true, username: "PickedSlayer" });
  assert.deepEqual(await hx.c.chooseInstallDir(), { ok: true });
  assert.equal(hx.last().install.dir, game, "Win64 inside the game resolves to the game root");
  assert.ok(!existsSync(path.join(base, "DauntlessRevived")) && !existsSync(path.join(game, "DauntlessRevived")));
  await hx.c.shutdown();

  // A folder with other things in it still gets a subfolder, as before.
  const other = temp("dr-other-");
  writeFileSync(path.join(other, "notes.txt"), "x");
  const hy = harness(RELAY_PORT, undefined, async () => other);
  await hy.c.init();
  assert.deepEqual(await hy.c.chooseInstallDir(), { ok: true });
  assert.equal(hy.last().install.dir, path.join(other, "DauntlessRevived"));
  await hy.c.shutdown();

  // A BaseGame144 short enough to pick, whose game root is too long: refused, no second copy beside it.
  let longBase = temp("dr-long-");
  longBase = path.join(longBase, "x".repeat(Math.max(1, 145 - longBase.length - 1)));
  const longGame = path.join(longBase, "Dauntless");
  const longExe = path.join(longGame, "Archon", "Binaries", "Win64", "Dauntless-Win64-Shipping.exe");
  mkdirSync(path.dirname(longExe), { recursive: true });
  writeFileSync(longExe, "layout marker");
  assert.ok(longBase.length <= 150 && longGame.length > 150);
  const hz = harness(RELAY_PORT, undefined, async () => longBase);
  await hz.c.init();
  const dirBefore = hz.last().install.dir;
  assert.deepEqual(await hz.c.chooseInstallDir(), { ok: false, error: { code: "folder_invalid" } });
  assert.equal(hz.last().install.dir, dirBefore);
  assert.ok(!existsSync(path.join(longBase, "DauntlessRevived")));
  await hz.c.shutdown();
});

test("public mode: a certificate that does not match the invite stops everything before any request", async () => {
  const hx = harness();
  await hx.c.init();
  gatewayRequests = [];
  await hx.c.submitInvite(invite(other.fingerprint, "SECOND-CODE"));
  const s = hx.last();
  assert.equal(s.phase, "connect");
  assert.equal(s.connect.problem, "cert_mismatch");
  assert.deepEqual(gatewayRequests, [], "the mismatching server received no request at all");
  const reg = await hx.c.register("Other_Name");
  assert.equal(reg.ok, false);
  assert.deepEqual(gatewayRequests, []);
  assert.ok(meta.opts.validCodes?.has("SECOND-CODE"), "the invite code was not spent");
  await hx.c.shutdown();
});

test("public mode: a busy relay port is reported and the game is not started", async () => {
  const hx = harness(BUSY_RELAY_PORT);
  await hx.c.init();
  await hx.c.submitInvite(invite(cert.fingerprint, "SECOND-CODE"));
  assert.deepEqual(await hx.c.register("Busy_Port"), { ok: true, username: "Busy_Port" });
  assert.deepEqual(await hx.c.startInstall(), { ok: true });
  const squatter = net.createServer();
  await new Promise<void>((resolve) => squatter.listen(BUSY_RELAY_PORT, "127.0.0.1", resolve));
  try {
    const r = await hx.c.play();
    assert.deepEqual(r, { ok: false, error: { code: "relay_port_busy", detail: String(BUSY_RELAY_PORT) } });
    assert.equal(hx.spawns.length, 0);
    assert.equal(hx.c.relayActive, false);
    assert.equal(hx.last().phase, "ready");
  } finally {
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  }
  await hx.c.shutdown();
});

test("public mode: an invite for the same host:port with a new certificate never gets the stored key before the user confirms", async () => {
  // One gateway whose certificate can be swapped: first the real one, then another (a rebuilt
  // server, or someone in the middle who hands out their own invite).
  let presented = cert;
  const seen: { url: string; withKey: boolean; fp: string }[] = [];
  const swap = https.createServer({ cert: cert.certPem, key: cert.keyPem }, (req, res) => {
    seen.push({ url: req.url ?? "", withKey: typeof req.headers["x-undaunted-user-api-key"] === "string", fp: presented.fingerprint });
    if ((req.url ?? "").startsWith("/content/")) {
      const key = req.headers["x-undaunted-user-api-key"];
      content.opts = { ...content.opts, key: typeof key === "string" && meta.users.has(key) ? key : "no-such-key" };
      content.handle(req, res);
    } else {
      meta.handle(req, res);
    }
  });
  await new Promise<void>((resolve) => swap.listen(SWAP_PORT, "127.0.0.1", resolve));
  const inviteFor = (fp: string, code: string) =>
    formatInvite({ mode: "public", host: "127.0.0.1", port: SWAP_PORT, fp, code, name: "Friday Hunts", share: null });
  const hx = harness();
  try {
    await hx.c.init();
    assert.deepEqual(await hx.c.submitInvite(inviteFor(cert.fingerprint, "THIRD-CODE")), { ok: true });
    assert.deepEqual(await hx.c.register("Cert_Change"), { ok: true, username: "Cert_Change" });
    assert.ok(seen.some((r) => r.withKey), "the key was used with the real certificate");

    swap.setSecureContext({ cert: other.certPem, key: other.keyPem });
    presented = other;
    swap.closeAllConnections();
    seen.length = 0;

    // The page asks first and gets the warning.
    assert.deepEqual(await hx.c.checkInvite(inviteFor(other.fingerprint, "FOURTH-CODE")), {
      ok: true,
      certificateChanged: true,
      previousFingerprint: cert.fingerprint,
    });
    assert.deepEqual(await hx.c.checkInvite(inviteFor(cert.fingerprint, "FOURTH-CODE")), { ok: true, certificateChanged: false, previousFingerprint: null });

    // Joining without the user's confirmation changes nothing and sends nothing.
    const refused = await hx.c.submitInvite(inviteFor(other.fingerprint, "FOURTH-CODE"));
    assert.deepEqual(refused, { ok: false, error: { code: "cert_changed", detail: cert.fingerprint } });
    assert.equal(seen.length, 0, "nothing went to the new certificate");
    assert.equal(hx.last().server?.fingerprint, cert.fingerprint, "the saved server keeps its certificate");

    // The old pin keeps refusing the new certificate: still nothing sent.
    await hx.c.connect();
    assert.equal(hx.last().connect.problem, "cert_mismatch");
    assert.equal(seen.length, 0);

    // Whatever the settings say, the stored key belongs to the old certificate only.
    const ks = new KeyStore(path.join(hx.userData, "keys"), {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from("enc:" + Buffer.from(plain).toString("base64")),
      decrypt: (data) => Buffer.from(data.toString().slice(4), "base64").toString(),
    });
    assert.equal(await ks.load({ host: "127.0.0.1", port: SWAP_PORT, mode: "public", fp: other.fingerprint }), null);
    assert.match((await ks.load({ host: "127.0.0.1", port: SWAP_PORT, mode: "public", fp: cert.fingerprint })) ?? "", /^UUK_/);

    // The user confirms: the key moves to the new certificate and is used there.
    assert.deepEqual(await hx.c.submitInvite(inviteFor(other.fingerprint, "FOURTH-CODE"), { acceptNewCertificate: true }), { ok: true });
    const s = hx.last();
    assert.equal(s.server?.fingerprint, other.fingerprint);
    assert.equal(s.connect.problem, null);
    assert.equal(s.account.username, "Cert_Change");
    assert.equal(s.phase, "install");
    assert.ok(seen.some((r) => r.withKey && r.fp === other.fingerprint && r.url === "/undaunted/api/GetUserInfo"));
    assert.ok(meta.opts.validCodes?.has("FOURTH-CODE"), "the account was kept, the new invite's code was not spent");
    assert.equal(await ks.load({ host: "127.0.0.1", port: SWAP_PORT, mode: "public", fp: cert.fingerprint }), null);
  } finally {
    await hx.c.shutdown();
    swap.closeAllConnections();
    await new Promise<void>((resolve) => swap.close(() => resolve()));
  }
});

test("public mode: ServerStatus carries the key on every poll over the pinned connection, so only a registered player sees who is online", async () => {
  const hx = harness();
  const start = meta.statusCalls.length;
  const calls = () => meta.statusCalls.slice(start);
  try {
    await hx.c.init();
    await hx.c.submitInvite(invite(cert.fingerprint, "FIFTH-CODE"));
    assert.equal(hx.last().status?.limited, true);
    await hx.c.pollStatus();
    assert.ok(calls().length >= 2 && calls().every((c) => !c.withKey), "no key before registering");
    assert.equal(hx.last().status?.limited, true, "the panel says to sign in instead of an empty list");
    assert.equal(hx.last().status?.online, true, "still online");

    assert.deepEqual(await hx.c.register("Status_Key"), { ok: true, username: "Status_Key" });
    const afterRegister = calls().length;
    for (let i = 0; i < 3; i++) await hx.c.pollStatus();
    const polled = calls().slice(afterRegister - 1);
    assert.equal(polled.length, 4, "the refresh after registering and three polls");
    assert.ok(polled.every((c) => c.withKey && c.registered), "the key went with every poll and the server accepted it");
    let s = hx.last();
    assert.equal(s.status?.limited, false);
    assert.equal(s.status?.playersOnline, 2);
    assert.deepEqual(s.status?.instances.map((i) => i.id), ["ramsgate", "hunt-1"]);

    // The launcher opened again (same settings and key store): its very first status goes with the key.
    const beforeReopen = meta.statusCalls.length;
    const reopened = harness(RELAY_PORT, hx.userData);
    try {
      await reopened.c.init();
      await waitUntil(() => reopened.last().status !== null && !reopened.last().connect.checking);
      assert.equal(reopened.last().status?.limited, false);
      assert.equal(reopened.last().account.username, "Status_Key");
      const reopenCalls = meta.statusCalls.slice(beforeReopen);
      assert.ok(reopenCalls.length >= 1 && reopenCalls.every((c) => c.withKey && c.registered));
    } finally {
      await reopened.c.shutdown();
    }

    // Logging out hides the list at once, and later polls go without a key.
    assert.deepEqual(await hx.c.logout(), { ok: true });
    s = hx.last();
    assert.equal(s.status?.limited, true);
    assert.deepEqual([s.status?.playersOnline, s.status?.players, s.status?.instances], [0, [], []]);
    const beforeLogoutPoll = meta.statusCalls.length;
    await hx.c.pollStatus();
    assert.deepEqual(meta.statusCalls.slice(beforeLogoutPoll), [{ withKey: false, registered: false }]);
    assert.equal(hx.last().status?.limited, true);
  } finally {
    await hx.c.shutdown();
  }
});

test("a status request still on its way when the player logs out (or forgets the server) never brings the list back", async () => {
  const hx = harness();
  try {
    await hx.c.init();
    await hx.c.submitInvite(invite(cert.fingerprint, "SIXTH-CODE"));
    assert.deepEqual(await hx.c.register("Overtaken_1"), { ok: true, username: "Overtaken_1" });
    assert.equal(hx.c.snapshot().status?.limited, false);
    const key = [...meta.users].find(([, u]) => u.username === "Overtaken_1")![0];
    const hidden = (what: string) => {
      const s = hx.c.snapshot();
      assert.equal(s.status?.limited, true, what);
      assert.deepEqual([s.status?.playersOnline, s.status?.players, s.status?.instances], [0, [], []], what);
    };

    // A poll (the 15 s timer or Refresh) leaves with the key; logout() finishes before the answer.
    let hold = meta.holdNextStatus();
    const poll = hx.c.pollStatus();
    await hold.arrived;
    assert.deepEqual(meta.statusCalls.at(-1), { withKey: true, registered: true }, "the held request carried the key");
    assert.deepEqual(await hx.c.logout(), { ok: true });
    hidden("hidden at logout");
    hold.release();
    await poll;
    hidden("the full answer that arrived after logout was dropped");
    assert.equal(hx.c.snapshot().status?.online, true);

    // The same for connect() (Retry, or the first check when the launcher opens).
    assert.deepEqual(await hx.c.useExistingKey(key), { ok: true });
    assert.equal(hx.c.snapshot().status?.limited, false);
    hold = meta.holdNextStatus();
    const connecting = hx.c.connect();
    await hold.arrived;
    assert.deepEqual(meta.statusCalls.at(-1), { withKey: true, registered: true });
    assert.deepEqual(await hx.c.logout(), { ok: true });
    hold.release();
    assert.deepEqual(await connecting, { ok: true });
    hidden("connect() shows the overtaken answer as limited");
    assert.deepEqual([hx.c.snapshot().connect.problem, hx.c.snapshot().status?.online], [null, true], "the server did answer");

    // Forgetting the server: the old server's answer is not shown at all.
    assert.deepEqual(await hx.c.useExistingKey(key), { ok: true });
    hold = meta.holdNextStatus();
    const lastPoll = hx.c.pollStatus();
    await hold.arrived;
    assert.deepEqual(await hx.c.forgetServer(), { ok: true });
    hold.release();
    await lastPoll;
    assert.equal(hx.c.snapshot().status, null);
  } finally {
    await hx.c.shutdown();
  }
});

test("a key the server refuses is not sent with ServerStatus again", async () => {
  const hx = harness();
  try {
    await hx.c.init();
    // A plausible key that the server does not know, stored for this server by hand.
    const ks = new KeyStore(path.join(hx.userData, "keys"), {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from("enc:" + Buffer.from(plain).toString("base64")),
      decrypt: (data) => Buffer.from(data.toString().slice(4), "base64").toString(),
    });
    await ks.save({ host: "127.0.0.1", port: GATEWAY_PORT, mode: "public", fp: cert.fingerprint }, "UUK_" + "0".repeat(48));
    const start = meta.statusCalls.length;
    await hx.c.submitInvite(invite(cert.fingerprint, "FIFTH-CODE"));
    const s = hx.last();
    assert.equal(s.lastError?.code, "key_rejected");
    assert.equal(s.status?.limited, true);
    assert.deepEqual(meta.statusCalls.slice(start), [{ withKey: true, registered: false }], "the first status went with the stored key");
    await hx.c.pollStatus();
    await hx.c.pollStatus();
    assert.deepEqual(meta.statusCalls.slice(start + 1), [
      { withKey: false, registered: false },
      { withKey: false, registered: false },
    ]);
  } finally {
    await hx.c.shutdown();
  }
});

test("private mode: the key goes with ServerStatus over plain HTTP to the invite's own host only", async () => {
  const priv = new FakeMetagame({ name: "Tailnet Hunts", validCodes: new Set(["PRIV-CODE"]), contentPort: null });
  await priv.start(PRIVATE_PORT);
  const hx = harness();
  try {
    await hx.c.init();
    const text = formatInvite({ mode: "private", host: "127.0.0.1", port: PRIVATE_PORT, fp: null, code: "PRIV-CODE", name: "Tailnet Hunts", share: null });
    assert.deepEqual(await hx.c.submitInvite(text), { ok: true });
    assert.equal(hx.last().status?.limited, true);
    assert.deepEqual(await hx.c.register("Tailnet_1"), { ok: true, username: "Tailnet_1" });
    await hx.c.pollStatus();
    assert.equal(hx.last().status?.limited, false);
    assert.deepEqual(hx.last().status?.players.map((p) => p.name), ["Aurora", "Borealis"]);
    const calls = priv.statusCalls;
    assert.ok(!calls[0].withKey, "no key before registering");
    assert.ok(calls.slice(-2).every((c) => c.withKey && c.registered));
  } finally {
    await hx.c.shutdown();
    await priv.stop();
  }
});

async function waitUntil(cond: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("connected launcher refreshes news without restarting and bounds polling", async () => {
  const hx = harness();
  const previous = content.opts.news;
  try {
    content.opts.news = { items: [{ date: "2026-10-01", title: "Before", body: "Old" }] };
    await hx.c.init();
    await hx.c.submitInvite(invite(cert.fingerprint));
    await waitUntil(() => hx.c.getNews()[0]?.title === "Before");
    content.opts.news = { items: [{ date: "2026-10-02", title: "After", body: "New" }] };
    const count = () => gatewayRequests.filter(r => r === "GET /content/v1/news").length;
    const before = count();
    await hx.c.pollStatus();
    assert.equal(count(), before);
    (hx.c as any).newsCheckedAt = Date.now() - 61000;
    await hx.c.pollStatus();
    await waitUntil(() => hx.c.getNews()[0]?.title === "After");
    assert.equal(count(), before + 1);
  } finally { content.opts.news = previous; await hx.c.shutdown(); }
});
