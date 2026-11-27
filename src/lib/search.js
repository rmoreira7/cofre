// Gastos › Buscar: every spending row whose merchant, category or group matches the words typed (accents and case
// ignored; every word must match). Refunds net against the charges, as everywhere else.
import { CLUSTERS } from "./spend.js";
import { niceName, storeKey } from "./recurring.js";

const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));
const plain = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const merchantText = (desc) => String(desc || "").split("|").at(-1).trim();

// rows: spendRows(). key: "cyc" (card cycles) or "m". → { n, total, year, last12, byPeriod: { id: amount }, rows } (newest first).
export function search(rows, q, { key = "m", today, periods = [] }) {
  const words = plain(q).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return null;
  const hits = rows.filter((r) => !r.hist && !r.ahead && r.d <= today && (() => {
    const hay = plain(`${merchantText(r.desc)} ${niceName(r.desc)} ${r.cat} ${GROUP[r.cluster] || ""}`);
    return words.every((w) => hay.includes(w));
  })()).sort((a, b) => b.d.localeCompare(a.d) || b.amt - a.amt);
  const byPeriod = {};
  for (const r of hits) byPeriod[r[key]] = (byPeriod[r[key]] || 0) + r.amt;
  const shown = periods.slice(-12);
  const sum = (xs) => xs.reduce((s, r) => s + r.amt, 0);
  return {
    n: hits.filter((r) => r.amt > 0).length,
    total: sum(hits),
    year: sum(hits.filter((r) => r.d.slice(0, 4) === today.slice(0, 4))),
    last12: shown.reduce((s, p) => s + (byPeriod[p] || 0), 0),
    periods: shown,
    byPeriod,
    rows: hits,
  };
}

// Where the money goes most: stores by what they cost in the last 12 periods (refunds net), against the 12 before.
// The 12 before come from the card statements, so only a store paid by card alone gets the comparison (prev: null).
// periods: every period id, oldest first, the current one last. → [{ key, name, total, n, perMonth, prev, cluster }]
export function topStores(rows, { key = "m", today, periods = [], n = 15 }) {
  const last = new Set(periods.slice(-12)), before = new Set(periods.slice(-24, -12));
  const m = new Map();
  for (const r of rows) {
    if (r.ahead || r.d > today) continue;
    const inLast = !r.hist && last.has(r[key]), inBefore = before.has(r[key]);
    if (!inLast && !inBefore) continue;
    const k = storeKey(r.desc);
    if (!k) continue;
    const x = m.get(k) || { key: k, name: niceName(r.desc), total: 0, n: 0, prev: 0, card: true, clusters: new Map() };
    if (r.src !== "card") x.card = false;
    if (inLast) { x.total += r.amt; if (r.amt > 0) x.n++; x.clusters.set(r.cluster, (x.clusters.get(r.cluster) || 0) + Math.max(0, r.amt)); }
    else x.prev += r.amt;
    m.set(k, x);
  }
  const months = Math.max(1, Math.min(12, last.size));
  return [...m.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, n).map(({ clusters, card, prev, ...x }) => ({
    ...x, perMonth: x.total / months, prev: card && before.size ? prev : null,
    cluster: [...clusters].sort((a, b) => b[1] - a[1])[0]?.[0] || "other",
  }));
}
