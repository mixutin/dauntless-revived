// Types shared by the main process, the preload bridge and the renderer.
// The main process owns all state; the renderer only draws a Snapshot and sends intents.

import type { ServerStatus } from "./status";
import type { ServerMode } from "./invite";

export type { ServerMode };

export type Language = "en" | "fi" | "es";
export const LANGUAGES: readonly Language[] = ["en", "fi", "es"];

// -1 = leave graphics to the in-game menu, 0..4 = Low, Medium, High, Epic, Cinematic.
export type GraphicsPreset = -1 | 0 | 1 | 2 | 3 | 4;
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = [-1, 0, 1, 2, 3, 4];
export const DEFAULT_GRAPHICS: GraphicsPreset = 4;

// Keep the game's scene-specific exposure by default. Basic remains adaptive
// and is an opt-in experiment for the blown-out pre-hunt airship.
export type ExposureMode = "game" | "basic";
export const EXPOSURE_MODES: readonly ExposureMode[] = ["game", "basic"];

// The game's own text language, sent to it as -epiclocale. The 1.4.4 client ships text for exactly
// these cultures (Archon/Content/Localization/Game/<culture>); "auto" follows the operating system.
export type GameLanguage = "auto" | "en-US" | "de-DE" | "es-ES" | "fr-FR" | "it-IT" | "ja-JP" | "pt-BR" | "ru-RU";
export const GAME_LANGUAGES: readonly GameLanguage[] = ["auto", "en-US", "de-DE", "es-ES", "fr-FR", "it-IT", "ja-JP", "pt-BR", "ru-RU"];

export type Phase =
  | "loading"
  | "join" // no server yet: paste an invite
  | "connect" // server known, not reachable (or still checking)
  | "register" // server reachable, no account key yet
  | "install" // account ready, game not installed
  | "installing" // download / verify / repair running (or paused)
  | "update" // game present but files are missing, damaged or the DLLs need refreshing
  | "ready" // PLAY
  | "running"; // the game is running

export type ConnectProblem =
  | "tailscale_missing" // private mode only
  | "unreachable" // no answer within 5 s
  | "bad_answer" // something answered but it is not a Dauntless Revived server
  | "cert_mismatch" // public mode: the certificate is not the one from the invite
  | null;

export type ErrorCode =
  | "account_banned"
  | "invite_invalid_format"
  | "invite_invalid"
  | "username_invalid"
  | "username_taken"
  | "registration_closed"
  | "bad_request"
  | "server_unreachable"
  | "server_error"
  | "key_invalid"
  | "key_rejected"
  | "key_storage_unavailable"
  | "no_content_server"
  | "manifest_mismatch"
  | "manifest_unavailable"
  | "disk_space"
  | "folder_invalid"
  | "game_folder_not_found" // "I already have the game files": no 1.4.4 game in the layouts looked at
  | "folder_not_empty"
  | "download_failed"
  | "file_missing_on_server"
  | "file_different_on_server"
  | "verify_failed"
  | "dll_failed"
  | "game_files_invalid"
  | "already_running"
  | "launch_failed"
  | "windows_runtime_missing"

  | "compat_runtime_missing"
  | "config_failed"
  | "busy"
  | "cancelled"
  | "cert_mismatch"
  | "cert_changed" // a public invite whose certificate differs from the one this PC's key belongs to
  | "rate_limited"
  | "relay_port_busy"
  | "relay_failed"
  | "unknown";

// Short messages that are not errors.
export type NoticeCode = "keep_open" | "backup_saved" | "repair_done" | "install_done";

export interface LauncherError {
  code: ErrorCode;
  // Extra detail for the message, e.g. a file path or a byte count. Never a key.
  detail?: string;
}

export type ActionResult = { ok: true } | { ok: false; error: LauncherError };

// Asked before joining from an invite. certificateChanged: this PC has a key for the invite's
// host:port that belongs to another certificate (previousFingerprint, null if not recorded).
export type InviteCheck =
  | { ok: true; certificateChanged: boolean; previousFingerprint: string | null }
  | { ok: false; error: LauncherError };

export type TaskKind = "download" | "verify" | "repair" | "dlls";

export interface TaskProgress {
  kind: TaskKind;
  paused: boolean;
  totalBytes: number;
  doneBytes: number;
  filesTotal: number;
  filesDone: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  currentFile: string | null;
}

export interface ServerInfo {
  mode: ServerMode;
  host: string;
  port: number;
  name: string;
  hasShare: boolean;
  hasPendingInvite: boolean; // an invite code is stored and not used yet
  loopback: boolean;
  fingerprint: string | null; // public mode: the pinned certificate fingerprint (not secret)
}

