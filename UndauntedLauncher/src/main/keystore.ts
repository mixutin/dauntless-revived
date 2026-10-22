// Account keys, one per server, stored only through Electron safeStorage (DPAPI on Windows, the desktop secret store on Linux).
// The key never goes to the renderer; it is read here when a request or the game launch needs it.
//
// A public server's key is tied to the certificate fingerprint it was saved with. An invite for the
// same host:port with another fingerprint (a rebuilt server, or someone in the middle) cannot
// load it: the key moves to a new fingerprint only through rebind(), after the user confirmed.

import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { cleanServerName, isPrivateModeHost, isValidFingerprint, isValidHost, isValidPort, type Invite } from "../shared/invite";
import { extractAccountKey, isPlausibleAccountKey } from "../shared/username";
import { addSecret, removeSecret, log } from "./log";

export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class KeyStoreError extends Error {
  constructor(public readonly code: "unavailable" | "invalid") {
    super(code);
    this.name = "KeyStoreError";
  }
}

// One key per server. Private servers keep the plain host:port id; public servers get their own
// namespace, so a public and a private server on the same address never share a key.
export function serverId(host: string, port: number, mode: "private" | "public" = "private"): string {
  const id = mode === "public" ? `public:${host}:${port}` : `${host}:${port}`;
  return createHash("sha256").update(id).digest("hex").slice(0, 24);
}

export interface KeySlot {
  host: string;
  port: number;
  mode: "private" | "public";
  fp: string | null; // public mode: the certificate fingerprint the key belongs to
}

// What is inside a key file after decryption: "DRK2\n<fingerprint or ->\n<key>". The first
// format was the key alone; such a key is not tied to any certificate.
const FORMAT = "DRK2";

interface StoredKey {
  key: string;
  fp: string | null;
}

export class KeyStore {
  constructor(private readonly dir: string, private readonly crypto: Encryptor, private readonly recoveryDir?: string) {}

  private file(slot: KeySlot): string {
    return path.join(this.dir, `${serverId(slot.host, slot.port, slot.mode)}.key`);
  }

  private async read(slot: KeySlot): Promise<StoredKey | null> {
    let data: Buffer;
    let recovery = false;
    try {
      data = await fsp.readFile(this.file(slot));
    } catch {
      if (!this.recoveryDir) return null;
      try {
        data = await fsp.readFile(path.join(this.recoveryDir, `${serverId(slot.host, slot.port, slot.mode)}.txt`));
        recovery = true;
      } catch { return null; }
    }
    if (!recovery && !this.crypto.isAvailable()) throw new KeyStoreError("unavailable");
    let text: string;
    try {
      text = recovery ? data.toString("utf8") : this.crypto.decrypt(data);
    } catch {
      return null; // encrypted by another Windows user or PC
    }
    const parts = text.split("\n");
    if (parts.length === 3 && parts[0] === FORMAT) {
      const fp = parts[1] === "-" ? null : parts[1];
      if (fp !== null && !isValidFingerprint(fp)) return null;
      return isPlausibleAccountKey(parts[2]) ? { key: parts[2], fp } : null;
    }
    return isPlausibleAccountKey(text) ? { key: text, fp: null } : null;
  }

  async has(slot: KeySlot): Promise<boolean> {
    return (await this.load(slot).catch(() => null)) !== null;
  }

  async save(slot: KeySlot, key: string): Promise<void> {
    if (!isPlausibleAccountKey(key)) throw new KeyStoreError("invalid");
    if (slot.mode === "public" && !isValidFingerprint(slot.fp)) throw new KeyStoreError("invalid");
    if (!this.crypto.isAvailable()) throw new KeyStoreError("unavailable");
    addSecret(key);
    await fsp.mkdir(this.dir, { recursive: true });
    const target = this.file(slot);
    const tmp = `${target}.tmp`;
    const fp = slot.mode === "public" ? (slot.fp as string) : "-";
    await fsp.writeFile(tmp, this.crypto.encrypt(`${FORMAT}\n${fp}\n${key}`));
    await fsp.rename(tmp, target);
    if (this.recoveryDir) try {
      await fsp.mkdir(this.recoveryDir, { recursive: true });
      const backup = path.join(this.recoveryDir, `${serverId(slot.host, slot.port, slot.mode)}.txt`);
      await fsp.writeFile(`${backup}.tmp`, `${FORMAT}\n${fp}\n${key}`, { mode: 0o600 });
      await fsp.rename(`${backup}.tmp`, backup);
    } catch { log.warn("Automatic Documents account backup could not be written"); }
  }

