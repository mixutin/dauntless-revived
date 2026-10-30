// The launcher's side of playtime, in userData/playtime.json. The hours themselves are counted by a
// server from the game's heartbeats (GET /undaunted/api/Playtime): online by the server the player
// joined, offline by the local server of offline play, whose save (offline/undaunted.db) holds them.
// Kept here: the number of sessions, the last one's length, the running session's start (for the
// live count) and the offline hours last read from the offline save, to show them while offline
// play is stopped.

import { promises as fsp, readFileSync } from "node:fs";
import type { Playtime } from "../shared/types";

interface Stored {
  version: 1;
  offlineSeconds: number; // as last read from the offline save
  sessions: number;
  lastSessionSeconds: number;
  lastPlayedAt: string | null;
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export class PlaytimeStore {
  private data: Stored = { version: 1, offlineSeconds: 0, sessions: 0, lastSessionSeconds: 0, lastPlayedAt: null };
  private startedAt: number | null = null; // the running session's start (ms)
  private offline = false; // the running session is offline play
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (raw && typeof raw === "object") {
        this.data.offlineSeconds = count(raw.offlineSeconds);
        this.data.sessions = count(raw.sessions);
        this.data.lastSessionSeconds = count(raw.lastSessionSeconds);
        this.data.lastPlayedAt = typeof raw.lastPlayedAt === "string" && !Number.isNaN(Date.parse(raw.lastPlayedAt)) ? raw.lastPlayedAt : null;
      }
    } catch {
      /* nothing played yet */
    }
  }

  get running(): boolean {
    return this.startedAt !== null;
  }

  start(offline: boolean): void {
    if (this.startedAt !== null) return;
    this.startedAt = this.now();
    this.offline = offline;
    this.data.sessions += 1;
    this.data.lastPlayedAt = new Date(this.startedAt).toISOString();
    void this.save();
  }

  stop(): Promise<void> {
    if (this.startedAt === null) return this.writing;
    this.data.lastSessionSeconds = this.sessionSeconds();
    this.startedAt = null;
    this.offline = false;
    return this.save();
  }

  // The offline save's own count, read from its local server.
  setOfflineSeconds(seconds: number): Promise<void> {
    const s = count(seconds);
    if (s === this.data.offlineSeconds) return this.writing;
    this.data.offlineSeconds = s;
    return this.save();
  }

  view(): Playtime {
    return {
      onlineSeconds: null, // the controller fills it in from the server
      offlineSeconds: this.data.offlineSeconds,
      sessions: this.data.sessions,
      lastSessionSeconds: this.data.lastSessionSeconds,
      lastPlayedAt: this.data.lastPlayedAt,
      sessionStartedAt: this.startedAt !== null ? new Date(this.startedAt).toISOString() : null,
      sessionOffline: this.startedAt !== null && this.offline,
    };
  }

  // A clock set back never takes time away.
  private sessionSeconds(): number {
    return this.startedAt === null ? 0 : Math.max(0, Math.floor((this.now() - this.startedAt) / 1000));
  }

  private save(): Promise<void> {
    const text = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      try {
        await fsp.writeFile(`${this.file}.tmp`, text, "utf8");
        await fsp.rename(`${this.file}.tmp`, this.file);
      } catch {
        /* shown again from memory; the next change tries again */
      }
    });
    return this.writing;
  }
}