// A server joined before, for switching back to it without the invite.
export interface SavedServerInfo {
  id: string; // the account key slot id (not secret)
  mode: ServerMode;
  host: string;
  port: number;
  name: string;
  current: boolean;
  username: string | null;
}

export interface Settings {
  huntRegion?: 'auto' | 'main' | 'aus' | 'ger';
  graphics: GraphicsPreset;
  exposure: ExposureMode;
  windowed: boolean;
  language: Language;
  gameLanguage: GameLanguage;
  showConsole: boolean; // the DLL's log window, normally hidden (DR_SHOW_CONSOLE=1)
  streamerMode?: boolean; // hide addresses, fingerprints, paths and player names on screen
}

export interface Snapshot {
  phase: Phase;
  busy: boolean;
  server: ServerInfo | null;
  savedServers: SavedServerInfo[];
  connect: {
    checking: boolean;
    problem: ConnectProblem;
    tailscaleInstalled: boolean;
    lastCheckedAt: string | null;
  };
  account: {
    username: string | null;
    hasKey: boolean;
    offerBackup: boolean;
  };
  install: {
    dir: string;
    defaultDir: string;
    installed: boolean; // every file present with the right size, and the DLLs in place
    missingFiles: number;
    verified: boolean; // this folder's files were fully checked or downloaded by the launcher
    dllsOk: boolean;
    freeBytes: number | null;
    requiredBytes: number;
    totalBytes: number;
    vcRuntimeMissing: string[];
    directXMissing?: string[];

    contentAvailable: boolean;
  };
  task: TaskProgress | null;
  game: { running: boolean; relayPort: number | null };
  settings: Settings;
  app: { version: string; packaged: boolean; updateReady: boolean };
  status: ServerStatus | null;
  statusUnsupported: boolean; // the host answers but has no ServerStatus endpoint yet
  lastError: LauncherError | null;
  notice: NoticeCode | null;
}

export interface NewsItem {
  date: string | null;
  title: string;
  body: string;
}

export interface Branding {
  backgrounds: { url: string; credit: string | null }[]; // app-internal dr-art:// URLs
  accent: string | null;
}

// The links the page can ask the main process to open. The page names one of these; it never passes
// a URL. The main process maps each to its URL (src/main/links.ts).
export type ExternalTarget =
  | "tailscale_download"
  | "tailscale_share"
  | "vc_redist"
  | "directx_runtime"

  | "server_source"
  | "project_source"
  | "project_license"
  | "project_contributors"
  | "upstream_source"
  | "upstream_contributors"
  | "eugamehost"
  | "eugamehost_game1"
  | "eugamehost_game2"
  | "eugamehost_game3"
  | "eugamehost_game5"
  | "eugamehost_5800x"
  | "discord"
  | "patreon";

export type RegisterOutcome =
  | { ok: true; username: string }
  | { ok: false; error: LauncherError };

// Channel names (renderer -> main are invoke channels, main -> renderer are events).
export const IPC = {
  getSnapshot: "dr:get-snapshot",
  checkInvite: "dr:check-invite",
  submitInvite: "dr:submit-invite",
  retryConnect: "dr:retry-connect",
  forgetServer: "dr:forget-server",
  switchServer: "dr:switch-server",
  removeSavedServer: "dr:remove-saved-server",
  register: "dr:register",
  useExistingKey: "dr:use-existing-key",
  importKeyFile: "dr:import-key-file",
  saveKeyBackup: "dr:save-key-backup",
  dismissBackupOffer: "dr:dismiss-backup-offer",
  chooseInstallDir: "dr:choose-install-dir",
  useExistingGameFolder: "dr:use-existing-game-folder",
  useExistingGamePath: "dr:use-existing-game-path",
  startInstall: "dr:start-install",
  pauseTask: "dr:pause-task",
  resumeTask: "dr:resume-task",
  cancelTask: "dr:cancel-task",
  repair: "dr:repair",
  play: "dr:play",
  setSettings: "dr:set-settings",
  setStatusPolling: "dr:set-status-polling",
  refreshStatus: "dr:refresh-status",
  getNews: "dr:get-news",
  getBranding: "dr:get-branding",
  openExternal: "dr:open-external",
  openGameFolder: "dr:open-game-folder",
  logout: "dr:logout",
  installUpdate: "dr:install-update",
  windowMinimize: "dr:window-minimize",
  windowMaximize: "dr:window-maximize",
  windowClose: "dr:window-close",
  takeInviteLink: "dr:take-invite-link",
  dismissNotice: "dr:dismiss-notice",
  dismissError: "dr:dismiss-error",
  // events
  inviteLink: "dr:invite-link",
  snapshot: "dr:snapshot",
  progress: "dr:progress",
  windowState: "dr:window-state",
} as const;