  // The key for this slot, or null. A public server's key is returned only for the exact
  // certificate it was saved with.
  async load(slot: KeySlot): Promise<string | null> {
    const stored = await this.read(slot);
    if (!stored) return null;
    if (slot.mode === "public" && (slot.fp === null || stored.fp !== slot.fp)) return null;
    addSecret(stored.key);
    if (this.recoveryDir) {
      const backup = path.join(this.recoveryDir, `${serverId(slot.host, slot.port, slot.mode)}.txt`);
      await fsp.access(backup).catch(() => this.save(slot, stored.key)).catch(() => log.warn("Automatic Documents account backup unavailable"));
    }
    return stored.key;
  }

  // Public servers: whether a key is stored for this host:port, and which certificate it belongs
  // to (fp null = a key from before keys were tied to certificates). null = no key stored.
  async certificateOf(slot: KeySlot): Promise<{ fp: string | null } | null> {
    const stored = await this.read(slot).catch(() => null);
    return stored ? { fp: stored.fp } : null;
  }

  // Moves this host:port's key to a new certificate. Only after the user confirmed the change.
  async rebind(slot: KeySlot, fp: string): Promise<boolean> {
    if (slot.mode !== "public" || !isValidFingerprint(fp)) throw new KeyStoreError("invalid");
    const stored = await this.read(slot);
    if (!stored) return false;
    await this.save({ ...slot, fp }, stored.key);
    return true;
  }

  async remove(slot: KeySlot): Promise<void> {
    const stored = await this.read(slot).catch(() => null);
    if (stored) removeSecret(stored.key);
    await fsp.unlink(this.file(slot)).catch(() => undefined);
    if (this.recoveryDir) await fsp.unlink(path.join(this.recoveryDir, `${serverId(slot.host, slot.port, slot.mode)}.txt`)).catch(() => undefined);
  }
}

export function backupFileText(opts: {
  key: string;
  username: string | null;
  serverName: string;
  host: string;
  port: number;
  fingerprint?: string | null;
  date: Date;
}): string {
  return [
    "Dauntless Revived account key",
    "",
    `Server: ${opts.serverName} (${opts.host}:${opts.port})`,
    ...(opts.fingerprint ? [`Certificate: ${opts.fingerprint}`] : []),
    `Username: ${opts.username ?? "-"}`,
    `Saved: ${opts.date.toISOString().slice(0, 10)}`,
    `Key: ${opts.key}`,
    "",
    "Keep this file private: anyone who has this key can play as you on this server.",
    "To use it on another PC: Dauntless Revived Launcher > Join > Load a backup file.",
    "",
  ].join("\r\n");
}

// Reads a file written by backupFileText (CRLF or LF line breaks). The server it names is checked
// like an invite's: a public server needs its certificate, and plain HTTP stays inside the tailnet.
export function parseBackupFile(text: string): (Omit<Invite, "code" | "share"> & { key: string }) | null {
  const server = /^Server: (.*) \(([^()\s]+):(\d+)\)\s*$/m.exec(text);
  const cert = /^Certificate:(.*)$/m.exec(text);
  const key = extractAccountKey(text);
  if (!server || !key) return null;
  const name = cleanServerName(server[1]);
  const host = server[2].toLowerCase();
  const fp = cert ? cert[1].trim() : null;
  if (name === null || !isValidHost(host) || !isValidPort(server[3])) return null;
  if (fp !== null ? !isValidFingerprint(fp) : !isPrivateModeHost(host)) return null;
  return { mode: fp !== null ? "public" : "private", host, port: Number(server[3]), fp, name, key };
}
