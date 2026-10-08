// Launcher settings in userData/settings.json. No secrets in here: the key lives in the KeyStore.

import { promises as fsp, readFileSync } from "node:fs";
import path from "node:path";
import { isPrivateModeHost, isValidFingerprint, isValidHost, isValidInviteCode, isValidShareUrl, cleanServerName, type ServerMode } from "../shared/invite";
import { isValidUsername } from "../shared/username";
import { DEFAULT_GRAPHICS, EXPOSURE_MODES, GRAPHICS_PRESETS, type ExposureMode, type GraphicsPreset, type Language } from "../shared/types";

export interface StoredServer {
  mode: ServerMode;
  host: string;
  port: number;
  name: string;
  share: string | null; // private mode: Tailscale share link
  fp: string | null; // public mode: pinned certificate fingerprint
  code: string | null; // invite code not used yet
}

export interface StoredSettings {
  huntRegion?: 'main' | 'aus' | 'ger';
  version: 1;
  server: StoredServer | null;
  installDir: string | null; // null = the default folder
  verifiedDir: string | null; // the folder whose files were last fully checked or downloaded
  graphics: GraphicsPreset;
  exposure: ExposureMode;
  windowed: boolean;
  mediaCompatibility: boolean;
  language: Language;
  usernames: Record<string, string>; // per server id, for display only
  backupOffered: Record<string, boolean>; // per server id: the one-time backup offer was shown
}

export function defaultSettings(language: Language, platform: NodeJS.Platform = process.platform, steamDeck = false): StoredSettings {
  return {
    version: 1,
    server: null,
    installDir: null,
    verifiedDir: null,
    graphics: steamDeck && platform === "linux" ? "deck" : DEFAULT_GRAPHICS,
    exposure: "game",
    windowed: false,
    mediaCompatibility: platform === "linux",
    language,
    usernames: {},
    backupOffered: {},
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validDir(v: unknown, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof v !== "string" || v.length <= 3 || v.length >= 200 || v.includes("\0")) return null;
  if (platform === "win32") return /^[A-Za-z]:[\\/]/.test(v) && path.win32.isAbsolute(v) ? v : null;
  if (platform === "linux") return path.posix.isAbsolute(v) ? v : null;
  return null;
}

export function sanitizeSettings(raw: unknown, language: Language, platform: NodeJS.Platform = process.platform, steamDeck = false): StoredSettings {
  const s = defaultSettings(language, platform, steamDeck);
  if (!isObject(raw)) return s;
  if (isObject(raw.server)) {
    const sv = raw.server;
    const name = typeof sv.name === "string" ? cleanServerName(sv.name) : null;
    const mode: ServerMode = sv.mode === "public" ? "public" : "private";
    // Private mode is plain HTTP: only into the tailnet (or loopback), as parseInvite enforces.
    const hostOk = typeof sv.host === "string" && isValidHost(sv.host) && (mode === "public" || isPrivateModeHost(sv.host));
    const portOk = Number.isInteger(sv.port) && (sv.port as number) >= 1 && (sv.port as number) <= 65535;
    // A public server without a valid fingerprint is dropped: it could never be reached safely.
    const fpOk = mode === "private" || isValidFingerprint(sv.fp);
    if (hostOk && portOk && fpOk && name) {
      s.server = {
        mode,
        host: sv.host as string,
        port: sv.port as number,
        name,
        share: mode === "private" && typeof sv.share === "string" && isValidShareUrl(sv.share) ? sv.share : null,
        fp: mode === "public" ? (sv.fp as string) : null,
        code: typeof sv.code === "string" && isValidInviteCode(sv.code) ? sv.code : null,
      };
    }
  }
  s.installDir = validDir(raw.installDir, platform);
  s.verifiedDir = validDir(raw.verifiedDir, platform);
  if (GRAPHICS_PRESETS.includes(raw.graphics as GraphicsPreset)) s.graphics = raw.graphics as GraphicsPreset;
  if (EXPOSURE_MODES.includes(raw.exposure as ExposureMode)) s.exposure = raw.exposure as ExposureMode;
  s.windowed = raw.windowed === true;
  if (typeof raw.mediaCompatibility === "boolean") s.mediaCompatibility = raw.mediaCompatibility;
  if (raw.huntRegion === 'main' || raw.huntRegion === 'aus' || raw.huntRegion === 'ger') s.huntRegion = raw.huntRegion;
  if (raw.language === "en" || raw.language === "fi") s.language = raw.language;
  if (isObject(raw.usernames)) {
    for (const [k, v] of Object.entries(raw.usernames)) if (/^[0-9a-f]{24}$/.test(k) && isValidUsername(v)) s.usernames[k] = v;
  }
  if (isObject(raw.backupOffered)) {
    for (const [k, v] of Object.entries(raw.backupOffered)) if (/^[0-9a-f]{24}$/.test(k) && v === true) s.backupOffered[k] = true;
  }
  return s;
}

export class SettingsStore {
  private data: StoredSettings;
  private readonly file: string;

  constructor(dir: string, language: Language, private readonly platform: NodeJS.Platform = process.platform, private readonly steamDeck = false) {
    this.file = path.join(dir, "settings.json");
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      raw = null;
    }
    this.data = sanitizeSettings(raw, language, this.platform, this.steamDeck);
  }

  get(): StoredSettings {
    return this.data;
  }

  async update(fn: (s: StoredSettings) => void): Promise<StoredSettings> {
    const copy: StoredSettings = JSON.parse(JSON.stringify(this.data));
    fn(copy);
    this.data = sanitizeSettings(copy, copy.language, this.platform, this.steamDeck);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fsp.rename(tmp, this.file);
    return this.data;
  }
}
