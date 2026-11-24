// The watcher's memory between runs: Telegram decisions, which message carries which decision, the Telegram update
// offset, and which outcomes were already reported. Stored encrypted (src/lib/seal.js, key in an Actions secret) as
// state.enc on the watch-state branch: the repository is public, the file is not readable without the key.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { seal as sealValue, unseal as unsealValue } from "../src/lib/seal.js";

// messages: { [n]: { id, d, text, at, mid, shown? } } — n is in the buttons' callback data, mid the Telegram message
// id, shown what the message currently says ("open" | "done" | "snoozed:<until>"). undone: { [id]: ms } (src/lib/sync.js).
export const EMPTY = { v: 1, offset: 0, seq: 0, decisions: {}, undone: {}, messages: {}, reported: {} };

export const seal = (state, key) => sealValue(state, key);
export const unseal = async (text, key) => ({ ...structuredClone(EMPTY), ...(await unsealValue(text, key)) });

export async function load(path, key) {
  return existsSync(path) ? unseal(readFileSync(path, "utf8"), key) : structuredClone(EMPTY);
}

export async function save(path, state, key) {
  writeFileSync(path, await seal(state, key));
}
