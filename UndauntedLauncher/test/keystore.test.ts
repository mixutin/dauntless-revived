// The key store: a public server's key belongs to one certificate fingerprint.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupFileText, KeyStore, KeyStoreError, parseBackupFile, serverId, type Encryptor, type KeySlot } from "../src/main/keystore";

const enc: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from("enc:" + Buffer.from(plain).toString("base64")),
  decrypt: (data) => {
    const s = data.toString();
    if (!s.startsWith("enc:")) throw new Error("not ours");
    return Buffer.from(s.slice(4), "base64").toString();
  },
};
const dirs: string[] = [];
function store(): { ks: KeyStore; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "dr-keys-"));
  dirs.push(dir);
  return { ks: new KeyStore(dir, enc), dir };
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const KEY = "UUK_" + "ab".repeat(24);
const FP_A = "a1".repeat(32);
const FP_B = "b2".repeat(32);
const pub = (fp: string | null): KeySlot => ({ host: "203.0.113.10", port: 443, mode: "public", fp });

test("a public key loads only for the certificate it was saved with", async () => {
  const { ks } = store();
  await ks.save(pub(FP_A), KEY);
  assert.equal(await ks.load(pub(FP_A)), KEY);
  assert.equal(await ks.has(pub(FP_A)), true);
  assert.equal(await ks.load(pub(FP_B)), null, "another certificate never gets the key");
  assert.equal(await ks.has(pub(FP_B)), false);
  assert.equal(await ks.load(pub(null)), null);
  assert.deepEqual(await ks.certificateOf(pub(FP_B)), { fp: FP_A });
});

test("rebind moves the key to a new certificate", async () => {
  const { ks } = store();
  await ks.save(pub(FP_A), KEY);
  assert.equal(await ks.rebind(pub(FP_A), FP_B), true);
  assert.equal(await ks.load(pub(FP_B)), KEY);
  assert.equal(await ks.load(pub(FP_A)), null);
  assert.equal(await store().ks.rebind(pub(FP_A), FP_B), false, "nothing to move");
  await assert.rejects(ks.rebind(pub(FP_B), "not-a-fingerprint"), KeyStoreError);
});

test("a public key cannot be saved without a fingerprint", async () => {
  const { ks } = store();
  await assert.rejects(ks.save(pub(null), KEY), KeyStoreError);
  await assert.rejects(ks.save(pub("ABC"), KEY), KeyStoreError);
});

test("private keys are not tied to a certificate; old key files still load for private servers only", async () => {
  const { ks, dir } = store();
  const priv: KeySlot = { host: "100.64.0.1", port: 61000, mode: "private", fp: null };
  await ks.save(priv, KEY);
  assert.equal(await ks.load(priv), KEY);
  // The first file format: the key alone.
  writeFileSync(path.join(dir, `${serverId("100.64.0.2", 61000, "private")}.key`), enc.encrypt(KEY));
  assert.equal(await ks.load({ host: "100.64.0.2", port: 61000, mode: "private", fp: null }), KEY);
  writeFileSync(path.join(dir, `${serverId("203.0.113.10", 443, "public")}.key`), enc.encrypt(KEY));
  assert.equal(await ks.load(pub(FP_A)), null, "an untied public key goes nowhere");
  assert.deepEqual(await ks.certificateOf(pub(FP_A)), { fp: null });
});

test("remove deletes the key whatever certificate it belongs to", async () => {
  const { ks } = store();
  await ks.save(pub(FP_A), KEY);
  await ks.remove(pub(FP_B));
  assert.equal(await ks.certificateOf(pub(FP_A)), null);
});

test("Documents recovery survives lost local key storage and keeps certificate binding", async () => {
  const { dir } = store();
  const recovery = path.join(dir, "Documents");
  const primary = path.join(dir, "local");
  const ks = new KeyStore(primary, enc, recovery);
  await ks.save(pub(FP_A), KEY);
  rmSync(primary, {recursive:true, force:true});
  const restored = new KeyStore(primary, enc, recovery);
  assert.equal(await restored.load(pub(FP_B)), null);
  assert.equal(await restored.load(pub(FP_A)), KEY);
  await restored.remove(pub(FP_A));
  assert.equal(await restored.load(pub(FP_A)), null);
});

test("a backup file gives back its server and key, with CRLF or LF line breaks", () => {
  const text = backupFileText({ key: KEY, username: "Slayer_42", serverName: "Friday (EU) Hunts", host: "hunts.example.com", port: 8443, fingerprint: FP_A, date: new Date() });
  const want = { mode: "public", host: "hunts.example.com", port: 8443, fp: FP_A, name: "Friday (EU) Hunts", key: KEY };
  assert.match(text, /\r\nKey: /);
  assert.match(text, /Join > Load a backup file\./, "the instruction matches the Join screen");
  assert.deepEqual(parseBackupFile(text), want);
  assert.deepEqual(parseBackupFile(text.replace(/\r\n/g, "\n")), want);
  assert.deepEqual(parseBackupFile(text.replace("Join > Load", "Join > Use an existing key > Load")), want, "older backups still load");
});

test("a backup file without a certificate is only accepted for a private-mode host", () => {
  const file = (host: string): string => backupFileText({ key: KEY, username: null, serverName: "Home", host, port: 61000, date: new Date() });
  assert.equal(parseBackupFile(file("203.0.113.10")), null, "a public address needs its certificate");
  assert.deepEqual(parseBackupFile(file("100.101.102.103")), { mode: "private", host: "100.101.102.103", port: 61000, fp: null, name: "Home", key: KEY });
});

test("a backup file with a bad port, host or certificate, or without a key, is refused", () => {
  const good = backupFileText({ key: KEY, username: "Slayer_42", serverName: "Friday Hunts", host: "203.0.113.10", port: 443, fingerprint: FP_A, date: new Date() });
  assert.ok(parseBackupFile(good));
  const bad: [string, string][] = [
    ["port", good.replace(":443)", ":70000)")],
    ["host", good.replace("203.0.113.10", "1.2.3")],
    ["certificate", good.replace(FP_A, FP_A.slice(1))],
    ["certificate case", good.replace(FP_A, FP_A.toUpperCase())],
    ["key", good.replace(/^Key: .*$/m, "Key:")],
  ];
  for (const [what, text] of bad) assert.equal(parseBackupFile(text), null, what);
});
