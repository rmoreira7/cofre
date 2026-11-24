// Decisions made on the phone and on Telegram, merged: per decision, the latest change wins, whether it is a record
// (Feito, Adiar, Outra escolha) or an undo. An undo is kept as a tombstone ({ [id]: ms }) so it travels too: without
// it, the other side would bring the record back. Pure: the transport is src/lib/remote.js and watch/phone.mjs.
import { KEEP_DAYS } from "./decisions.js";

const DAY = 864e5;
// Records from before ts existed: noon of their day, so a change made with a clock always wins over them.
export const tsOf = (r) => r.ts ?? Date.parse(`${r.at}T12:00:00Z`);

export const forget = (undone, id, ts = Date.now()) => ({ ...(undone || {}), [id]: ts });

// sides: [{ decisions, undone }, …] → { decisions, undone }. now: drops tombstones older than KEEP_DAYS.
export function merge(sides, now = Date.now()) {
  const decisions = {}, undone = {};
  for (const s of sides) {
    for (const [id, r] of Object.entries(s?.decisions || {})) if (!decisions[id] || tsOf(r) > tsOf(decisions[id])) decisions[id] = r;
    for (const [id, t] of Object.entries(s?.undone || {})) if (!(undone[id] >= t)) undone[id] = t;
  }
  for (const [id, t] of Object.entries(undone)) {
    if (decisions[id] && tsOf(decisions[id]) > t) delete undone[id];
    else { delete decisions[id]; if (now - t > KEEP_DAYS * DAY) delete undone[id]; }
  }
  return { decisions, undone };
}

// Key-order independent, for "did anything change" (the vault and the gist are only written when it did).
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export const same = (a, b) => canon({ d: a.decisions || {}, u: a.undone || {} }) === canon({ d: b.decisions || {}, u: b.undone || {} });
