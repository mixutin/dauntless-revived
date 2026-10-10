// UI text and UI decisions: every language complete, every key the page uses exists, and the one
// big button does the right thing in each phase. Also checks the real compiled-in game manifest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isStringKey, STRINGS, systemLanguage, translate } from "../src/shared/i18n";
import { primaryButton, stepIndex } from "../src/shared/ui-model";
import { formatBytes, formatDate, formatDuration, formatRunningTime } from "../src/shared/format";
import { validateManifest, manifestFingerprint } from "../src/main/manifest";
import type { InviteError } from "../src/shared/invite";
import type { UsernameCheck } from "../src/shared/username";
import type { ErrorCode, NoticeCode, Snapshot } from "../src/shared/types";
import { EXPOSURE_MODES, LANGUAGES } from "../src/shared/types";

const ROOT = path.resolve(__dirname, "..", "..");

// Records over the union types: the compiler fails this file if a new code is added without text.
const ERROR_CODES: Record<ErrorCode, true> = {
  account_banned: true,
  invite_invalid_format: true,
  invite_invalid: true,
  username_invalid: true,
  username_taken: true,
  registration_closed: true,
  bad_request: true,
  server_unreachable: true,
  server_error: true,
  key_invalid: true,
  key_rejected: true,
  key_storage_unavailable: true,
  no_content_server: true,
  manifest_mismatch: true,
  manifest_unavailable: true,
  disk_space: true,
  folder_invalid: true,
  game_folder_not_found: true,
  folder_not_empty: true,
  download_failed: true,
  file_missing_on_server: true,
  file_different_on_server: true,
  verify_failed: true,
  dll_failed: true,
  game_files_invalid: true,
  already_running: true,
  launch_failed: true,
  windows_runtime_missing: true,
  compat_runtime_missing: true,
  config_failed: true,
  busy: true,
  cancelled: true,
  cert_mismatch: true,
  cert_changed: true,
  rate_limited: true,
  relay_port_busy: true,
  relay_failed: true,
  unknown: true,
};
const INVITE_ERRORS: Record<InviteError, true> = {
  empty: true,
  too_long: true,
  not_invite: true,
  version: true,
  params: true,
  mode: true,
  host: true,
  port: true,
  fp: true,
  code: true,
  name: true,
  share: true,
};
const USERNAME_CHECKS: Record<UsernameCheck, true> = { ok: true, empty: true, too_short: true, too_long: true, bad_chars: true };
const NOTICES: Record<NoticeCode, true> = { keep_open: true, backup_saved: true, repair_done: true, install_done: true };

function placeholders(text: string): string[] {
  return (text.match(/\{[a-z]+\}/g) ?? []).sort();
}

test("every language has the same keys and the same placeholders as English, and no empty text", () => {
  const en = STRINGS.en;
  for (const lang of LANGUAGES) {
    const other = STRINGS[lang];
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), `keys differ: ${lang}`);
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      assert.ok(other[k].trim().length > 0, `empty ${lang} text: ${k}`);
      assert.deepEqual(placeholders(other[k]), placeholders(en[k]), `placeholders differ: ${lang} ${k}`);
    }
  }
});

test("the language picker offers every language, and the system locale picks one", () => {
  for (const lang of LANGUAGES) assert.ok(isStringKey(`lang_${lang}`), `lang_${lang}`);
  assert.equal(systemLanguage("es-ES"), "es");
  assert.equal(systemLanguage("es-419"), "es");
  assert.equal(systemLanguage("fi"), "fi");
  assert.equal(systemLanguage("en-US"), "en");
  assert.equal(systemLanguage("de-DE"), "en");
});

