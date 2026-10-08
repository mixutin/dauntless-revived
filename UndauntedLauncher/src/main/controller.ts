// The launcher's state machine. It owns every piece of state; the renderer draws Snapshots and
// sends intents. Nothing in here imports Electron: main.ts passes the platform pieces in, which
// keeps this testable with plain Node.
//
// Two server modes exist (see shared/invite.ts):
//  - private (invite v1): the host's PC over Tailscale, plain HTTP to host:61000.
//  - public (invite v2): a server on a public IP. Everything goes over TLS to its gateway, pinned
//    to the invite's certificate fingerprint. While the game runs, a local relay on
//    127.0.0.1:61000 carries the game's own traffic to the gateway (relay.ts).

import { createHash } from "node:crypto";
import { promises as fsp, existsSync } from "node:fs";
import path from "node:path";
import { missingDirectX, gameExitDetail } from './windows-runtime';

import { parseInvite, isLoopbackHost, type Invite } from "../shared/invite";
import { checkUsername, extractAccountKey } from "../shared/username";
import { limitedView, type ServerStatus } from "../shared/status";
import { saveHuntRegion } from './hostapi';
import type {
  ActionResult,
  Branding,
  ConnectProblem,
  ErrorCode,
  ExposureMode,
  ExternalTarget,
  GraphicsPreset,
  InviteCheck,
  Language,
  LauncherError,
  NewsItem,
  NoticeCode,
  Phase,
  RegisterOutcome,
  Settings,
  Snapshot,
  TaskProgress,
} from "../shared/types";
import { EXPOSURE_MODES, GRAPHICS_PRESETS } from "../shared/types";
import type { Endpoint } from "./http";
import {
  fetchBrandingImage,
  fetchBrandingIndex,
  fetchContentManifest,
  fetchNews,
  fetchServerStatus,
  fetchUserInfo,
  probeContent,
  registerAccount,
  type StatusResult,
} from "./hostapi";
import { compareManifests, resolveInside, type GameManifest, type ManifestFile } from "./manifest";
import { contentDownloadBase, DownloadError, DownloadJob } from "./downloader";
import { AbortedError, hashFile, removePartFiles, verifyInstall, VerifiedCache } from "./verify";
import { dllStatus, installPinnedDlls, DllError, win64Dir } from "./dlls";
import { installClientMods } from "./client-mods";
import { applyGameConfig } from "./engineini";
import { locateExistingGame } from "./game-folder";
import { buildLaunchArgs, describeLaunch, GameProcess, type LaunchRuntime, type SpawnFn } from "./launch";
import { backupFileText, KeyStore, KeyStoreError, serverId, type Encryptor, type KeySlot } from "./keystore";
import { SettingsStore, type StoredServer, type StoredSettings } from "./settings";
import { freeBytes, missingVcRuntime } from "./system";
import { fixedLinkUrl, isAllowedExternalUrl } from "./links";
import { describeError, log } from "./log";
import { DEFAULT_RELAY_PORT, Relay, RelayError } from "./relay";
import {
  DISK_MARGIN_BYTES,
  EXE_NAME,
  EXE_RELATIVE_PATH,
  PINNED_EXE_SHA256,
  PROJECT_URL,
  STATUS_POLL_MS,
  XMPP_PORT,
} from "./constants";

export interface Platform {
  userDataDir: string;
  resourcesDir: string;
  runtimeFilesExist?: (file: string) => boolean;

  defaultInstallDir: string;
  hostPlatform?: NodeJS.Platform;
  appVersion: string;
  packaged: boolean;
  defaultLanguage: Language;
  steamDeck?: boolean;
  encryptor: Encryptor;
  manifest: GameManifest | null;
  gameConfigDir?: string;
  // Public mode: where the local relay listens. The game server tells every client to use
  // 127.0.0.1:61000, so only tests and rehearsals change it.
  relayPort?: number;
  // The file checked by hash before every launch (tests use a fake game).
  exePin?: { relativePath: string; sha256: string };
  chooseFolder(title: string, defaultPath: string): Promise<string | null>;
  chooseSaveFile(defaultName: string): Promise<string | null>;
  chooseOpenFile(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(dir: string): Promise<void>;
  emitSnapshot(s: Snapshot): void;
  emitProgress(p: TaskProgress): void;
  findTailscale(): string | null;
  findRunningClients(): Promise<number[]>;
  prepareGameLaunch?(options: { softwareMedia: boolean }): Promise<{ runtime: LaunchRuntime; configDir: string; runtimeName: string } | null>;
  spawn?: SpawnFn;
  installUpdate?(): void;
}

interface InstallInfo {
  present: number;
  missing: ManifestFile[];
  partFiles: number;
  dllsOk: boolean;
}

const err = (code: ErrorCode, detail?: string): { ok: false; error: LauncherError } => ({ ok: false, error: detail ? { code, detail } : { code } });
const OK: ActionResult = { ok: true };

export function endpointFor(sv: StoredServer): Endpoint {
  return { host: sv.host, port: sv.port, pin: sv.mode === "public" ? sv.fp : null };
}

export class Controller {
  private readonly settings: SettingsStore;
  private readonly keys: KeyStore;
  private readonly game: GameProcess;
  private readonly verified: VerifiedCache;

  private reachable: boolean | null = null;
  private checking = false;
  private connectProblem: ConnectProblem = null;
  private tailscaleInstalled = false;
  private lastCheckedAt: string | null = null;
  private failedPolls = 0;
  private status: ServerStatus | null = null;
  private statusUnsupported = false;
  private contentProbe: boolean | null = null;
  private hasKey = false;
  private keyRejected = false;
  // Bumped when a ServerStatus answer already on its way may no longer be shown: logout, a new key,
  // a forgotten or different server. See fetchStatus().
  private statusGen = 0;
  private busy = false;
  private install: InstallInfo = { present: 0, missing: [], partFiles: 0, dllsOk: false };
  private freeSpace: number | null = null;
  private task: TaskProgress | null = null;
  private taskAbort: AbortController | null = null;
  private job: DownloadJob | null = null;
  private lastError: LauncherError | null = null;
  private notice: NoticeCode | null = null;
  private updateReady = false;
  private polling = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private news: NewsItem[] | null = null;
  private newsCheckedAt = -Infinity;
  private newsLoading = false;
  private branding: Branding | null = null;
  private art = new Map<string, { file: string; type: string }>();
  private relay: Relay | null = null;
  private phase: Phase = "loading";

