// Gastos › Buscar: every spending row whose merchant, category or group matches the words typed (accents and case
// ignored; every word must match). Refunds net against the charges, as everywhere else.
import { CLUSTERS } from "./spend.js";

const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));
const plain = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const merchantText = (desc) => String(desc || "").split("|").at(-1).trim();

// rows: spendRows(). key: "cyc" (card cycles) or "m". → { n, total, year, last12, byPeriod: { id: amount }, rows } (newest first).
export function search(rows, q, { key = "m", today, periods = [] }) {
  const words = plain(q).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return null;
  const hits = rows.filter((r) => !r.hist && !r.ahead && r.d <= today && (() => {
    const hay = plain(`${merchantText(r.desc)} ${r.cat} ${GROUP[r.cluster] || ""}`);
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