test("every dynamic key family is complete", () => {
  for (const code of Object.keys(ERROR_CODES)) assert.ok(isStringKey(`err_${code}`), `err_${code}`);
  for (const e of Object.keys(INVITE_ERRORS)) assert.ok(isStringKey(`invite_err_${e}`), `invite_err_${e}`);
  for (const c of Object.keys(USERNAME_CHECKS)) assert.ok(isStringKey(`reg_check_${c}`), `reg_check_${c}`);
  for (const n of Object.keys(NOTICES)) assert.ok(isStringKey(`notice_${n}`), `notice_${n}`);
  for (const m of ["OPEN", "INVITECODE", "NONE"]) assert.ok(isStringKey(`reg_mode_${m}`));
  for (const w of ["menu", "city", "hunt", "dojo", "tutorial", "unknown"]) assert.ok(isStringKey(`where_${w}`));
  for (const g of ["menu", "0", "1", "2", "3", "4"]) assert.ok(isStringKey(`gfx_${g}`));
  for (const m of EXPOSURE_MODES) assert.ok(isStringKey(`exposure_${m}`), `exposure_${m}`);
  for (const k of ["city", "hunt", "dojo", "tutorial"]) assert.ok(isStringKey(`kind_${k}`));
});

test("every key referenced in the page and the main process exists", () => {
  const files: string[] = [path.join(ROOT, "index.html"), path.join(ROOT, "src", "main.ts")];
  for (const dir of ["src/renderer", "src/main", "src/shared"]) {
    for (const f of readdirSync(path.join(ROOT, dir))) if (f.endsWith(".ts")) files.push(path.join(ROOT, dir, f));
  }
  const patterns = [/\bt\("([a-z0-9_]+)"/g, /translate\([^,()]+,\s*"([a-z0-9_]+)"/g, /data-i18n(?:-aria|-alt)?="([a-z0-9_]+)"/g, /(?:labelKey|titleKey|key): "([a-z0-9_]+)"/g];
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        checked++;
        assert.ok(isStringKey(m[1]), `${path.basename(file)} uses a missing key: ${m[1]}`);
      }
    }
  }
  assert.ok(checked > 150, `only ${checked} references found; the scan is broken`);
});

test("durations get days past 24 hours", () => {
  assert.equal(formatDuration(12), "12 s");
  assert.equal(formatDuration(95), "1 min 35 s");
  assert.equal(formatDuration(3725), "1 h 2 min");
  assert.equal(formatDuration(76 * 3600 + 17 * 60), "3 d 4 h");
  assert.equal(formatDuration(76 * 3600 + 17 * 60, "fi"), "3 vrk 4 t");
  const now = Date.parse("2026-09-21T12:00:00Z");
  assert.equal(formatRunningTime("2026-09-21T11:18:00Z", now), "42 min");
  assert.equal(formatRunningTime("2026-09-21T08:55:00Z", now), "3 h 5 min");
  assert.equal(formatRunningTime("2026-09-19T08:00:00Z", now, "fi"), "2 vrk 4 t");
  assert.equal(formatRunningTime("2026-09-19T08:00:00Z", now, "es"), "2 d 4 h");
  assert.equal(formatRunningTime("2026-09-21T11:59:30Z", now, "es"), "recién iniciado");
});

test("translate fills placeholders", () => {
  assert.equal(translate("fi", "inst_title_hunt", { behemoth: "Shrike" }), "Metsästys: Shrike");
  assert.equal(translate("en", "err_relay_port_busy", { port: 61000 }).includes("61000"), true);
  assert.equal(translate("es", "inst_title_hunt", { behemoth: "Shrike" }), "Cacería: Shrike");
});

function snap(over: Partial<Snapshot>): Snapshot {
  const base: Snapshot = {
    phase: "ready",
    busy: false,
    savedServers: [],
    server: { mode: "public", host: "203.0.113.10", port: 443, name: "S", hasShare: false, hasPendingInvite: false, loopback: false, fingerprint: "a".repeat(64) },
    connect: { checking: false, problem: null, tailscaleInstalled: false, lastCheckedAt: null },
    account: { username: "U", hasKey: true, offerBackup: false },
    install: { dir: "C:\\g", defaultDir: "C:\\g", installed: true, missingFiles: 0, verified: true, dllsOk: true, freeBytes: 5e10, requiredBytes: 1e9, totalBytes: 1e10, vcRuntimeMissing: [], contentAvailable: true },
    task: null,
    game: { running: false, relayPort: null },
    settings: { graphics: 4, exposure: "game", windowed: false, language: "en", gameLanguage: "auto", showConsole: false },
    app: { version: "0", packaged: false, updateReady: false },
    status: null,
    statusUnsupported: false,
    lastError: null,
    notice: null,
  };
  return { ...base, ...over };
}

