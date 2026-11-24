// The two files that carry decisions between the phone and Telegram, both sealed with the sync key (src/lib/seal.js):
//   the watcher's state.enc on the repo's watch-state branch: public ciphertext, read without a token;
//   the phone's phone.enc in a secret gist: written with a token that can only touch gists, never the repository.
import { seal, unseal } from "./seal.js";

const API = "https://api.github.com";
export const PHONE_FILE = "phone.enc";

// → { decisions, undone } as the watcher has them, or null before its first run.
export async function pullWatcher({ repo, key, fetch = globalThis.fetch }) {
  const r = await fetch(`${API}/repos/${repo}/contents/state.enc?ref=watch-state`, { headers: { accept: "application/vnd.github.raw" }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 403 ? "limite do GitHub, tento de novo depois" : `GitHub ${r.status}`);
  const s = await unseal(await r.text(), key);
  return { decisions: s.decisions || {}, undone: s.undone || {} };
}

export async function pushPhone({ gist, token, key, value, fetch = globalThis.fetch }) {
  const r = await fetch(`${API}/gists/${gist}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ files: { [PHONE_FILE]: { content: await seal(value, key) } } }),
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 || r.status === 404 ? "token do gist recusado" : `GitHub ${r.status}`);
}
