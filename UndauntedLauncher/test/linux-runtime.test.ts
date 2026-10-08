import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectLinuxRuntime, prepareLinuxGameLaunch } from "../src/main/linux-runtime";

function executable(file: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return file;
}

test("Linux runtime: explicit Wine overrides auto-detected Proton", () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-runtime-"));
  try {
    const wine = executable(path.join(home, "custom", "wine64"));
    executable(path.join(home, ".local", "share", "Steam", "compatibilitytools.d", "GE-Proton99", "proton"));
    const userData = path.join(home, "data");
    const runtime = detectLinuxRuntime(userData, { HOME: home, USER: "slayer", PATH: "", DAUNTLESS_REVIVED_WINE: wine }, home);
    assert.equal(runtime?.kind, "wine");
    assert.equal(runtime?.command, wine);
    assert.equal(runtime?.env.WINEPREFIX, path.join(userData, "compat", "wine"));
    assert.match(runtime?.env.WINEDLLOVERRIDES ?? "", /(?:^|;)dxgi=n,b(?:;|$)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Linux runtime: auto-detects Steam compatibility tools and prepares Proton environment", () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-proton-"));
  try {
    const proton = executable(path.join(home, ".local", "share", "Steam", "compatibilitytools.d", "GE-Proton10-1", "proton"));
    const userData = path.join(home, "data");
    const runtime = detectLinuxRuntime(userData, { HOME: home, USER: "slayer", PATH: "" }, home);
    assert.equal(runtime?.kind, "proton");
    assert.equal(runtime?.command, proton);
    assert.equal(runtime?.compatDataDir, path.join(userData, "compat", "proton"));
    assert.equal(runtime?.prefixDir, path.join(userData, "compat", "proton", "pfx"));
    assert.equal(runtime?.env.STEAM_COMPAT_DATA_PATH, path.join(userData, "compat", "proton"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Linux runtime: auto-detects Proton from Flatpak Steam", () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-flatpak-proton-"));
  try {
    const root = path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam");
    const proton = executable(path.join(root, "steamapps", "common", "Proton - Experimental", "proton"));
    const runtime = detectLinuxRuntime(path.join(home, "data"), { HOME: home, USER: "slayer", PATH: "" }, home);
    assert.equal(runtime?.kind, "proton");
    assert.equal(runtime?.command, proton);
    assert.equal(runtime?.env.STEAM_COMPAT_CLIENT_INSTALL_PATH, root);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Linux runtime: recovers GNOME XWayland authorization when XAUTHORITY is missing", () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-xauth-"));
  try {
    const proton = executable(path.join(home, ".local", "share", "Steam", "compatibilitytools.d", "GE-Proton10-1", "proton"));
    const runtimeDir = path.join(home, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    const authority = path.join(runtimeDir, ".mutter-Xwaylandauth.TEST");
    writeFileSync(authority, "cookie");

    const runtime = detectLinuxRuntime(
      path.join(home, "data"),
      { HOME: home, USER: "slayer", PATH: "", XDG_SESSION_TYPE: "wayland", XDG_RUNTIME_DIR: runtimeDir },
      home,
    );
    assert.equal(runtime?.command, proton);
    assert.equal(runtime?.env.XAUTHORITY, authority);

    const explicit = detectLinuxRuntime(
      path.join(home, "data2"),
      { HOME: home, USER: "slayer", PATH: "", XDG_SESSION_TYPE: "wayland", XDG_RUNTIME_DIR: runtimeDir, XAUTHORITY: "/explicit/xauth" },
      home,
    );
    assert.equal(explicit?.env.XAUTHORITY, "/explicit/xauth");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Linux runtime: creates the Proton compat-data directory before first initialization", { skip: process.platform !== "linux" }, async () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-proton-init-"));
  try {
    const proton = path.join(home, "custom", "proton");
    mkdirSync(path.dirname(proton), { recursive: true });
    writeFileSync(
      proton,
      "#!/bin/sh\n[ -d \"$STEAM_COMPAT_DATA_PATH\" ] || exit 42\n/bin/mkdir -p \"$STEAM_COMPAT_DATA_PATH/pfx/drive_c\"\n",
    );
    chmodSync(proton, 0o755);
    const userData = path.join(home, "data");
    const prepared = await prepareLinuxGameLaunch(
      userData,
      { HOME: home, USER: "slayer", PATH: "", DAUNTLESS_REVIVED_PROTON: proton },
      home,
      { autoInstallRuntime: false },
    );
    assert.equal(prepared.runtimeName, "Proton (custom)");
    assert.equal(prepared.configDir, path.join(userData, "compat", "proton", "pfx", "drive_c", "users", "steamuser", "AppData", "Local", "Archon", "Saved", "Config", "WindowsClient"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Linux cutscene mode uses Proton's documented software Media Foundation workaround", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "dr-linux-media-"));
  try {
    const proton = executable(path.join(home, ".local", "share", "Steam", "compatibilitytools.d", "GE-Proton11-7", "proton"));
    const userData = path.join(home, "data");
    mkdirSync(path.join(userData, "compat", "proton", "pfx", "drive_c"), { recursive: true });
    const env = { HOME: home, USER: "slayer", PATH: "", DAUNTLESS_REVIVED_PROTON: proton };
    const enabled = await prepareLinuxGameLaunch(userData, env, home, { softwareMedia: true });
    assert.equal(enabled.runtime.env.WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER, "1");
    const disabled = await prepareLinuxGameLaunch(userData, env, home, { softwareMedia: false });
    assert.equal(disabled.runtime.env.WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER, undefined);
    assert.equal(enabled.runtime.env.WINEDLLOVERRIDES, disabled.runtime.env.WINEDLLOVERRIDES);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
