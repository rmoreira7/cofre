// Charges that come back every month (a subscription, a plan, a PIX to the same person) and are not yet a conta do mês
// or a renewal: offered in Ajustes › Contas, prefilled, so a forgotten one gets a due date and a check.
import { merchantOf } from "./model.js";
import { daysBetween } from "./format.js";

const WINDOW = 200;   // days of history looked at
const ACTIVE = 45;    // the last charge at most this many days ago
const TOLERANCE = 0.2; // each charge within ±20 % of the usual amount
const SKIP = new Set(["Interests charged", "Tax on financial operations", "Proceeds interests and dividends"]);
const monthly = (g) => g >= 20 && g <= 40, skipped = (g) => g >= 52 && g <= 70; // one month missed
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const plain = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "");

// Some issuers pad the merchant to a fixed width and add the city and country ("LOJA X      CIDADE      BR"), and only
// on some months: the merchant is what comes before the padding.
const merchant = (desc) => merchantOf(desc).split(/\s{3,}/)[0].trim();
export const recurringKey = (r) => `${r.src}:${merchant(r.desc).toLowerCase().replace(/\s+/g, " ")}`;

// Covered: a conta's match text is in the charge, or a renewal's name and the merchant contain one another (single
// words would match too much: "clube" is in more than one plan).
function covered(desc, lists) {
  const d = String(desc || "").toLowerCase(), p = plain(merchant(desc));
  if ((lists.monthly || []).some((m) => (m.match || []).some((x) => d.includes(x.toLowerCase())))) return true;
  return p.length >= 5 && (lists.renewals || []).some((r) => { const w = plain(r.name); return w.length >= 5 && (p.includes(w) || w.includes(p)); });
}

// rows: spendRows(). → [{ key, name, src, card, amount, day | every, match, last, n }], the most recent first.
export function recurring(rows, { lists = {}, ignored = [], today }) {
  const groups = new Map();
  for (const r of rows) {
    if (r.amt <= 0 || r.inst || r.hist || SKIP.has(r.cat) || daysBetween(r.d, today) > WINDOW) continue;
    const k = recurringKey(r);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const out = [];
  for (const [key, xs] of groups) {
    if (ignored.includes(key)) continue;
    xs.sort((a, b) => a.d.localeCompare(b.d));
    // The trailing run of roughly monthly charges (a single missed month allowed).
    let i = xs.length - 1, good = 0;
    while (i > 0) {
      const g = daysBetween(xs[i - 1].d, xs[i].d);
      if (monthly(g)) good++; else if (!skipped(g)) break;
      i--;
    }
    const run = xs.slice(i);
    if (good < 2 || daysBetween(run.at(-1).d, today) > ACTIVE) continue;
    const usual = median(run.map((x) => x.amt));
    if (!run.every((x) => Math.abs(x.amt - usual) <= usual * TOLERANCE)) continue;
    const last = run.at(-1);
    if (covered(last.desc, lists)) continue;
    const days = run.map((x) => Number(x.d.slice(8, 10)));
    // A fixed day of the month when the charges keep to it (month ends wrap: the 30th and the 2nd are 3 days apart).
    const day = Math.round(median(days)), drift = Math.max(...days.map((d) => Math.min(Math.abs(d - day), 31 - Math.abs(d - day))));
    const name = merchant(last.desc);
    out.push({
      key, name: name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()), src: last.src, card: last.src === "card",
      amount: Math.round(last.amt * 100) / 100, match: [name],
      ...(drift <= 4 ? { day: Math.min(28, day) } : { every: Math.round(median(run.slice(1).map((x, j) => daysBetween(run[j].d, x.d)).filter(monthly))) }),
      last: last.d, n: run.length,
    });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}
