// Live server status (shared contract 3): GET /undaunted/api/ServerStatus.
// The answer comes from the network, so every field is checked and cleaned before the UI sees it.

import { UNSAFE_CHARS } from "./text";

export type PlayerWhere = "menu" | "city" | "hunt" | "dojo" | "tutorial" | "unknown";
export type InstanceKind = "city" | "hunt" | "dojo" | "tutorial";
export type RegistrationMode = "OPEN" | "INVITECODE" | "NONE";

export interface StatusPlayer {
  name: string;
  where: PlayerWhere;
  instance: string | null;
}

export interface StatusInstance {
  id: string;
  kind: InstanceKind;
  title: string;
  map: string;
  behemoth: string | null;
  players: number;
  maxPlayers: number;
  startedAt: string | null; // ISO string, or null when the server sent something unreadable
  // How long this world has been observed with nobody in it, or null when it is not empty.
  // startedAt is its age, which says nothing about occupancy: a hunt that emptied a moment ago
  // is indistinguishable from one nobody ever joined.
  emptyForMs: number | null;
}

export interface ServerStatus {
  name: string;
  online: boolean;
  version: string;
  commit: string;
  sourceUrl: string | null; // only https URLs survive parsing
  registration: RegistrationMode | null;
  playersOnline: number;
  players: StatusPlayer[];
  instances: StatusInstance[];
  contentPort: number | null;
  uptimeSeconds: number;
  // The server hid who is online (playersOnline 0, no players, no instances): its answer to a
  // launcher without an account key there, or with one it did not accept.
  limited: boolean;
}

const MAX_PLAYERS_LISTED = 500;
const MAX_INSTANCES_LISTED = 100;
const WHERE: readonly PlayerWhere[] = ["menu", "city", "hunt", "dojo", "tutorial", "unknown"];
const KINDS: readonly InstanceKind[] = ["city", "hunt", "dojo", "tutorial"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const text = v
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

function cleanInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function cleanHttpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 512) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    // The same limits as the link check in src/main/links.ts, so a Source button never does nothing.
    const text = url.toString();
    return text.length <= 1024 ? text : null;
  } catch {
    return null;
  }
}

function cleanIso(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseServerStatus(raw: unknown): ServerStatus | null {
  if (!isObject(raw)) return null;
  const name = cleanText(raw.name, 64);
  if (name === null) return null;

  const players: StatusPlayer[] = [];
  if (Array.isArray(raw.players)) {
    for (const p of raw.players.slice(0, MAX_PLAYERS_LISTED)) {
      if (!isObject(p)) continue;
      const pname = cleanText(p.name, 32);
      if (pname === null) continue;
      const where = WHERE.includes(p.where as PlayerWhere) ? (p.where as PlayerWhere) : "unknown";
      players.push({ name: pname, where, instance: cleanText(p.instance, 64) });
    }
  }

  const instances: StatusInstance[] = [];
  if (Array.isArray(raw.instances)) {
    for (const i of raw.instances.slice(0, MAX_INSTANCES_LISTED)) {
      if (!isObject(i)) continue;
      const id = cleanText(i.id, 64);
      if (id === null || !KINDS.includes(i.kind as InstanceKind)) continue;
      const kind = i.kind as InstanceKind;
      instances.push({
        id,
        kind,
        title: cleanText(i.title, 64) ?? "",
        map: cleanText(i.map, 96) ?? "",
        behemoth: cleanText(i.behemoth, 64),
        players: cleanInt(i.players, 0, 1000) ?? 0,
        maxPlayers: cleanInt(i.maxPlayers, 0, 1000) ?? 0,
        startedAt: cleanIso(i.startedAt),
    emptyForMs: cleanInt(i.emptyForMs, 0, 86_400_000) ?? null,
      });
    }
  }

  const registration =
    raw.registration === "OPEN" || raw.registration === "INVITECODE" || raw.registration === "NONE"
      ? raw.registration
      : null;

  const contentPort = cleanInt(raw.contentPort, 0, 65535);

  const status: ServerStatus = {
    name,
    online: raw.online === true,
    version: cleanText(raw.version, 48) ?? "",
    commit: cleanText(raw.commit, 64) ?? "",
    sourceUrl: cleanHttpsUrl(raw.sourceUrl),
    registration,
    playersOnline: cleanInt(raw.playersOnline, 0, 100000) ?? players.length,
    players,
    instances,
    contentPort: contentPort !== null && contentPort >= 1 ? contentPort : null,
    uptimeSeconds: cleanInt(raw.uptimeSeconds, 0, 100 * 365 * 24 * 3600) ?? 0,
    // Only an explicit true: an older server without the field lists everyone.
    limited: raw.limited === true,
  };
  // A limited answer lists nobody, whatever else came with it.
  return status.limited ? limitedView(status) : status;
}

// What a limited answer would show: the same server, nobody listed. Used when the launcher knows
// it can no longer see the list (it just logged out) before the next poll says so.
export function limitedView(status: ServerStatus): ServerStatus {
  return { ...status, playersOnline: 0, players: [], instances: [], limited: true };
}

// Instance cards are listed city first, then dojo, tutorial and hunts, busiest first.
export function sortInstances(list: StatusInstance[]): StatusInstance[] {
  const order: Record<InstanceKind, number> = { city: 0, dojo: 1, tutorial: 2, hunt: 3 };
  return [...list].sort(
    (a, b) => order[a.kind] - order[b.kind] || b.players - a.players || a.title.localeCompare(b.title),
  );
}
