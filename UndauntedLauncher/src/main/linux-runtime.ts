import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LaunchRuntime } from "./launch";
import { linuxDependencyInstallPlan, runLinuxDependencyInstall } from "./linux-dependencies";
import { describeError, log } from "./log";

export type LinuxRuntimeKind = "proton" | "wine";

export interface DetectedLinuxRuntime {
  kind: LinuxRuntimeKind;
  name: string;
  command: string;
  prefixDir: string;
  compatDataDir: string | null;
  env: NodeJS.ProcessEnv;
}

export interface PreparedLinuxGameLaunch {
  runtime: LaunchRuntime;
  configDir: string;
  runtimeName: string;
}

export class LinuxRuntimeMissingError extends Error {
  constructor() {
    super("No compatible Proton or Wine runtime was found");
    this.name = "LinuxRuntimeMissingError";
  }
}

function executable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function fromPath(name: string, env: NodeJS.ProcessEnv): string | null {
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\")) return executable(name) ? path.resolve(name) : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    if (executable(file)) return file;
  }
  return null;
}

function customRuntime(value: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!value) return null;
  const expanded = value.startsWith("~/") ? path.join(env.HOME ?? os.homedir(), value.slice(2)) : value;
  return fromPath(expanded, env);
}

function directories(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

function protonCandidates(home: string): string[] {
  const steamRoots = [
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".steam", "root"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];
  const out: string[] = [];
  for (const root of steamRoots) {
    for (const dir of directories(path.join(root, "compatibilitytools.d"))) out.push(path.join(dir, "proton"));
    for (const dir of directories(path.join(root, "steamapps", "common"))) {
      if (/^(?:proton|ge-proton)/i.test(path.basename(dir))) out.push(path.join(dir, "proton"));
    }
  }
  return out.filter(executable).sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
}

function lutrisWineCandidates(home: string): string[] {
  const root = path.join(home, ".local", "share", "lutris", "runners", "wine");
  const out: string[] = [];
  for (const dir of directories(root)) {
    for (const name of ["wine64", "wine"]) {
      const candidate = path.join(dir, "bin", name);
      if (executable(candidate)) out.push(candidate);
    }
  }
  return out.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
}

function steamRootFor(proton: string): string | null {
  let current = path.dirname(proton);
  for (let i = 0; i < 8; i++) {
    if (path.basename(current) === "compatibilitytools.d") return path.dirname(current);
    if (path.basename(current) === "common" && path.basename(path.dirname(current)) === "steamapps") {
      return path.dirname(path.dirname(current));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function dllOverrides(existing: string | undefined): string {
  const parts = (existing ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^dxgi=/i.test(part));
  parts.push("dxgi=n,b");
  return parts.join(";");
}

function withXwaylandAuthority(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.XAUTHORITY || env.XDG_SESSION_TYPE?.toLowerCase() !== "wayland" || !env.XDG_RUNTIME_DIR) return env;

  try {
    const candidates = readdirSync(env.XDG_RUNTIME_DIR)
      .filter((name) => name.startsWith(".mutter-Xwaylandauth."))
      .map((name) => path.join(env.XDG_RUNTIME_DIR!, name))
      .filter((file) => statSync(file).isFile())
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    if (candidates[0]) return { ...env, XAUTHORITY: candidates[0] };
  } catch {
    // Keep the original environment; Wine will report the display error if XWayland is unavailable.
  }

  return env;
}

export function detectLinuxRuntime(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME ?? os.homedir(),
): DetectedLinuxRuntime | null {
  const runtimeEnv = withXwaylandAuthority(env);
  const explicitProton = customRuntime(runtimeEnv.DAUNTLESS_REVIVED_PROTON, runtimeEnv);
  const explicitWine = customRuntime(runtimeEnv.DAUNTLESS_REVIVED_WINE, runtimeEnv);
  const proton = explicitProton ?? (explicitWine ? null : protonCandidates(home)[0] ?? null);
  if (proton) {
    const compatDataDir = path.join(userDataDir, "compat", "proton");
    const steamRoot = steamRootFor(proton);
    return {
      kind: "proton",
      name: `Proton (${path.basename(path.dirname(proton))})`,
      command: proton,
      prefixDir: path.join(compatDataDir, "pfx"),
      compatDataDir,
      env: {
        ...runtimeEnv,
        STEAM_COMPAT_DATA_PATH: compatDataDir,
        ...(steamRoot ? { STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot } : {}),
        STEAM_COMPAT_APP_ID: "0",
        PROTON_LOG: "0",
        WINEDLLOVERRIDES: dllOverrides(runtimeEnv.WINEDLLOVERRIDES),
      },
    };
  }

  const wine =
    explicitWine ??
    fromPath("wine64", runtimeEnv) ??
    fromPath("wine", runtimeEnv) ??
    lutrisWineCandidates(home)[0] ??
    null;
  if (!wine) return null;
  const prefixDir = path.join(userDataDir, "compat", "wine");
  return {
    kind: "wine",
    name: `Wine (${path.basename(path.dirname(wine)) || "system"})`,
    command: wine,
    prefixDir,
    compatDataDir: null,
    env: {
      ...runtimeEnv,
      WINEPREFIX: prefixDir,
      WINEDEBUG: runtimeEnv.WINEDEBUG ?? "-all",
      WINEDLLOVERRIDES: dllOverrides(runtimeEnv.WINEDLLOVERRIDES),
    },
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, cwd, timeout: 120_000, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function initialize(runtime: DetectedLinuxRuntime, home: string): Promise<void> {
  if (existsSync(path.join(runtime.prefixDir, "drive_c"))) return;
  if (runtime.kind === "proton") {
    if (runtime.compatDataDir) mkdirSync(runtime.compatDataDir, { recursive: true });
    await run(runtime.command, ["run", "cmd", "/c", "exit"], runtime.env, home);
    return;
  }
  const beside = path.join(path.dirname(runtime.command), "wineboot");
  const wineboot = executable(beside) ? beside : fromPath("wineboot", runtime.env);
  if (wineboot) await run(wineboot, ["-u"], runtime.env, home);
  else await run(runtime.command, ["wineboot", "-u"], runtime.env, home);
}

function wineUser(runtime: DetectedLinuxRuntime, env: NodeJS.ProcessEnv): string {
  if (runtime.kind === "proton") return "steamuser";
  const raw = env.USER ?? env.LOGNAME ?? "wineuser";
  return raw.replace(/[\\/:*?"<>|]/g, "_").slice(0, 64) || "wineuser";
}

export interface PrepareLinuxGameLaunchOptions {
  autoInstallRuntime?: boolean;
  softwareMedia?: boolean;
}

export async function prepareLinuxGameLaunch(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME ?? os.homedir(),
  options: PrepareLinuxGameLaunchOptions = {},
): Promise<PreparedLinuxGameLaunch> {
  let detected = detectLinuxRuntime(userDataDir, env, home);
  if (!detected && options.autoInstallRuntime && env.DAUNTLESS_REVIVED_AUTO_INSTALL !== "0") {
    const plan = linuxDependencyInstallPlan("runtime", env);
    if (plan) {
      log.info(`no Proton/Wine runtime found; installing Wine with ${plan.name}`);
      try {
        await runLinuxDependencyInstall(plan, env, home);
        log.info("Wine dependency install finished; detecting runtime again");
      } catch (e) {
        log.warn(`automatic Wine install failed: ${describeError(e)}`);
      }
      detected = detectLinuxRuntime(userDataDir, env, home);
    }
  }
  if (!detected) throw new LinuxRuntimeMissingError();
  await initialize(detected, home);
  const user = wineUser(detected, env);
  const configDir = path.join(detected.prefixDir, "drive_c", "users", user, "AppData", "Local", "Archon", "Saved", "Config", "WindowsClient");
  return {
    runtime: {
      command: detected.command,
      argsPrefix: detected.kind === "proton" ? ["run"] : [],
      env: options.softwareMedia ? { ...detected.env, WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER: "1" } : detected.env,
    },
    configDir,
    runtimeName: detected.name,
  };
}
