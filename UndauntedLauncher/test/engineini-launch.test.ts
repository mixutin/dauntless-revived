import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { applyGameConfig, defaultConfigDir, rewriteEngineIniText, splitLines, systemSettingsLines } from "../src/main/engineini";
import { settingsPatch } from "../src/main/ipc-validate";
import { sanitizeSettings } from "../src/main/settings";
import { EXPOSURE_MODES, type ExposureMode } from "../src/shared/types";
import { buildLaunchArgs, describeLaunch, FIXED_ARGS, GameProcess, gameLocale, maskArgs, type SpawnFn } from "../src/main/launch";
import { addSecret, redact, setSink, log } from "../src/main/log";

const KEY = "UUK_" + "0123456789abcdef".repeat(3);

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "dr-launcher-test-"));
}

test('Poet fix writes missing config, backs up changed display settings once and reapplies after a game change',async()=>{
  const dir=tempDir(); const file=path.join(dir,'GameUserSettings.ini');
  const opts={host:'127.0.0.1',graphics:-1 as const,configDir:dir,safeWindow:true};
  try {
    assert.equal((await applyGameConfig(opts)).displayRepaired,true);
    assert.match(readFileSync(file,'utf8'),/ResolutionSizeX=1280/);
    assert.equal((await applyGameConfig(opts)).displayRepaired,false);
    const previous='[/Script/Archon.ArchonGameUserSettings]\nResolutionSizeX=1920\nResolutionSizeY=1080\nFullscreenMode=1\nVolume=0.7\n';
    writeFileSync(file,previous);
    assert.equal((await applyGameConfig(opts)).displayRepaired,true);
    const backups=readdirSync(dir).filter(name=>name.includes('.before-display-repair-'));
    assert.equal(backups.length,1); assert.equal(readFileSync(path.join(dir,backups[0]),'utf8'),previous);
    assert.match(readFileSync(file,'utf8'),/Volume=0.7/);
    assert.equal((await applyGameConfig(opts)).displayRepaired,false);
    assert.equal(readdirSync(dir).filter(name=>name.includes('.before-display-repair-')).length,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

// What friend-kit/play.ps1 writes for a new file with -Graphics 4 and host 100.64.0.7.
const EXPECTED_FRESH = [
  "[SystemSettings]",
  "r.Streaming.PoolSize=3000",
  "r.Streaming.LimitPoolSizeToVRAM=1",
  "gc.TimeBetweenPurgingPendingKillObjects=10",
  "s.ForceGCAfterLevelStreamedOut=1",
  "sg.ViewDistanceQuality=4",
  "sg.AntiAliasingQuality=4",
  "sg.ShadowQuality=4",
  "sg.PostProcessQuality=4",
  "sg.TextureQuality=4",
  "sg.EffectsQuality=4",
  "sg.FoliageQuality=4",
  "sg.ShadingQuality=4",
  "sg.ResolutionQuality=100",
  "r.ScreenPercentage=100",
  "r.MipMapLODBias=0",
  "r.MaxAnisotropy=16",
  "r.Tonemapper.Sharpen=0.6",
  "",
  "[OnlineSubsystemMcp.XMPP]",
  'ServerAddr="ws://100.64.0.7"',
  "ServerPort=61099",
  "bUseSSL=false",
  "",
];

test("Engine.ini: a new file matches play.ps1 byte for byte (CRLF, ASCII)", async () => {
  const dir = tempDir();
  try {
    const r = await applyGameConfig({ host: "100.64.0.7", graphics: 4, configDir: dir });
    const bytes = readFileSync(r.engineIni);
    assert.equal(bytes.toString("latin1"), EXPECTED_FRESH.map((l) => l + "\r\n").join(""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Engine.ini: replaces only the two managed sections and keeps the rest", async () => {
  const dir = tempDir();
  try {
    const before = [
      "[Core.Log]",
      "LogOnline=Verbose",
      "",
      "[systemsettings]", // any case, like PowerShell's -match
      "r.Streaming.PoolSize=100",
      "old.line=1",
      "[OnlineSubsystemMcp.XMPP]",
      'ServerAddr="wss://xmpp-service-prod.ol.epicgames.com"',
      "bUseSSL=true",
      "[/Script/Engine.RendererSettings]",
      "r.DefaultFeature.MotionBlur=False",
    ].join("\n");
    writeFileSync(path.join(dir, "Engine.ini"), "\ufeff" + before, "utf8");
    await applyGameConfig({ host: "hostpc.tail1234.ts.net", graphics: -1, configDir: dir });
    const text = readFileSync(path.join(dir, "Engine.ini"), "latin1");
    const lines = splitLines(text);
    assert.deepEqual(lines, [
      "[SystemSettings]",
      "r.Streaming.PoolSize=3000",
      "r.Streaming.LimitPoolSizeToVRAM=1",
      "gc.TimeBetweenPurgingPendingKillObjects=10",
      "s.ForceGCAfterLevelStreamedOut=1",
      "",
      "[OnlineSubsystemMcp.XMPP]",
      'ServerAddr="ws://hostpc.tail1234.ts.net"',
      "ServerPort=61099",
      "bUseSSL=false",
      "",
      "[Core.Log]",
      "LogOnline=Verbose",
      "",
      "[/Script/Engine.RendererSettings]",
      "r.DefaultFeature.MotionBlur=False",
    ]);
    assert.ok(!text.includes("epicgames"));
    assert.ok(!text.includes("\ufeff"));
    // Running it again gives the same file (idempotent).
    await applyGameConfig({ host: "hostpc.tail1234.ts.net", graphics: -1, configDir: dir });
    assert.equal(readFileSync(path.join(dir, "Engine.ini"), "latin1"), text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Engine.ini: UTF-16 input is read, and non-ASCII kept lines are written as UTF-16", async () => {
  const dir = tempDir();
  try {
    const content = "[Custom]\r\nNote=Hyvää jahtia\r\n";
    writeFileSync(path.join(dir, "Engine.ini"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]));
    await applyGameConfig({ host: "100.64.0.7", graphics: 2, configDir: dir });
    const raw = readFileSync(path.join(dir, "Engine.ini"));
    assert.equal(raw[0], 0xff);
    assert.equal(raw[1], 0xfe);
    const text = raw.subarray(2).toString("utf16le");
    assert.ok(text.includes("Note=Hyvää jahtia"));
    assert.ok(text.includes("sg.ShadowQuality=2"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GameUserSettings.ini: sg.* lines follow a forced preset, untouched with the in-game menu option", async () => {
  const dir = tempDir();
  try {
    const gus = path.join(dir, "GameUserSettings.ini");
    const original = "[ScalabilityGroups]\r\nsg.ResolutionQuality=70\r\nsg.ViewDistanceQuality=1\r\nSG.SHADOWQUALITY=0\r\nsg.FoliageQuality=2\r\n";
    writeFileSync(gus, original, "latin1");
    await applyGameConfig({ host: "100.64.0.7", graphics: -1, configDir: dir });
    assert.equal(readFileSync(gus, "latin1"), original);
    await applyGameConfig({ host: "100.64.0.7", graphics: 3, configDir: dir });
    assert.equal(
      readFileSync(gus, "latin1"),
      "[ScalabilityGroups]\r\nsg.ResolutionQuality=70\r\nsg.ViewDistanceQuality=3\r\nsg.ShadowQuality=3\r\nsg.FoliageQuality=3\r\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Engine.ini: refuses an invalid host (nothing can be injected into the file)", () => {
  assert.throws(() => rewriteEngineIniText([], 'evil"\r\n[x]', 4));
});

test("default config dir is the user's Archon WindowsClient folder", () => {
  assert.equal(defaultConfigDir({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }), path.join("C:\\Users\\a\\AppData\\Local", "Archon", "Saved", "Config", "WindowsClient"));
});

test("launch args follow contract 6", () => {
  const args = buildLaunchArgs({ host: "100.64.0.7", port: 61000, key: KEY, windowed: false });
  assert.deepEqual(args, ["100.64.0.7:61000", `-AUTH_PASSWORD=${KEY}`, ...FIXED_ARGS]);
  assert.deepEqual(FIXED_ARGS, [
    "-AUTH_LOGIN=unused",
    "-AUTH_TYPE=exchangecode",
    "-epicapp=appidlol",
    "-epicenv=Prod",
    "-EpicPortal",
    "-epicusername=usernamelol",
    "-epicuserid=useridlol",
    "-epiclocale=en-US",
    "-epicsandboxid=sandboxidlol",
    "-epicdeploymentid=deploymentidlol",
    "-NoEAC",
  ]);
  const windowed = buildLaunchArgs({ host: "hostpc.ts.net", port: 61000, key: KEY, windowed: true });
  assert.deepEqual(windowed.slice(-3), ["-windowed", "-ResX=1280", "-ResY=720"]);
  assert.throws(() => buildLaunchArgs({ host: "100.64.0.7", port: 61000, key: "bad key with spaces", windowed: false }));
  assert.throws(() => buildLaunchArgs({ host: "bad host", port: 61000, key: KEY, windowed: false }));
  assert.throws(() => buildLaunchArgs({ host: "100.64.0.7", port: 0, key: KEY, windowed: false }));
});

test("the game language becomes -epiclocale; auto follows the system when the game has that language", () => {
  const locale = (gameLocale: string | undefined) =>
    buildLaunchArgs({ host: "100.64.0.7", port: 61000, key: KEY, windowed: false, gameLocale }).filter((a) => a.startsWith("-epiclocale="));
  assert.deepEqual(locale(undefined), ["-epiclocale=en-US"]);
  assert.deepEqual(locale("es-ES"), ["-epiclocale=es-ES"]);
  assert.deepEqual(locale("pt-BR"), ["-epiclocale=pt-BR"]);
  assert.deepEqual(locale("xx-XX"), ["-epiclocale=en-US"], "never an argument the game has no text for");
  assert.equal(gameLocale("auto", "es-ES"), "es-ES");
  assert.equal(gameLocale("auto", "es-419"), "es-ES");
  assert.equal(gameLocale("auto", "de"), "de-DE");
  assert.equal(gameLocale("auto", "pt-PT"), "pt-BR");
  assert.equal(gameLocale("auto", "fi-FI"), "en-US", "no Finnish text in the game");
  assert.equal(gameLocale("auto", ""), "en-US");
  assert.equal(gameLocale("ja-JP", "en-US"), "ja-JP", "a chosen language wins over the system");
});

test("the key is masked in anything that can be logged", () => {
  const args = buildLaunchArgs({ host: "100.64.0.7", port: 61000, key: KEY, windowed: false });
  const masked = maskArgs(args);
  assert.equal(masked[1], "-AUTH_PASSWORD=<hidden>");
  assert.ok(!describeLaunch("game.exe", args).includes(KEY));

  const lines: string[] = [];
  setSink((l) => lines.push(l));
  addSecret(KEY);
  log.info(`raw ${args.join(" ")}`);
  log.info(`header x-undaunted-user-api-key: ${KEY}`);
  log.info("a different UUK_deadbeefdeadbeef leaked");
  log.info(`bare ${KEY.slice(4)}`);
  for (const l of lines) {
    assert.ok(!l.includes(KEY), l);
    assert.ok(!l.includes(KEY.slice(4)), l);
    assert.ok(!l.includes("deadbeefdeadbeef"), l);
  }
  assert.equal(redact("-auth_password=abc def"), "-auth_password=<hidden> def");
});

test("GameProcess: tracks start and exit, and refuses to start twice", async () => {
  const calls: { exe: string; args: string[]; cwd: string }[] = [];
  let child: EventEmitter | null = null;
  const fakeSpawn = ((exe: string, args: string[], opts: { cwd: string }) => {
    calls.push({ exe, args, cwd: opts.cwd });
    child = new EventEmitter();
    setImmediate(() => child!.emit("spawn"));
    return child;
  }) as unknown as SpawnFn;
  const gp = new GameProcess(fakeSpawn);
  const events: boolean[] = [];
  gp.onChange((running) => events.push(running));
  await gp.start("C:\\game\\Archon\\Binaries\\Win64", ["a"]);
  assert.equal(gp.running, true);
  await assert.rejects(gp.start("C:\\game\\Archon\\Binaries\\Win64", ["a"]));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].exe.endsWith("Dauntless-Win64-Shipping.exe"));
  assert.equal(calls[0].cwd, "C:\\game\\Archon\\Binaries\\Win64");
  (child as unknown as EventEmitter).emit("exit", 0);
  assert.equal(gp.running, false);
  assert.deepEqual(events, [true, false]);
});

test("Engine.ini, public mode: chat goes to the local relay (ws://127.0.0.1:<relay port>)", async () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, "Engine.ini"), '[OnlineSubsystemMcp.XMPP]\r\nServerAddr="ws://100.64.0.7"\r\nServerPort=61099\r\nbUseSSL=false\r\n[Core.Log]\r\nLogNet=Log\r\n', "latin1");
    await applyGameConfig({ host: "127.0.0.1", xmppPort: 61000, graphics: 4, configDir: dir });
    const lines = splitLines(readFileSync(path.join(dir, "Engine.ini"), "latin1"));
    const xmpp = lines.indexOf("[OnlineSubsystemMcp.XMPP]");
    assert.deepEqual(lines.slice(xmpp, xmpp + 4), ["[OnlineSubsystemMcp.XMPP]", 'ServerAddr="ws://127.0.0.1"', "ServerPort=61000", "bUseSSL=false"]);
    assert.equal(lines.filter((l) => l === "[OnlineSubsystemMcp.XMPP]").length, 1);
    assert.ok(!lines.includes('ServerAddr="ws://100.64.0.7"'));
    assert.deepEqual(lines.slice(-2), ["[Core.Log]", "LogNet=Log"]);
    assert.throws(() => rewriteEngineIniText([], "127.0.0.1", 4, 0));
    assert.throws(() => rewriteEngineIniText([], "127.0.0.1", 4, 70000));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("launch args, public mode: the relay address comes first and the key stays masked", () => {
  const args = buildLaunchArgs({ host: "127.0.0.1", port: 61000, key: KEY, windowed: true });
  assert.equal(args[0], "127.0.0.1:61000");
  assert.equal(args[1], `-AUTH_PASSWORD=${KEY}`);
  assert.deepEqual(args.slice(2, 2 + FIXED_ARGS.length), FIXED_ARGS);
  assert.deepEqual(args.slice(-3), ["-windowed", "-ResX=1280", "-ResY=720"]);
  const line = describeLaunch("Dauntless-Win64-Shipping.exe", args);
  assert.ok(!line.includes(KEY));
  assert.ok(line.startsWith("Dauntless-Win64-Shipping.exe 127.0.0.1:61000 -AUTH_PASSWORD=<hidden> -AUTH_LOGIN=unused"));
});

test("Engine.ini: the r.EyeAdaptationQuality=0 line 0.1.0 wrote is gone after the next launch; other sections stay", async () => {
  const dir = tempDir();
  try {
    const before = ["[SystemSettings]", "r.Streaming.PoolSize=3000", "r.EyeAdaptationQuality=0", "", "[Core.Log]", "LogOnline=Verbose"];
    writeFileSync(path.join(dir, "Engine.ini"), before.map((l) => l + "\r\n").join(""), "latin1");
    await applyGameConfig({ host: "100.64.0.7", graphics: -1, configDir: dir });
    const text = readFileSync(path.join(dir, "Engine.ini"), "latin1");
    assert.ok(!/EyeAdaptation/i.test(text), text);
    assert.ok(text.includes("[Core.Log]\r\nLogOnline=Verbose\r\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Engine.ini: no graphics preset turns off the game's automatic exposure", () => {
  for (const g of [-1, 0, 1, 2, 3, 4] as const) {
    assert.ok(!rewriteEngineIniText([], "100.64.0.7", g).some((l) => /EyeAdaptation/i.test(l)), `preset ${g}`);
    // With either auto exposure choice: never EyeAdaptationQuality, and an exposure line only for Basic,
    // as the last line of [SystemSettings] (so "game" stays byte for byte what play.ps1 writes).
    for (const m of EXPOSURE_MODES) {
      const lines = rewriteEngineIniText([], "100.64.0.7", g, 61099, m);
      assert.ok(!lines.some((l) => /EyeAdaptationQuality/i.test(l)), `preset ${g}, ${m}`);
      assert.equal(lines.filter((l) => /EyeAdaptation/i.test(l)).length, m === "basic" ? 1 : 0, `preset ${g}, ${m}`);
      if (m === "basic") assert.equal(lines[lines.indexOf("") - 1], "r.EyeAdaptation.MethodOverride=2", `preset ${g}`);
    }
  }
  assert.throws(() => systemSettingsLines(4, "manual" as ExposureMode), /invalid exposure mode/);
});

test("Engine.ini: experimental Basic mode remains adaptive and can be reverted", async () => {
  const dir = tempDir();
  try {
    const opts = { host: "100.64.0.7", graphics: 4 as const, configDir: dir };
    await applyGameConfig({ ...opts, exposure: "basic" });
    const basic = readFileSync(path.join(dir, "Engine.ini"), "latin1");
    assert.match(basic, /r\.EyeAdaptation\.MethodOverride=2/);
    assert.ok(!basic.includes("r.EyeAdaptationQuality=0"));
    await applyGameConfig({ ...opts, exposure: "game" });
    const restored = readFileSync(path.join(dir, "Engine.ini"), "latin1");
    assert.ok(!/EyeAdaptation/i.test(restored));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exposure setting defaults to the game and rejects unexpected renderer values", () => {
  {
    const a = { mode: "public", host: "203.0.113.10", port: 443, name: "A", share: null, fp: "a".repeat(64), code: null };
    const b = { mode: "public", host: "203.0.113.20", port: 443, name: "B", share: null, fp: "b".repeat(64), code: null };
    const bad = { mode: "public", host: "203.0.113.30", port: 443, name: "C", share: null, fp: "nope", code: null };
    const s = sanitizeSettings({ server: { ...a, name: "A renamed" }, savedServers: [b, a, bad, b] }, "en");
    assert.deepEqual(s.savedServers.map((sv) => sv.name), ["B", "A renamed"], "deduplicated, invalid dropped, the current entry kept up to date");
    assert.deepEqual(sanitizeSettings({ server: a }, "en").savedServers.map((sv) => sv.name), ["A"], "older settings: the current server is added");
    assert.deepEqual(sanitizeSettings({ savedServers: "x" }, "en").savedServers, []);
  }
  assert.equal(sanitizeSettings({}, "en").exposure, "game");
  assert.equal(sanitizeSettings({ exposure: "basic" }, "en").exposure, "basic");
  assert.equal(sanitizeSettings({ exposure: "manual" }, "en").exposure, "game");
  assert.deepEqual(settingsPatch({ exposure: "basic" }), { exposure: "basic" });
  assert.equal(settingsPatch({ exposure: "manual" }), null);
});

test("the log window setting defaults to hidden and takes only true or false", () => {
  assert.equal(sanitizeSettings({}, "en").showConsole, false);
  assert.equal(sanitizeSettings({ showConsole: true }, "en").showConsole, true);
  assert.equal(sanitizeSettings({ showConsole: "yes" }, "en").showConsole, false);
  assert.deepEqual(settingsPatch({ showConsole: true }), { showConsole: true });
  assert.equal(settingsPatch({ showConsole: "yes" }), null);
});

test("game language setting defaults to automatic and rejects unexpected renderer values", () => {
  assert.equal(sanitizeSettings({}, "en").gameLanguage, "auto");
  assert.equal(sanitizeSettings({ gameLanguage: "ru-RU" }, "en").gameLanguage, "ru-RU");
  assert.equal(sanitizeSettings({ gameLanguage: "fi-FI" }, "en").gameLanguage, "auto");
  assert.deepEqual(settingsPatch({ gameLanguage: "es-ES" }), { gameLanguage: "es-ES" });
  assert.equal(settingsPatch({ gameLanguage: "es" }), null);
});

test("stored game folders stay native to the host platform", () => {
  const win = sanitizeSettings({ installDir: "C:\\Games\\Dauntless", verifiedDir: "/home/slayer/Games/Dauntless" }, "en", "win32");
  assert.equal(win.installDir, "C:\\Games\\Dauntless");
  assert.equal(win.verifiedDir, null);

  const linux = sanitizeSettings({ installDir: "/home/slayer/Games/Dauntless", verifiedDir: "C:\\Games\\Dauntless" }, "en", "linux");
  assert.equal(linux.installDir, "/home/slayer/Games/Dauntless");
  assert.equal(linux.verifiedDir, null);
});
