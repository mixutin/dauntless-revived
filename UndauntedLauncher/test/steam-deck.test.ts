import { test } from "node:test";
import assert from "node:assert/strict";
import { isSteamDeck } from "../src/main/steam-deck";
import { defaultSettings, sanitizeSettings } from "../src/main/settings";
import { settingsPatch } from "../src/main/ipc-validate";

test("Steam Deck detection uses SteamOS variant or Valve hardware rather than gamescope alone", () => {
  const reader = (files: Record<string, string>) => (path: string) => files[path] ?? "";
  assert.equal(isSteamDeck({ XDG_CURRENT_DESKTOP: "gamescope" }, reader({})), false);
  assert.equal(isSteamDeck({}, reader({ "/etc/os-release": 'NAME="SteamOS"\nVARIANT_ID=steamdeck\n' })), true);
  assert.equal(isSteamDeck({}, reader({
    "/sys/class/dmi/id/sys_vendor": "Valve",
    "/sys/class/dmi/id/product_name": "Galileo",
  })), true);
  assert.equal(isSteamDeck({}, reader({
    "/sys/class/dmi/id/sys_vendor": "Valve",
    "/sys/class/dmi/id/product_name": "Jupiter",
  })), true);
  assert.equal(isSteamDeck({}, reader({
    "/sys/class/dmi/id/sys_vendor": "Fake Vendor",
    "/sys/class/dmi/id/product_name": "Jupiter",
  })), false);
  assert.equal(isSteamDeck({ DAUNTLESS_REVIVED_STEAM_DECK: "0" }, reader({ "/etc/os-release": "VARIANT_ID=steamdeck" })), false);
  assert.equal(isSteamDeck({ DAUNTLESS_REVIVED_STEAM_DECK: "1" }, reader({})), true);
});

test("Deck preset is automatic only for fresh Deck installs; saved graphics always win", () => {
  assert.equal(defaultSettings("en", "linux", true).graphics, "deck");
  assert.equal(defaultSettings("en", "linux", false).graphics, 4);
  assert.equal(defaultSettings("en", "win32", true).graphics, 4);
  assert.equal(sanitizeSettings({ graphics: 3 }, "en", "linux", true).graphics, 3);
  assert.equal(sanitizeSettings({ graphics: "deck" }, "en", "linux").graphics, "deck");
  assert.equal(sanitizeSettings({}, "en", "linux").mediaCompatibility, true);
  assert.equal(sanitizeSettings({}, "en", "win32").mediaCompatibility, false);
  assert.equal(sanitizeSettings({ mediaCompatibility: false }, "en", "linux").mediaCompatibility, false);
  assert.deepEqual(settingsPatch({ graphics: "deck", mediaCompatibility: false }), { graphics: "deck", mediaCompatibility: false });
  assert.equal(settingsPatch({ graphics: "steamdeck" }), null);
  assert.equal(settingsPatch({ mediaCompatibility: "true" }), null);
});
