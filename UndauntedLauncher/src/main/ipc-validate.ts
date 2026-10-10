// Argument checks for every IPC call from the renderer. Anything unexpected is refused before it
// reaches the controller.

import { EXPOSURE_MODES, GAME_LANGUAGES, GRAPHICS_PRESETS, LANGUAGES, type ExposureMode, type ExternalTarget, type GameLanguage, type GraphicsPreset, type Language, type Settings } from "../shared/types";

export function boundedString(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length <= max ? v : null;
}

export function settingsPatch(v: unknown): Partial<Settings> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Partial<Settings> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === "graphics" && GRAPHICS_PRESETS.includes(val as GraphicsPreset)) out.graphics = val as GraphicsPreset;
    else if (k === "exposure" && EXPOSURE_MODES.includes(val as ExposureMode)) out.exposure = val as ExposureMode;
    else if (k === "windowed" && typeof val === "boolean") out.windowed = val;
    else if (k === "showConsole" && typeof val === "boolean") out.showConsole = val;
    else if (k === "huntRegion" && (val === 'auto' || val === 'main' || val === 'aus' || val === 'ger')) out.huntRegion = val;
    else if (k === "language" && LANGUAGES.includes(val as Language)) out.language = val as Language;
    else if (k === "gameLanguage" && GAME_LANGUAGES.includes(val as GameLanguage)) out.gameLanguage = val as GameLanguage;
    else return null;
  }
  return out;
}

// Every link name the page may send (a Record, so the compiler catches a name missing here). Only
// these exact strings pass: never a URL.
const TARGETS: Readonly<Record<ExternalTarget, true>> = {
  tailscale_download: true,
  tailscale_share: true,
  vc_redist: true,
  directx_runtime: true,
  server_source: true,
  project_source: true,
  project_license: true,
  project_contributors: true,
  upstream_source: true,
  upstream_contributors: true,
  eugamehost: true,
  eugamehost_game1: true,
  eugamehost_game2: true,
  eugamehost_game3: true,
  eugamehost_game5: true,
  eugamehost_5800x: true,
  discord: true,
  patreon: true,
};

export function externalTarget(v: unknown): ExternalTarget | null {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TARGETS, v) ? (v as ExternalTarget) : null;
}

// Hidden override for the relay port (tests and rehearsals on a PC where 61000 is taken).
export function relayPortOverride(v: string | undefined): number | undefined {
  if (typeof v !== "string" || !/^[1-9][0-9]{3,4}$/.test(v.trim())) return undefined;
  const n = Number(v.trim());
  return n >= 1024 && n <= 65535 ? n : undefined;
}

// Only the launcher's own page may call in: the packaged file:// page, or the Vite dev server.
export function isTrustedPageUrl(url: string, devServerUrl: string | undefined, rendererIndexUrl: string): boolean {
  if (typeof url !== "string") return false;
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  const strip = (u: string) => u.split("#")[0].split("?")[0].toLowerCase();
  return strip(url) === strip(rendererIndexUrl);
}