  constructor(private readonly p: Platform) {
    this.settings = new SettingsStore(p.userDataDir, p.defaultLanguage, p.hostPlatform ?? process.platform, p.steamDeck ?? false);
    this.keys = new KeyStore(path.join(p.userDataDir, "keys"), p.encryptor);
    this.game = new GameProcess(p.spawn);
    this.verified = new VerifiedCache(path.join(p.userDataDir, "verified-files.json"));
    this.game.onChange((running, code) => {
      log.info(running ? "game started" : `game exited (code ${code ?? "none"})`);
      if (!running) {
        if (code !== null && code !== 0) this.lastError = {code:'launch_failed',detail:gameExitDetail(code)};

        void this.stopRelay().then(() => this.publish());
        return;
      }
      this.publish();
    });
  }

  // ------------------------------------------------------------------ basics

  private get s(): StoredSettings {
    return this.settings.get();
  }

  get installDir(): string {
    return this.s.installDir ?? this.p.defaultInstallDir;
  }

  private get hostPlatform(): NodeJS.Platform {
    return this.p.hostPlatform ?? process.platform;
  }

  // True while the game runs through the local relay: closing the launcher would cut the game off.
  get relayActive(): boolean {
    return this.relay !== null && this.relay.running;
  }

  get gameRunning(): boolean {
    return this.game.running;
  }

  private endpoint(): Endpoint | null {
    const sv = this.s.server;
    return sv ? endpointFor(sv) : null;
  }

  // Private mode: the content server's own port on the host. Public mode: the gateway itself,
  // which serves /content/* from the content server behind it.
  private contentEndpoint(): Endpoint | null {
    const sv = this.s.server;
    if (!sv) return null;
    if (sv.mode === "public") return this.contentProbe === true ? endpointFor(sv) : null;
    if (!this.status || this.status.contentPort === null) return null;
    return { host: sv.host, port: this.status.contentPort, pin: null };
  }

  private slot(): KeySlot | null {
    const sv = this.s.server;
    return sv ? { host: sv.host, port: sv.port, mode: sv.mode, fp: sv.fp } : null;
  }

  private sid(): string | null {
    const sv = this.s.server;
    return sv ? serverId(sv.host, sv.port, sv.mode) : null;
  }

  async init(): Promise<void> {
    await this.refreshKeyFlag();
    await this.inspectInstall();
    this.publish();
    if (this.s.server) void this.connect();
  }

  private computePhase(): Phase {
    if (!this.s.server) return "join";
    if (this.task) return "installing";
    if (this.game.running) return "running";
    if (this.reachable !== true) return "connect";
    if (!this.hasKey || this.keyRejected) return "register";
    if (!this.p.manifest) return "install";
    if (this.install.present === 0 && this.install.partFiles === 0) return "install";
    if (this.install.missing.length > 0 || !this.install.dllsOk || this.s.verifiedDir !== this.installDir) return "update";
    return "ready";
  }

  snapshot(): Snapshot {
    this.phase = this.computePhase();
    const sv = this.s.server;
    const sid = this.sid();
    const manifest = this.p.manifest;
    const missingBytes = this.install.missing.reduce((a, f) => a + f.size, 0);
    return {
      phase: this.phase,
      busy: this.busy,
      server: sv
        ? {
            mode: sv.mode,
            host: sv.host,
            port: sv.port,
            name: sv.name,
            hasShare: sv.share !== null,
            hasPendingInvite: sv.code !== null,
            loopback: isLoopbackHost(sv.host),
            fingerprint: sv.fp,
          }
        : null,
      connect: { checking: this.checking, problem: this.connectProblem, tailscaleInstalled: this.tailscaleInstalled, lastCheckedAt: this.lastCheckedAt },
      account: {
        username: sid ? this.s.usernames[sid] ?? null : null,
        hasKey: this.hasKey && !this.keyRejected,
        offerBackup: sid !== null && this.hasKey && !this.keyRejected && this.s.backupOffered[sid] !== true,
      },
      install: {
        dir: this.installDir,
        defaultDir: this.p.defaultInstallDir,
        installed: this.phase === "ready" || this.phase === "running",
        missingFiles: this.install.missing.length,
        verified: this.s.verifiedDir === this.installDir,
        dllsOk: this.install.dllsOk,
        freeBytes: this.freeSpace,
        requiredBytes: missingBytes + DISK_MARGIN_BYTES,
        totalBytes: manifest?.totalBytes ?? 0,
        vcRuntimeMissing: missingVcRuntime(process.env, this.p.runtimeFilesExist ?? existsSync, this.hostPlatform),
        directXMissing: missingDirectX(process.env, this.p.runtimeFilesExist ?? existsSync, this.hostPlatform),

        contentAvailable: this.contentEndpoint() !== null,
      },
      task: this.task,
      game: { running: this.game.running, relayPort: this.relay?.port ?? null },
      settings: { graphics: this.s.graphics, exposure: this.s.exposure, windowed: this.s.windowed, mediaCompatibility: this.s.mediaCompatibility, language: this.s.language, ...(this.s.huntRegion ? {huntRegion:this.s.huntRegion} : {}) },
      app: { version: this.p.appVersion, packaged: this.p.packaged, updateReady: this.updateReady, platform: this.hostPlatform },
      status: this.status,
      statusUnsupported: this.statusUnsupported,
      lastError: this.lastError,
      notice: this.notice,
    };
  }

  private publish(): void {
    this.p.emitSnapshot(this.snapshot());
  }

