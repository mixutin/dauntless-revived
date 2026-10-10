// Calls to the host's metagame (contracts 2 and 3) and content server (contract 4).
// The account key is sent only in the x-undaunted-user-api-key header, only to the invite's host
// (in public mode only over the TLS connection pinned to the invite's certificate fingerprint):
// GetUserInfo, ServerStatus (for the player list) and the content downloads.

import { Endpoint, HttpError, HttpResponse, parseJsonBody, request } from "./http";
import { parseServerStatus, ServerStatus, cleanText } from "../shared/status";
import { isPlausibleAccountKey } from "../shared/username";
import type { ErrorCode, NewsItem } from "../shared/types";
import { CONNECT_TIMEOUT_MS } from "./constants";
import { UNSAFE_CHARS_MULTILINE } from "../shared/text";
import { isPrivateModeHost } from "../shared/invite";

const KEY_HEADER = "x-undaunted-user-api-key";

export async function saveHuntRegion(ep: Endpoint, key: string, region: 'main' | 'aus' | 'ger' | 'us'): Promise<boolean> {
  const res = await request(ep, '/undaunted/api/HuntRegion', {
    method:'POST', headers:statusHeaders(ep,key), body:JSON.stringify({region}), timeoutMs:10000,maxBytes:4096
  });
  const body = parseJsonBody(res);
  return res.status === 200 && isObject(body) && body.region === region;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- ServerStatus

export type StatusResult =
  | { kind: "ok"; status: ServerStatus }
  | { kind: "unsupported" } // reachable Dauntless Revived / Undaunted server without ServerStatus
  | { kind: "bad_answer" }
  | { kind: "cert_mismatch" } // public mode: the certificate is not the one from the invite
  | { kind: "unreachable" };

function isPin(e: unknown): boolean {
  return e instanceof HttpError && e.kind === "pin";
}

export interface StatusOptions {
  // The account key for this server. The server lists who is online only for a registered player;
  // without a key (or with one it does not accept) it answers the same status with "limited": true.
  key?: string | null;
  timeoutMs?: number;
}

// The key goes only where every other key-carrying request goes: to the invite's host, over the TLS
// connection pinned to the invite's certificate (public mode) or plain HTTP inside the tailnet or
// to this PC (private mode, which request() enforces as well). Never to the legacy fallback below.
function statusHeaders(ep: Endpoint, key: string | null | undefined): Record<string, string> {
  if (!isPlausibleAccountKey(key)) return {};
  if (ep.pin === null && !isPrivateModeHost(ep.host)) return {};
  return { [KEY_HEADER]: key };
}

export async function fetchServerStatus(ep: Endpoint, opts: StatusOptions = {}): Promise<StatusResult> {
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  let res: HttpResponse;
  try {
    res = await request(ep, "/undaunted/api/ServerStatus", { headers: statusHeaders(ep, opts.key), timeoutMs, maxBytes: 1024 * 1024 });
  } catch (e) {
    return isPin(e) ? { kind: "cert_mismatch" } : { kind: "unreachable" };
  }
  if (res.status === 200) {
    const status = parseServerStatus(parseJsonBody(res));
    return status ? { kind: "ok", status } : { kind: "bad_answer" };
  }
  if (res.status === 404) {
    // An older metagame: still a real server if /dauntless-status answers like one.
    try {
      const legacy = await request(ep, "/dauntless-status", { timeoutMs, maxBytes: 64 * 1024 });
      const body = parseJsonBody(legacy);
      if (legacy.status === 200 && isObject(body) && "show-status" in body) return { kind: "unsupported" };
    } catch (e) {
      return isPin(e) ? { kind: "cert_mismatch" } : { kind: "unreachable" };
    }
  }
  return { kind: "bad_answer" };
}

// ---------------------------------------------------------------- Register / GetUserInfo

export type RegisterResult = { ok: true; key: string } | { ok: false; error: ErrorCode; message?: string };

export async function registerAccount(ep: Endpoint, username: string, inviteCode: string): Promise<RegisterResult> {
  let res: HttpResponse;
  try {
    res = await request(ep, "/undaunted/api/Register", {
      method: "POST",
      body: JSON.stringify({ Username: username, InviteCode: inviteCode }),
      timeoutMs: 20000,
      maxBytes: 64 * 1024,
    });
  } catch (e) {
    return { ok: false, error: isPin(e) ? "cert_mismatch" : "server_unreachable" };
  }
  const body = parseJsonBody(res);
  const serverError = isObject(body) && typeof body.error === "string" ? body.error : null;
  const message = isObject(body) ? cleanText(body.message, 200) ?? undefined : undefined;
  switch (res.status) {
    case 200: {
      const key = isObject(body) ? body.UUK : undefined;
      if (!isPlausibleAccountKey(key)) return { ok: false, error: "server_error" };
      return { ok: true, key };
    }
    case 400:
      if (serverError === "username_invalid" || serverError === "registration_closed" || serverError === "bad_request") {
        return { ok: false, error: serverError, message };
      }
      return { ok: false, error: "bad_request", message };
    case 401:
      return { ok: false, error: "invite_invalid" };
    case 409:
      return { ok: false, error: "username_taken" };
    case 413:
    case 429:
      return { ok: false, error: "rate_limited" };
    default:
      return { ok: false, error: "server_error" };
  }
}

export interface UserInfo {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export type UserInfoResult =
  | { ok: true; info: UserInfo }
  | { ok: false; error: "account_banned" | "key_rejected" | "server_unreachable" | "server_error" | "cert_mismatch" | "rate_limited"; detail?: string };

export async function fetchUserInfo(ep: Endpoint, key: string): Promise<UserInfoResult> {
  if (!isPlausibleAccountKey(key)) return { ok: false, error: "key_rejected" };
  let res: HttpResponse;
  try {
    res = await request(ep, "/undaunted/api/GetUserInfo", { headers: { [KEY_HEADER]: key }, timeoutMs: 10000, maxBytes: 64 * 1024 });
  } catch (e) {
    return { ok: false, error: isPin(e) ? "cert_mismatch" : "server_unreachable" };
  }
  if (res.status === 403) {
    const body = parseJsonBody(res);
    if(isObject(body) && body.error === 'account_banned') return {ok:false,error:'account_banned',detail:cleanText(body.reason,500) ?? 'Contact support for details.'};
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "key_rejected" };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status !== 200) return { ok: false, error: "server_error" };
  const body = parseJsonBody(res);
  if (!isObject(body)) return { ok: false, error: "server_error" };
  const userId = cleanText(body.UserId, 128);
  const username = cleanText(body.Username, 32);
  if (userId === null || username === null) return { ok: false, error: "server_error" };
  return { ok: true, info: { userId, username, isAdmin: body.IsAdmin === true } };
}

// ---------------------------------------------------------------- Content server

// Public mode: is the host's content server behind the gateway? (HEAD /content/v1/manifest)
export async function probeContent(ep: Endpoint): Promise<boolean> {
  try {
    const res = await request(ep, "/content/v1/manifest", { method: "HEAD", timeoutMs: 8000, maxBytes: 1024 });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function fetchContentManifest(ep: Endpoint): Promise<unknown | null> {
  try {
    const res = await request(ep, "/content/v1/manifest", { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
    return res.status === 200 ? parseJsonBody(res) ?? null : null;
  } catch {
    return null;
  }
}

export function cleanNewsBody(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const text = v
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARS_MULTILINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length === 0) return null;
  return text.length > 4000 ? text.slice(0, 4000) + "…" : text;
}

export function parseNews(raw: unknown): NewsItem[] {
  if (!isObject(raw) || !Array.isArray(raw.items)) return [];
  const items: NewsItem[] = [];
  for (const item of raw.items.slice(0, 30)) {
    if (!isObject(item)) continue;
    const title = cleanText(item.title, 120);
    const body = cleanNewsBody(item.body);
    if (title === null || body === null) continue;
    const t = typeof item.date === "string" ? Date.parse(item.date) : NaN;
    items.push({ date: Number.isFinite(t) ? new Date(t).toISOString() : null, title, body });
  }
  return items;
}

export async function fetchNews(ep: Endpoint, fallback: NewsItem[] = []): Promise<NewsItem[]> {
  try {
    const res = await request(ep, "/content/v1/news", { timeoutMs: 10000, maxBytes: 512 * 1024 });
    return res.status === 200 ? parseNews(parseJsonBody(res)) : fallback;
  } catch {
    return fallback;
  }
}

export interface BrandingIndex {
  backgrounds: { path: string; credit: string | null }[];
  accent: string | null;
}

const BRANDING_PATH = /^\/content\/v1\/branding\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,100}\.(jpg|jpeg|png|webp)$/i;

export function parseBranding(raw: unknown): BrandingIndex {
  const out: BrandingIndex = { backgrounds: [], accent: null };
  if (!isObject(raw)) return out;
  if (Array.isArray(raw.backgrounds)) {
    for (const b of raw.backgrounds.slice(0, 8)) {
      if (!isObject(b) || typeof b.url !== "string" || !BRANDING_PATH.test(b.url) || b.url.includes("..")) continue;
      out.backgrounds.push({ path: b.url, credit: cleanText(b.credit, 120) });
    }
  }
  if (typeof raw.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.accent)) out.accent = raw.accent.toLowerCase();
  return out;
}

export async function fetchBrandingIndex(ep: Endpoint): Promise<BrandingIndex> {
  try {
    const res = await request(ep, "/content/v1/branding", { timeoutMs: 10000, maxBytes: 64 * 1024 });
    return res.status === 200 ? parseBranding(parseJsonBody(res)) : { backgrounds: [], accent: null };
  } catch {
    return { backgrounds: [], accent: null };
  }
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

// Decides the image type from its first bytes; the server's Content-Type is not trusted.
export function sniffImage(data: Buffer): ImageType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export const MAX_ART_BYTES = 15 * 1024 * 1024;

export async function fetchBrandingImage(ep: Endpoint, urlPath: string): Promise<{ type: ImageType; data: Buffer } | null> {
  if (!BRANDING_PATH.test(urlPath) || urlPath.includes("..")) return null;
  try {
    const res = await request(ep, urlPath, { timeoutMs: 30000, maxBytes: MAX_ART_BYTES });
    if (res.status !== 200) return null;
    const type = sniffImage(res.body);
    return type ? { type, data: res.body } : null;
  } catch {
    return null;
  }
}

export async function endPlaying(ep:Endpoint,key:string):Promise<void> {
  await request(ep,'/undaunted/api/PlayingEnded',{method:'POST',headers:statusHeaders(ep,key),timeoutMs:5000,maxBytes:4096});
}
