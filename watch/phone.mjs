// The phone's decisions, read from the secret gist the app writes (src/lib/remote.js), sealed with the same key as the
// watcher's state, and merged in (src/lib/sync.js). The watcher never writes the gist: one writer per file.
import { unseal } from "../src/lib/seal.js";
import { merge, canon } from "../src/lib/sync.js";
import { validMonthly, validRenewals } from "../src/lib/decisions.js";

export const PHONE_FILE = "phone.enc";

// Returns a log word: "off" (no gist configured), "error", or how many decisions it changed.
export async function pullPhone(state, { gist, key, owner = process.env.GITHUB_REPOSITORY_OWNER || "rmoreira7", fetch = globalThis.fetch, now = Date.now() }) {
  if (!gist) return "off";
  let phone;
  try {
    // The raw CDN caches for a few minutes; the query string asks for the current revision.
    const r = await fetch(`https://gist.githubusercontent.com/${owner}/${gist}/raw/${PHONE_FILE}?t=${now}`, { signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return "0";
    if (!r.ok) throw new Error(r.status);
    phone = await unseal(await r.text(), key);
  } catch (e) {
    console.log(`phone: ${e.message}`);
    return "error";
  }
  const m = merge([state, phone], now);
  let changed = 0;
  for (const id of new Set([...Object.keys(state.decisions), ...Object.keys(m.decisions)])) {
    if (canon(state.decisions[id]) === canon(m.decisions[id])) continue;
    delete state.reported[id];
    changed++;
  }
  state.decisions = m.decisions;
  state.undone = m.undone;
  // The phone's own contas do mês and renewals (Ajustes › Contas), kept so a run that cannot read the gist still has them.
  const l = phone.lists;
  if (l && validMonthly(l.monthly || []) && validRenewals(l.renewals || []) && !((state.lists?.ts || 0) > (l.ts || 0))) state.lists = l;
  // The month-end summary the phone built (src/lib/closing.js): sent once per period by run.mjs.
  const c = phone.closing;
  if (c && /^\d{4}-\d{2}$/.test(c.id) && Number.isFinite(c.spent) && c.id !== state.closing?.id) state.closing = { ...c, sent: false };
  return String(changed);
}
