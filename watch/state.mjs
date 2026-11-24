// The watcher's memory between runs: Telegram decisions, which message carries which decision, the Telegram update
// offset, and which outcomes were already reported. Stored encrypted (AES-256-GCM, key in an Actions secret) as
// state.enc on the watch-state branch: the repository is public, the file is not readable without the key.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

// messages: { [n]: { id, d, text, at, mid } } — n is in the buttons' callback data, mid is the Telegram message id.
export const EMPTY = { v: 1, offset: 0, seq: 0, decisions: {}, messages: {}, reported: {} };

async function key(b64) {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("COFRE_STATE_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(state, b64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(b64), new TextEncoder().encode(JSON.stringify(state)));
  return JSON.stringify({ v: 1, iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") });
}

export async function unseal(text, b64) {
  const { iv, ct } = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, await key(b64), Buffer.from(ct, "base64"));
  return { ...EMPTY, ...JSON.parse(new TextDecoder().decode(pt)) };
}

export async function load(path, b64) {
  return existsSync(path) ? unseal(readFileSync(path, "utf8"), b64) : structuredClone(EMPTY);
}

export async function save(path, state, b64) {
  writeFileSync(path, await seal(state, b64));
}
