// Starting the game (shared contract 6). The account key is passed as -AUTH_PASSWORD, the way the
// upstream launcher and friend-kit/play.ps1 do it; it is never logged (see maskArgs).

import { spawn, execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { isValidHost } from "../shared/invite";
import { isPlausibleAccountKey } from "../shared/username";
import { EXE_NAME } from "./constants";
import type { GameLanguage } from "../shared/types";

export interface LaunchSettings {
  host: string;
  port: number;
  key: string;
  windowed: boolean;
  gameLocale?: string; // -epiclocale; English when left out
}

export const FIXED_ARGS = [
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
  // The pinned 1.4.4 executable explicitly supports this client-mode switch.
  // Private-server launches do not use the original EAC bootstrapper.
  "-NoEAC",
];

// The -epiclocale for the Game language setting. "auto" takes the operating system's language when
// the game has text for it (es-419 -> es-ES, pt-PT -> pt-BR), and English otherwise.
export function gameLocale(setting: GameLanguage, systemLocale: string): string {
  if (setting !== "auto") return setting;
  const code = systemLocale.toLowerCase().slice(0, 2);
  return GAME_LOCALES.find((l) => l.toLowerCase().startsWith(`${code}-`)) ?? "en-US";
}

const GAME_LOCALES = ["en-US", "de-DE", "es-ES", "fr-FR", "it-IT", "ja-JP", "pt-BR", "ru-RU"];

export function buildLaunchArgs(s: LaunchSettings): string[] {
  if (!isValidHost(s.host)) throw new Error("invalid host");
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error("invalid port");
  if (!isPlausibleAccountKey(s.key)) throw new Error("invalid key");
  // The first argument is the server address; UndauntedInternalServer.dll reads it.
  const locale = s.gameLocale && GAME_LOCALES.includes(s.gameLocale) ? s.gameLocale : "en-US";
  const fixed = FIXED_ARGS.map((a) => (a.startsWith("-epiclocale=") ? `-epiclocale=${locale}` : a));
  const args = [`${s.host}:${s.port}`, `-AUTH_PASSWORD=${s.key}`, ...fixed];
  if (s.windowed) args.push("-windowed", "-ResX=1280", "-ResY=720");
  return args;
}

export function maskArgs(args: string[]): string[] {
  return args.map((a) => (/^-AUTH_PASSWORD=/i.test(a) ? "-AUTH_PASSWORD=<hidden>" : a));
}

export function describeLaunch(exe: string, args: string[]): string {
  return `${exe} ${maskArgs(args).join(" ")}`;
}

export type SpawnFn = typeof spawn;

export interface LaunchRuntime {
  command: string;
  argsPrefix: string[];
  env: NodeJS.ProcessEnv;
}

// Tracks the one game process this launcher started.
export class GameProcess {
  private child: ChildProcess | null = null;
  private listeners: ((running: boolean, code: number | null) => void)[] = [];

  constructor(private readonly spawnFn: SpawnFn = spawn) {}

  get running(): boolean {
    return this.child !== null;
  }

  onChange(fn: (running: boolean, code: number | null) => void): void {
    this.listeners.push(fn);
  }

  // extraEnv: added to the game's environment (DR_SHOW_CONSOLE=1 keeps the DLL's log window visible).
  start(win64Dir: string, args: string[], runtime?: LaunchRuntime, extraEnv?: Record<string, string>): Promise<void> {
    if (this.child) return Promise.reject(new Error("already running"));
    const exe = path.join(win64Dir, EXE_NAME);
    const command = runtime?.command ?? exe;
    const launchArgs = runtime ? [...runtime.argsPrefix, exe, ...args] : args;
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(command, launchArgs, {
        cwd: win64Dir,
        stdio: "ignore",
        windowsHide: false,
        detached: false,
        env: extraEnv ? { ...(runtime?.env ?? process.env), ...extraEnv } : runtime?.env ?? process.env,
      });
      let started = false;
      child.once("spawn", () => {
        started = true;
        this.child = child;
        this.listeners.forEach((l) => l(true, null));
        resolve();
      });
      child.once("error", (e) => {
        if (!started) reject(e);
      });
      child.once("exit", (code) => {
        if (this.child === child) this.child = null;
        if (started) this.listeners.forEach((l) => l(false, code));
      });
    });
  }
}

// Lists running Dauntless clients. Game servers (the same exe started with -server, as on the
// host's own PC) do not count. Only process ids and a yes/no are read back: other processes'
// command lines contain their keys and never leave PowerShell.
export function findRunningClients(platform: NodeJS.Platform = process.platform): Promise<number[]> {
  if (platform === "linux") {
    return new Promise((resolve) => {
      execFile("pgrep", ["-f", EXE_NAME], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^\d+$/.test(line))
            .map(Number),
        );
      });
    });
  }
  if (platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${EXE_NAME}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err || !stdout.toLowerCase().includes(EXE_NAME.toLowerCase())) return resolve([]);
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='${EXE_NAME}'" | ForEach-Object { ` +
        `if ($_.CommandLine -notmatch '(^|\\s)-server(\\s|$)') { $_.ProcessId } }`;
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true, timeout: 15000 },
        (err2, out2) => {
          if (err2) return resolve([]);
          resolve(
            out2
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => /^\d+$/.test(l))
              .map(Number),
          );
        },
      );
    });
  });
}