  private fail(code: ErrorCode, detail?: string): { ok: false; error: LauncherError } {
    const e = err(code, detail);
    this.lastError = e.error;
    this.publish();
    return e;
  }

  private async withBusy<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.lastError = null;
    this.publish();
    try {
      return await fn();
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  setUpdateReady(): void {
    this.updateReady = true;
    this.publish();
  }

  installUpdate(): void {
    if (this.updateReady && !this.task && !this.game.running) this.p.installUpdate?.();
  }

  setNotice(code: NoticeCode | null): void {
    this.notice = code;
    this.publish();
  }

  dismissNotice(): void {
    this.setNotice(null);
  }

  dismissError(): void {
    this.lastError = null;
    this.publish();
  }

  // ------------------------------------------------------------------ join / connect

  // Public invites: is there a key for this host:port that belongs to another certificate? The
  // page asks before it offers to join, so that it can warn instead of offering a one-click join.
  async checkInvite(text: unknown): Promise<InviteCheck> {
    const parsed = parseInvite(text);
    if (!parsed.ok) return err("invite_invalid_format", parsed.error);
    const change = await this.certificateChange(parsed.invite);
    return { ok: true, certificateChanged: change !== null, previousFingerprint: change?.fp ?? null };
  }

  private async certificateChange(inv: Invite): Promise<{ fp: string | null } | null> {
    if (inv.mode !== "public") return null;
    const bound = await this.keys.certificateOf({ host: inv.host, port: inv.port, mode: "public", fp: inv.fp });
    return bound && bound.fp !== inv.fp ? bound : null;
  }

  // Joins the server from an invite. When a public invite carries another certificate than the
  // one this PC's key for that host:port belongs to, nothing is changed or sent (error
  // cert_changed, detail = the saved fingerprint) until the user confirms the new certificate.
  async submitInvite(text: unknown, opts: { acceptNewCertificate?: boolean } = {}): Promise<ActionResult> {
    if (this.busy || this.task) return err("busy");
    if (this.game.running) return this.fail("already_running");
    const parsed = parseInvite(text);
    if (!parsed.ok) return this.fail("invite_invalid_format", parsed.error);
    const inv = parsed.invite;
    const change = await this.certificateChange(inv);
    if (change) {
      if (opts.acceptNewCertificate !== true) {
        log.warn(`invite for ${inv.host}:${inv.port} has a new certificate; the stored key stays with the old one until the user confirms`);
        return err("cert_changed", change.fp ?? "");
      }
      await this.keys.rebind({ host: inv.host, port: inv.port, mode: "public", fp: change.fp }, inv.fp as string);
      log.warn(`the user accepted a new certificate for ${inv.host}:${inv.port} (was ${change.fp ?? "not recorded"}, now ${inv.fp})`);
    }
    const current = this.s.server;
    const same =
      current !== null && current.mode === inv.mode && current.host === inv.host && current.port === inv.port && current.fp === inv.fp;
    const hasKeyForIt = await this.keys.has({ host: inv.host, port: inv.port, mode: inv.mode, fp: inv.fp });
    await this.settings.update((s) => {
      s.server = {
        mode: inv.mode,
        host: inv.host,
        port: inv.port,
        name: inv.name,
        share: inv.share,
        fp: inv.fp,
        // A friend who already has an account on this server does not need the code again.
        code: hasKeyForIt ? null : inv.code,
      };
    });
    if (!same) this.resetServerState();
    log.info(`joined ${inv.mode} server ${inv.host}:${inv.port}`);
    await this.refreshKeyFlag();
    this.lastError = null;
    await this.connect();
    return OK;
  }

  private resetServerState(): void {
    this.reachable = null;
    this.status = null;
    this.statusUnsupported = false;
    this.contentProbe = null;
    this.connectProblem = null;
    this.news = null;
    this.branding = null;
    this.keyRejected = false;
    this.failedPolls = 0;
    this.statusGen++;
  }

  async forgetServer(): Promise<ActionResult> {
    if (this.task || this.game.running) return err("busy");
    await this.settings.update((s) => {
      s.server = null;
    });
    this.resetServerState();
    this.hasKey = false;
    this.publish();
    return OK;
  }

  async connect(): Promise<ActionResult> {
    const sv = this.s.server;
    const ep = this.endpoint();
    if (!sv || !ep) return err("server_unreachable");
    if (this.checking) return OK;
    this.checking = true;
    this.publish();
    try {
      this.tailscaleInstalled = sv.mode === "private" ? this.p.findTailscale() !== null : false;
      const { res, stale } = await this.fetchStatus(ep);
      this.lastCheckedAt = new Date().toISOString();
      if (res.kind === "ok" || res.kind === "unsupported") {
        this.reachable = true;
        this.connectProblem = null;
        this.failedPolls = 0;
        // Overtaken (logout, new key, other server): the server still answers, but never show a
        // list that was asked for with a key the launcher no longer has.
        this.status = res.kind === "ok" ? (stale ? limitedView(res.status) : res.status) : null;
        this.statusUnsupported = res.kind === "unsupported";
        if (res.kind === "ok" && !stale) await this.rememberServerName(res.status.name);
        if (sv.mode === "public") this.contentProbe = await probeContent(ep);
        await this.checkAccount();
        await this.inspectInstall();
        void this.loadExtras();
      } else {
        this.reachable = false;
        if (res.kind === "bad_answer") this.connectProblem = "bad_answer";
        else if (res.kind === "cert_mismatch") this.connectProblem = "cert_mismatch";
        else if (sv.mode === "private" && !this.tailscaleInstalled && !isLoopbackHost(ep.host)) this.connectProblem = "tailscale_missing";
        else this.connectProblem = "unreachable";
        if (this.connectProblem === "cert_mismatch") log.error(`server ${ep.host}:${ep.port} presented a certificate that does not match the invite`);
        else log.warn(`server ${ep.host}:${ep.port} not reachable (${this.connectProblem})`);
      }
      return OK;
    } finally {
      this.checking = false;
      this.publish();
    }
  }

  private async rememberServerName(name: string): Promise<void> {
    const sv = this.s.server;
    if (sv && sv.name !== name) {
      await this.settings.update((s) => {
        if (s.server) s.server.name = name;
      });
    }
  }

  private async refreshKeyFlag(): Promise<void> {
    const slot = this.slot();
    this.hasKey = slot ? await this.keys.has(slot) : false;
  }

  // The key sent with ServerStatus, so the server lists who is online (it shows the list to
  // registered players only). Only this server's own key, which in public mode is bound to the
  // invite's certificate and only ever goes over the connection pinned to it; none while the
  // server refuses the key. Read from the key store for each request, never kept in memory.
  private async statusKey(): Promise<string | null> {
    const slot = this.slot();
    if (!slot || !this.hasKey || this.keyRejected) return null;
    return this.keys.load(slot).catch(() => null);
  }

  // ServerStatus with statusKey(). "stale" when statusGen moved while it was on its way (the user
  // logged out, a new key was stored, the server was forgotten or changed): the answer was asked
  // for under the old state, so a full list in it must not be shown any more.
  private async fetchStatus(ep: Endpoint): Promise<{ res: StatusResult; stale: boolean }> {
    const gen = this.statusGen;
    const res = await fetchServerStatus(ep, { key: await this.statusKey() });
    return { res, stale: gen !== this.statusGen };
  }

  // Confirms the stored key with GetUserInfo and refreshes the username.
  private async checkAccount(): Promise<void> {
    const ep = this.endpoint();
    const slot = this.slot();
    const sid = this.sid();
    if (!ep || !slot || !sid) return;
    let key: string | null = null;
    try {
      key = await this.keys.load(slot);
    } catch {
      key = null;
    }
    this.hasKey = key !== null;
    if (!key) return;
    const info = await fetchUserInfo(ep, key);
    if (info.ok) {
      this.keyRejected = false;
      if (this.s.usernames[sid] !== info.info.username) {
        await this.settings.update((s) => {
          s.usernames[sid] = info.info.username;
        });
      }
    } else if (info.error === "key_rejected") {
      this.keyRejected = true;
      this.lastError = { code: "key_rejected" };
      log.warn("the server does not accept the stored key");
    }
  }

  // ------------------------------------------------------------------ status polling, news, art

  setStatusPolling(on: boolean): void {
    this.polling = on === true;
    if (this.polling && !this.pollTimer) {
      this.pollTimer = setInterval(() => void this.pollStatus(), STATUS_POLL_MS);
      void this.pollStatus();
    } else if (!this.polling && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollStatus(): Promise<void> {
    const ep = this.endpoint();
    if (!ep || this.checking) return;
    if (this.reachable !== true) {
      // Keep retrying quietly in the background while the guide is shown.
      if (this.connectProblem !== "cert_mismatch") await this.connect();
      return;
    }
    const { res, stale } = await this.fetchStatus(ep);
    // Overtaken: drop it; the next poll asks again under the new state.
    if (stale) return;
    if (res.kind === "ok") {
      this.status = res.status;
      this.statusUnsupported = false;
      this.failedPolls = 0;
      if (this.branding === null) void this.loadExtras();
      else void this.refreshNews();
    } else if (res.kind === "unsupported") {
      this.statusUnsupported = true;
      this.failedPolls = 0;
    } else if (res.kind === "cert_mismatch") {
      this.reachable = false;
      this.connectProblem = "cert_mismatch";
      if (this.status) this.status = { ...this.status, online: false };
      log.error("the server's certificate changed and no longer matches the invite");
    } else {
      this.failedPolls++;
      if (this.status) this.status = { ...this.status, online: false };
      // While the game runs, a busy moment on the server must not flip the launcher back to the
      // connect guide.
      if (this.failedPolls >= 2 && !this.game.running) {
        this.reachable = false;
        this.connectProblem = "unreachable";
      }
    }
    this.publish();
  }

  async refreshStatus(): Promise<void> {
    await this.pollStatus();
  }

  private async refreshNews(): Promise<void> {
    const ep = this.contentEndpoint();
    if (!ep || this.newsLoading || (this.news !== null && Date.now() - this.newsCheckedAt < 60000)) return;
    this.newsLoading = true;
    const generation = this.statusGen;
    this.newsCheckedAt = Date.now();
    try {
      const items = await fetchNews(ep, this.news ?? []);
      if (generation === this.statusGen) { this.news = items; this.publish(); }
    } finally { this.newsLoading = false; }
  }

  private async loadExtras(): Promise<void> {
    const ep = this.contentEndpoint();
    if (!ep) return;
    await this.refreshNews();
    if (this.branding === null) {
      const index = await fetchBrandingIndex(ep);
      const backgrounds: Branding["backgrounds"] = [];
      const cacheDir = path.join(this.p.userDataDir, "art-cache");
      await fsp.mkdir(cacheDir, { recursive: true });
      for (const b of index.backgrounds) {
        const img = await fetchBrandingImage(ep, b.path);
        if (!img) continue;
        const id = createHash("sha256").update(img.data).digest("hex");
        const file = path.join(cacheDir, id);
        await fsp.writeFile(file, img.data);
        this.art.set(id, { file, type: img.type });
        backgrounds.push({ url: `dr-art://bg/${id}`, credit: b.credit });
      }
      this.branding = { backgrounds, accent: index.accent };
    }
    this.publish();
  }

  getNews(): NewsItem[] {
    return this.news ?? [];
  }

  getBranding(): Branding {
    return this.branding ?? { backgrounds: [], accent: null };
  }

  // Used by the dr-art:// protocol handler: only ids this session downloaded are served.
  resolveArt(id: string): { file: string; type: string } | null {
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    return this.art.get(id) ?? null;
  }

  // ------------------------------------------------------------------ account

  async register(username: unknown): Promise<RegisterOutcome> {
    if (this.busy || this.task) return err("busy");
    const check = checkUsername(username);
    if (check !== "ok") return this.fail("username_invalid", check);
    const ep = this.endpoint();
    const sv = this.s.server;
    const slot = this.slot();
    const sid = this.sid();
    if (!ep || !sv || !slot || !sid) return err("server_unreachable");
    return this.withBusy(async () => {
      const res = await registerAccount(ep, username as string, sv.code ?? "");
      if (!res.ok) {
        log.warn(`registration refused: ${res.error}`);
        this.lastError = { code: res.error };
        return err(res.error);
      }
      try {
        await this.keys.save(slot, res.key);
      } catch (e) {
        log.error(`could not store the key: ${describeError(e)}`);
        this.lastError = { code: "key_storage_unavailable" };
        return err("key_storage_unavailable");
      }
      await this.settings.update((s) => {
        if (s.server) s.server.code = null;
        s.usernames[sid] = username as string;
        delete s.backupOffered[sid];
      });
      this.hasKey = true;
      this.keyRejected = false;
      this.statusGen++;
      log.info(`registered as ${username as string}`);
      await this.checkAccount();
      await this.inspectInstall();
      // Now a registered player: ask again, with the key, so the player list shows at once.
      await this.pollStatus();
      return { ok: true as const, username: username as string };
    });
  }

  async useExistingKey(text: unknown): Promise<ActionResult> {
    if (this.busy || this.task) return err("busy");
    const key = typeof text === "string" ? extractAccountKey(text) : null;
    if (!key) return this.fail("key_invalid");
    return this.withBusy(() => this.adoptKey(key));
  }

  async importKeyFile(): Promise<ActionResult> {
    if (this.busy || this.task) return err("busy");
    const file = await this.p.chooseOpenFile();
    if (!file) return err("cancelled");
    let text: string;
    try {
      const st = await fsp.stat(file);
      if (st.size > 8192) return this.fail("key_invalid");
      text = await fsp.readFile(file, "utf8");
    } catch {
      return this.fail("key_invalid");
    }
    const key = extractAccountKey(text);
    if (!key) return this.fail("key_invalid");
    return this.withBusy(() => this.adoptKey(key));
  }

  private async adoptKey(key: string): Promise<ActionResult> {
    const ep = this.endpoint();
    const slot = this.slot();
    const sid = this.sid();
    if (!ep || !slot || !sid) return err("server_unreachable");
    const info = await fetchUserInfo(ep, key);
    if (!info.ok) {
      this.lastError = { code: info.error };
      return err(info.error);
    }
    try {
      await this.keys.save(slot, key);
    } catch (e) {
      this.lastError = { code: e instanceof KeyStoreError && e.code === "invalid" ? "key_invalid" : "key_storage_unavailable" };
      return err(this.lastError.code);
    }
    await this.settings.update((s) => {
      s.usernames[sid] = info.info.username;
      s.backupOffered[sid] = true; // they already have a copy
      if (s.server) s.server.code = null;
    });
    this.hasKey = true;
    this.keyRejected = false;
    this.statusGen++;
    log.info(`using an existing key for ${info.info.username}`);
    await this.inspectInstall();
    await this.pollStatus();
    return OK;
  }

  async saveKeyBackup(): Promise<ActionResult> {
    const sv = this.s.server;
    const slot = this.slot();
    const sid = this.sid();
    if (!sv || !slot || !sid) return err("server_unreachable");
    const key = await this.keys.load(slot).catch(() => null);
    if (!key) return this.fail("key_invalid");
    const username = this.s.usernames[sid] ?? null;
    const file = await this.p.chooseSaveFile(`Dauntless Revived key${username ? ` - ${username}` : ""}.txt`);
    if (!file) return err("cancelled");
    try {
      await fsp.writeFile(
        file,
        backupFileText({ key, username, serverName: sv.name, host: sv.host, port: sv.port, fingerprint: sv.fp, date: new Date() }),
        { mode: 0o600 },
      );
    } catch (e) {
      log.error(`backup not saved: ${describeError(e)}`);
      return this.fail("unknown");
    }
    log.info("key backup saved");
    await this.settings.update((s) => {
      s.backupOffered[sid] = true;
    });
    this.notice = "backup_saved";
    this.publish();
    return OK;
  }

  async dismissBackupOffer(): Promise<void> {
    const sid = this.sid();
    if (!sid) return;
    await this.settings.update((s) => {
      s.backupOffered[sid] = true;
    });
    this.publish();
  }

  async logout(): Promise<ActionResult> {
    if (this.task || this.game.running) return err("busy");
    const slot = this.slot();
    const sid = this.sid();
    if (!slot || !sid) return OK;
    await this.keys.remove(slot);
    await this.settings.update((s) => {
      delete s.usernames[sid];
      delete s.backupOffered[sid];
    });
    this.hasKey = false;
    this.keyRejected = false;
    // Without a key the server no longer lists who is online; stop showing the old list now, and
    // drop any status request still on its way with the old key (it would bring the list back).
    this.statusGen++;
    if (this.status) this.status = limitedView(this.status);
    log.info("logged out; key removed");
    this.publish();
    return OK;
  }

  // ------------------------------------------------------------------ install folder

  async inspectInstall(): Promise<void> {
    const manifest = this.p.manifest;
    const dir = this.installDir;
    this.freeSpace = await freeBytes(dir);
    if (!manifest) {
      this.install = { present: 0, missing: [], partFiles: 0, dllsOk: false };
      return;
    }
    let present = 0;
    let partFiles = 0;
    const missing: ManifestFile[] = [];
    for (const f of manifest.files) {
      const full = resolveInside(dir, f.path);
      try {
        const st = await fsp.stat(full);
        if (st.isFile() && st.size === f.size) {
          present++;
          continue;
        }
      } catch {
        /* missing */
      }
      missing.push(f);
      if (existsSync(full + ".part")) partFiles++;
    }
    const dlls = present > 0 ? await dllStatus(dir) : [];
    this.install = { present, missing, partFiles, dllsOk: dlls.length > 0 && dlls.every((d) => d.ok) };
  }

  async chooseInstallDir(): Promise<ActionResult> {
    if (this.task || this.busy || this.game.running) return err("busy");
    const picked = await this.p.chooseFolder("install", this.installDir);
    if (!picked) return err("cancelled");
    // A folder that already holds the game (BaseGame144, its Dauntless folder, or Archon or Win64
    // inside it) is used as that game: no second copy is downloaded next to it.
    const existing = await locateExistingGame(picked, this.hostPlatform);
    if (this.task || this.busy || this.game.running) return err("busy");
    // A game found there whose root is too long is refused, not given a second copy in a subfolder
    // (which would be longer still).
    if (!existing.ok && existing.reason === "too_long") return this.fail("folder_invalid");
    const pathApi = this.hostPlatform === "win32" ? path.win32 : path.posix;
    let dir = existing.ok ? existing.root : pathApi.resolve(picked);
    const absolute = this.hostPlatform === "win32" ? /^[A-Za-z]:[\\/]/.test(dir) && path.win32.isAbsolute(dir) : path.posix.isAbsolute(dir);
    if (!absolute || dir.length > 150) return this.fail("folder_invalid");
    // Otherwise an empty folder is used as is, and anything else gets a subfolder.
    if (!existing.ok) {
      let entries: string[] = [];
      try {
        entries = await fsp.readdir(dir);
      } catch {
        entries = [];
      }
      if (entries.length > 0 && !entries.some((e) => e.toLowerCase() === "archon")) dir = pathApi.join(dir, "DauntlessRevived");
    }
    await this.settings.update((s) => {
      s.installDir = dir === this.p.defaultInstallDir ? null : dir;
    });
    await this.inspectInstall();
    this.publish();
    return OK;
  }

  async useExistingGameFolder(): Promise<ActionResult> {
    if (this.task || this.busy || this.game.running) return err("busy");
    const picked = await this.p.chooseFolder("existing", this.installDir);
    if (!picked) return err("cancelled");
    return this.useExistingGamePath(picked);
  }

  // "I already have the game files", from a pasted path or a picked folder (Vvoidddd, #8). The game
  // is used where it is: Repair checks every file against the manifest, fetches only what is missing
  // or different, and installs the pinned DLLs.
  async useExistingGamePath(input: string): Promise<ActionResult> {
    if (this.task || this.busy || this.game.running) return err("busy");
    const found = await locateExistingGame(input, this.hostPlatform);
    // Unlike the folder dialog, a pasted path leaves the window usable while the folder is looked at.
    if (this.task || this.busy || this.game.running) return err("busy");
    if (!found.ok) return this.fail(found.reason === "not_found" ? "game_folder_not_found" : "folder_invalid");
    await this.settings.update((s) => {
      s.installDir = found.root;
      s.verifiedDir = null;
    });
    await this.inspectInstall();
    return this.repair();
  }

  async openGameFolder(): Promise<void> {
    const dir = this.installDir;
    if (existsSync(dir)) await this.p.openPath(dir);
  }

  // ------------------------------------------------------------------ install / repair

  startInstall(): Promise<ActionResult> {
    return this.runTask("install");
  }

  repair(): Promise<ActionResult> {
    return this.runTask("repair");
  }

  pauseTask(): void {
    if (this.job && this.task?.kind === "download") {
      this.job.pause();
    }
  }

  resumeTask(): void {
    if (this.job && this.task?.kind === "download") {
      this.job.resume();
    }
  }

  cancelTask(): void {
    this.job?.cancel();
    this.taskAbort?.abort();
  }

  private setTask(t: TaskProgress | null): void {
    this.task = t;
    if (t) this.p.emitProgress(t);
  }

  // UE4SS and the client mods (client-mods.ts). Never fatal: the game runs without them.
  private async installMods(dir: string): Promise<void> {
    try {
      const r = await installClientMods(this.p.resourcesDir, dir);
      if (r) log.info(`client mods: ${r.installed} installed, ${r.upToDate} up to date, ${r.kept} kept, ${r.removed} removed, ${r.disabled} switched off`);
    } catch (e) {
      log.warn(`client mods not installed: ${describeError(e)}`);
    }
  }

  private async runTask(mode: "install" | "repair"): Promise<ActionResult> {
    if (this.task || this.busy) return err("busy");
    if (this.game.running) return this.fail("already_running");
    const manifest = this.p.manifest;
    if (!manifest) return this.fail("manifest_unavailable");
    const sv = this.s.server;
    const slot = this.slot();
    if (!sv || !slot) return this.fail("server_unreachable");
    const dir = this.installDir;
    this.lastError = null;
    this.notice = null;
    const abort = new AbortController();
    this.taskAbort = abort;
    const blank = (kind: TaskProgress["kind"], total: number, files: number): TaskProgress => ({
      kind,
      paused: false,
      totalBytes: total,
      doneBytes: 0,
      filesTotal: files,
      filesDone: 0,
      bytesPerSecond: 0,
      etaSeconds: null,
      currentFile: null,
    });
    try {
      await fsp.mkdir(dir, { recursive: true });

      // 1. Which files are needed? Files this launcher already verified in this folder are
      //    trusted by size; anything else (Repair, a folder picked by hand) is hashed.
      const fullHash = mode === "repair" || this.s.verifiedDir !== dir;
      this.setTask(blank("verify", fullHash ? manifest.totalBytes : manifest.files.length, manifest.files.length));
      this.publish();
      const report = await verifyInstall(dir, manifest.files, {
        fullHash,
        signal: abort.signal,
        trusted: mode === "install" ? (f, size, mtime) => this.verified.isTrusted(dir, f, size, mtime) : undefined,
        onProgress: (p) => {
          this.setTask({ ...blank("verify", p.totalBytes, p.filesTotal), doneBytes: p.doneBytes, filesDone: p.filesDone, currentFile: p.currentFile });
        },
      });
      const needed = report.bad.map((b) => b.file);
      for (const b of report.bad) this.verified.forget(dir, b.file);
      if (report.bad.length > 0) log.info(`${report.bad.length} file(s) to fetch (${mode})`);

      // 2. Download what is missing or damaged.
      if (needed.length > 0) {
        if (sv.mode === "public" && this.contentProbe !== true) {
          const ep = this.endpoint();
          if (ep) this.contentProbe = await probeContent(ep);
        }
        const cep = this.contentEndpoint();
        if (!cep) return this.fail("no_content_server");
        const key = await this.keys.load(slot).catch(() => null);
        if (!key) return this.fail("key_invalid");

        const serverManifest = await fetchContentManifest(cep);
        if (serverManifest === null) return this.fail("manifest_unavailable");
        const cmp = compareManifests(manifest, serverManifest);
        if (!cmp.equal) {
          log.error(`content server manifest refused: ${cmp.difference}`);
          return this.fail("manifest_mismatch", cmp.difference);
        }

        const free = await freeBytes(dir);
        let onDisk = 0;
        for (const f of needed) {
          try {
            onDisk += Math.min(f.size, (await fsp.stat(resolveInside(dir, f.path) + ".part")).size);
          } catch {
            /* none */
          }
        }
        const required = needed.reduce((a, f) => a + f.size, 0) - onDisk + DISK_MARGIN_BYTES;
        if (free !== null && free < required) return this.fail("disk_space", String(required));

        const job = new DownloadJob({
          endpoint: cep,
          downloadBaseUrl: contentDownloadBase(serverManifest),
          key,
          installDir: dir,
          files: needed,
          onProgress: (p) => this.setTask({ kind: "download", ...p }),
          onRetry: (f, n, reason) => log.warn(`retry ${n} for ${f.path}: ${reason}`),
          onFileVerified: (f) => {
            void this.verified.record(dir, f).then(() => this.verified.save()).catch(() => undefined);
          },
        });
        this.job = job;
        this.setTask(blank("download", needed.reduce((a, f) => a + f.size, 0), needed.length));
        this.publish();
        await job.run();
        this.job = null;
        log.info(`downloaded and verified ${needed.length} file(s)`);
      }

      // 3. The pinned DLLs.
      this.setTask(blank("dlls", 2, 2));
      this.publish();
      await installPinnedDlls(this.p.resourcesDir, dir);
      await this.installMods(dir);
      await removePartFiles(dir, manifest.files);
      await this.settings.update((s) => {
        s.verifiedDir = dir;
      });
      log.info(`${mode} finished in ${dir}`);
      this.notice = mode === "install" ? "install_done" : "repair_done";
      return OK;
    } catch (e) {
      if (e instanceof AbortedError || (e instanceof DownloadError && e.code === "cancelled")) {
        log.info(`${mode} cancelled`);
        return err("cancelled");
      }
      if (e instanceof DownloadError) {
        log.error(`download stopped: ${e.code} ${e.filePath ?? ""} ${e.message}`);
        const map: Record<string, ErrorCode> = {
          key_rejected: "key_rejected",
          file_missing_on_server: "file_missing_on_server",
          file_different_on_server: "file_different_on_server",
          disk_space: "disk_space",
          disk_error: "folder_invalid",
          download_failed: "download_failed",
          cert_mismatch: "cert_mismatch",
        };
        if (e.code === "key_rejected") this.keyRejected = true;
        if (e.code === "cert_mismatch") {
          this.reachable = false;
          this.connectProblem = "cert_mismatch";
        }
        return this.fail(map[e.code] ?? "download_failed", e.filePath);
      }
      if (e instanceof DllError) {
        log.error(`DLL install failed: ${e.dll}: ${e.message}`);
        return this.fail("dll_failed", e.dll);
      }
      const code = (e as NodeJS.ErrnoException)?.code;
      log.error(`${mode} failed: ${describeError(e)}`);
      if (code === "ENOSPC") return this.fail("disk_space");
      if (code === "EPERM" || code === "EACCES") return this.fail("folder_invalid");
      return this.fail("unknown");
    } finally {
      await this.verified.save().catch(() => undefined);
      this.job = null;
      this.taskAbort = null;
      this.task = null;
      await this.inspectInstall().catch(() => undefined);
      this.publish();
    }
  }

  // ------------------------------------------------------------------ play

  async play(): Promise<ActionResult> {
    if (this.busy || this.task) return err("busy");
    if (this.game.running) return this.fail("already_running");
    const sv = this.s.server;
    const slot = this.slot();
    if (!sv || !slot) return this.fail("server_unreachable");
    return this.withBusy(async () => {
      const missing = [...missingVcRuntime(process.env, this.p.runtimeFilesExist ?? existsSync, this.hostPlatform), ...missingDirectX(process.env, this.p.runtimeFilesExist ?? existsSync, this.hostPlatform)];
      if (missing.length) return this.fail('windows_runtime_missing', missing.join(', '));

      const others = await this.p.findRunningClients();
      if (others.length > 0) return this.fail("already_running");
      const key = await this.keys.load(slot).catch(() => null);
      if (!key) return this.fail("key_invalid");
      const ep = this.endpoint();
      if (!ep) return this.fail('server_unreachable');
      const account = await fetchUserInfo(ep, key);
      if (!account.ok) {
        this.keyRejected = account.error === 'key_rejected';
        return this.fail(account.error);
      }
      this.keyRejected = false;
      if (this.s.huntRegion) {
        try {
          if (!await saveHuntRegion(ep,key,this.s.huntRegion)) return this.fail('server_error','The selected hunt region is unavailable. Choose Main in Settings or try again later.');
        } catch { return this.fail('server_unreachable'); }
      }
      const dir = this.installDir;
      await this.inspectInstall();
      if (this.install.missing.length > 0) return this.fail("game_files_invalid", String(this.install.missing.length));
      // Same checks as play.ps1 on every launch: the exe and both DLLs by hash.
      const exePin = this.p.exePin ?? { relativePath: EXE_RELATIVE_PATH, sha256: PINNED_EXE_SHA256 };
      let exeHash = "";
      try {
        exeHash = await hashFile(resolveInside(dir, exePin.relativePath));
      } catch {
        exeHash = "";
      }
      if (exeHash !== exePin.sha256) return this.fail("game_files_invalid", exePin.relativePath);
      if (!this.install.dllsOk) {
        try {
          await installPinnedDlls(this.p.resourcesDir, dir);
        } catch (e) {
          log.error(`DLL repair before launch failed: ${describeError(e)}`);
          return this.fail("dll_failed");
        }
      }
      await this.installMods(dir);

      // Where the game connects. Public mode: the local relay, started before the game.
      let gameHost = sv.host;
      let gamePort = sv.port;
      let xmppPort = XMPP_PORT;
      if (sv.mode === "public") {
        const started = await this.startRelay(sv);
        if (!started.ok) return started;
        gameHost = "127.0.0.1";
        gamePort = this.relay?.port ?? DEFAULT_RELAY_PORT;
        xmppPort = gamePort;
      }

      let launched = false;
      try {
        let prepared: { runtime: LaunchRuntime; configDir: string; runtimeName: string } | null = null;
        if (this.p.prepareGameLaunch) {
          try {
            prepared = await this.p.prepareGameLaunch({ softwareMedia: this.s.mediaCompatibility });
          } catch (e) {
            log.error(`compatibility runtime preparation failed: ${describeError(e)}`);
            return this.fail("launch_failed");
          }
          if (this.hostPlatform === "linux" && prepared === null) return this.fail("compat_runtime_missing");
        }
        let displayRepaired = false;

        try {
          const config = await applyGameConfig({
            host: gameHost,
            xmppPort,
            graphics: this.s.graphics,
            exposure: this.s.exposure,
            safeWindow: this.s.windowed,

            configDir: prepared?.configDir ?? this.p.gameConfigDir,
          });
          displayRepaired = config.displayRepaired;

          if (this.s.exposure !== "game") log.info(`game config: auto exposure ${this.s.exposure}`);
        } catch (e) {
          log.error(`could not write the game config: ${describeError(e)}`);
          return this.fail("config_failed");
        }
        const args = buildLaunchArgs({ host: gameHost, port: gamePort, key, windowed: this.s.windowed || displayRepaired, softwareMedia: this.hostPlatform === "linux" && this.s.mediaCompatibility });
        const via = prepared ? ` via ${prepared.runtimeName}` : "";
        log.info(`starting ${describeLaunch(EXE_NAME, args)}${via}${sv.mode === "public" ? ` (relay to ${sv.host}:${sv.port})` : ""}`);
        try {
          await this.game.start(win64Dir(dir), args, prepared?.runtime);
        } catch (e) {
          log.error(`launch failed: ${describeError(e)}`);
          return this.fail("launch_failed");
        }
        launched = true;
        return OK;
      } finally {
        if (!launched) await this.stopRelay();
      }
    });
  }

  private async startRelay(sv: StoredServer): Promise<ActionResult> {
    await this.stopRelay();
    if (sv.mode !== "public" || sv.fp === null) return err("relay_failed");
    const port = this.p.relayPort ?? DEFAULT_RELAY_PORT;
    const relay = new Relay({
      target: { host: sv.host, port: sv.port, fingerprint: sv.fp },
      port,
      onPinError: () => {
        this.lastError = { code: "cert_mismatch" };
        this.publish();
      },
      onLog: (level, message) => log[level](`relay: ${message}`),
    });
    try {
      await relay.start();
    } catch (e) {
      log.error(`relay could not start: ${describeError(e)}`);
      return this.fail(e instanceof RelayError && e.code === "port_busy" ? "relay_port_busy" : "relay_failed", String(port));
    }
    this.relay = relay;
    return OK;
  }

  private async stopRelay(): Promise<void> {
    const relay = this.relay;
    this.relay = null;
    if (relay) {
      await relay.stop().catch(() => undefined);
      log.info(`relay stopped (${relay.requests} requests, ${relay.upgrades} upgrades, ${relay.failures} failures)`);
    }
  }

  // ------------------------------------------------------------------ settings / links

  async setSettings(patch: unknown): Promise<Settings> {
    if (typeof patch === "object" && patch !== null) {
      const p = patch as Record<string, unknown>;
      await this.settings.update((s) => {
        if (GRAPHICS_PRESETS.includes(p.graphics as GraphicsPreset)) s.graphics = p.graphics as GraphicsPreset;
        if (EXPOSURE_MODES.includes(p.exposure as ExposureMode)) s.exposure = p.exposure as ExposureMode;
        if (typeof p.windowed === "boolean") s.windowed = p.windowed;
        if (typeof p.mediaCompatibility === "boolean") s.mediaCompatibility = p.mediaCompatibility;
        if (p.huntRegion === 'main' || p.huntRegion === 'aus' || p.huntRegion === 'ger') s.huntRegion = p.huntRegion;
        if (p.language === "en" || p.language === "fi") s.language = p.language;
      });
    }
    this.publish();
    return { graphics: this.s.graphics, exposure: this.s.exposure, windowed: this.s.windowed, mediaCompatibility: this.s.mediaCompatibility, language: this.s.language, ...(this.s.huntRegion ? {huntRegion:this.s.huntRegion} : {}) };
  }

  async openExternal(target: ExternalTarget): Promise<ActionResult> {
    let url: string | null;
    switch (target) {
      case "tailscale_share":
        url = this.s.server?.mode === "private" ? this.s.server.share : null;
        break;
      case "server_source":
        url = this.status?.sourceUrl ?? PROJECT_URL;
        break;
      default:
        // Every other target opens its one fixed URL; an unknown name gets null.
        url = fixedLinkUrl(target);
    }
    if (!url || !isAllowedExternalUrl(url, this.status?.sourceUrl ?? null)) return err("unknown");
    await this.p.openExternal(url);
    return OK;
  }

  async shutdown(): Promise<void> {
    this.setStatusPolling(false);
    this.job?.cancel();
    this.taskAbort?.abort();
    await this.stopRelay();
  }
}