test("the big button in every phase", () => {
  const form = { inviteValid: false, usernameValid: false };
  assert.deepEqual(primaryButton(snap({ phase: "join", server: null }), form), { labelKey: "btn_join", action: "join", disabled: true });
  assert.equal(primaryButton(snap({ phase: "join", server: null }), { ...form, inviteValid: true }).disabled, false);
  assert.equal(primaryButton(snap({ phase: "connect", connect: { checking: true, problem: null, tailscaleInstalled: false, lastCheckedAt: null } }), form).action, "none");
  assert.equal(primaryButton(snap({ phase: "connect", connect: { checking: false, problem: "cert_mismatch", tailscaleInstalled: false, lastCheckedAt: null } }), form).action, "new_invite");
  assert.equal(primaryButton(snap({ phase: "connect", connect: { checking: false, problem: "unreachable", tailscaleInstalled: false, lastCheckedAt: null } }), form).action, "retry");
  assert.equal(primaryButton(snap({ phase: "register" }), { ...form, usernameValid: true }).disabled, false);
  assert.equal(primaryButton(snap({ phase: "register" }), form).disabled, true);
  const install = snap({ phase: "install" });
  assert.equal(primaryButton(install, form).action, "install");
  assert.equal(primaryButton({ ...install, install: { ...install.install, contentAvailable: false } }, form).disabled, true);
  assert.equal(primaryButton({ ...install, install: { ...install.install, freeBytes: 10 } }, form).disabled, true);
  const task = { kind: "download" as const, paused: false, totalBytes: 10, doneBytes: 1, filesTotal: 1, filesDone: 0, bytesPerSecond: 1, etaSeconds: 9, currentFile: null };
  assert.equal(primaryButton(snap({ phase: "installing", task }), form).action, "pause");
  assert.equal(primaryButton(snap({ phase: "installing", task: { ...task, paused: true } }), form).action, "resume");
  assert.equal(primaryButton(snap({ phase: "update" }), form).labelKey, "btn_update");
  assert.deepEqual(primaryButton(snap({ phase: "ready" }), form), { labelKey: "btn_play", action: "play", disabled: false });
  assert.deepEqual(primaryButton(snap({ phase: "running" }), form), { labelKey: "btn_running", action: "none", disabled: true });
  assert.deepEqual(["join", "register", "install", "ready"].map((p) => stepIndex(p as Snapshot["phase"])), [0, 1, 2, 3]);
});

test("the compiled-in game manifest is the verified 1.4.4 list", () => {
  const file = path.join(ROOT, "..", "UndauntedContent", "data", "dauntless-1.4.4.json");
  const bytes = readFileSync(file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "05cf8c6aa58f98c4f4ef078a6d6229d2c40becd6d99c78fedb4eb5eeba6f8938");
  const r = validateManifest(JSON.parse(bytes.toString("utf8")));
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.equal(r.manifest.files.length, 410);
  assert.equal(r.manifest.totalBytes, 10_893_512_875);
  assert.match(manifestFingerprint(r.manifest), /^[0-9a-f]{64}$/);
});

test("Spanish uses a decimal comma and Spanish month names", () => {
  assert.equal(formatBytes(1_500_000, "es"), "1,50 MB");
  assert.equal(formatBytes(1_500_000, "en"), "1.50 MB");
  assert.equal(formatDate("2026-10-09T12:00:00Z", "es"), "9 oct 2026");
});
