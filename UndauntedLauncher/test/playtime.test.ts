// Playtime: the launcher keeps sessions and the offline save's hours in userData/playtime.json, a bad
// file starts from zero, and the hour badges unlock at their milestones in every language.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlaytimeStore } from "../src/main/playtime";
import { BADGE_HOURS, badgeProgress } from "../src/shared/badges";
import { formatPlaytime } from "../src/shared/format";
import { STRINGS, type StringKey } from "../src/shared/i18n";
import { LANGUAGES } from "../src/shared/types";

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "playtime-")), "playtime.json");
}

test("sessions and the offline save's hours are kept", async () => {
  const file = tmpFile();
  let now = 1_000_000;
  const store = new PlaytimeStore(file, () => now);
  store.start(true);
  assert.equal(store.view().sessionOffline, true);
  now += 90 * 60_000;
  await store.stop();
  await store.setOfflineSeconds(7200);
  store.start(false);
  assert.equal(store.view().sessionOffline, false);
  now += 30 * 60_000;
  await store.stop();
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.offlineSeconds, 7200);
  assert.equal(saved.sessions, 2);
  assert.equal(saved.lastSessionSeconds, 30 * 60);
  const again = new PlaytimeStore(file, () => now).view();
  assert.equal(again.offlineSeconds, 7200);
  assert.equal(again.onlineSeconds, null);
  assert.equal(again.sessionStartedAt, null);
});

test("a broken file starts from zero", () => {
  const file = tmpFile();
  writeFileSync(file, "{not json");
  assert.equal(new PlaytimeStore(file).view().offlineSeconds, 0);
  writeFileSync(file, JSON.stringify({ offlineSeconds: -5, sessions: "x", lastPlayedAt: "never" }));
  const v = new PlaytimeStore(file).view();
  assert.equal(v.offlineSeconds, 0);
  assert.equal(v.sessions, 0);
  assert.equal(v.lastPlayedAt, null);
});

test("a clock set back never makes a negative session", async () => {
  const file = tmpFile();
  let now = 5_000_000;
  const store = new PlaytimeStore(file, () => now);
  store.start(false);
  now -= 3_600_000;
  await store.stop();
  assert.equal(store.view().lastSessionSeconds, 0);
});

test("badges unlock at their hours", () => {
  assert.deepEqual(badgeProgress(0).unlocked, []);
  assert.equal(badgeProgress(0).next, 1);
  assert.deepEqual(badgeProgress(3600).unlocked, [1]);
  const mid = badgeProgress(30 * 3600);
  assert.deepEqual(mid.unlocked, [1, 10, 25]);
  assert.equal(mid.next, 50);
  assert.equal(mid.secondsToNext, 20 * 3600);
  assert.equal(mid.fraction, 0.2);
  const all = badgeProgress(1000 * 3600);
  assert.equal(all.next, null);
  assert.equal(all.unlocked.length, BADGE_HOURS.length);
});

test("playtime text is hours and minutes", () => {
  assert.equal(formatPlaytime(0), "0 min");
  assert.equal(formatPlaytime(2700), "45 min");
  assert.equal(formatPlaytime(547380), "152 h 3 min");
  assert.equal(formatPlaytime(3660, "fi"), "1 t 1 min");
});

test("every badge has a name in every language", () => {
  for (const lang of LANGUAGES) {
    for (const h of BADGE_HOURS) {
      const key = `badge_${h}` as StringKey;
      assert.ok((STRINGS[lang] as Record<string, string>)[key], `${lang} ${key}`);
    }
  }
});
