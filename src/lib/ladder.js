// Maturity ladder: the owner's fixed-income money spread evenly across rungs of time-to-maturity.
// The 0–3m reserve is the daily-liquidity money (Nubank), so the ladder itself starts at "≤ 6 months".
// CDBs can't be sold early without a loss, so the ladder is evened out by reinvesting each maturity: every slice goes
// to the term that leaves the distribution closest to equal over the following 12 months (rungs age, so judging only
// the purchase day drifts). No interest is modelled; it only sizes the split.

export const RUNGS = [
  { max: 6, label: "≤6m" }, { max: 12, label: "6–12m" }, { max: 18, label: "12–18m" },
  { max: 24, label: "18–24m" }, { max: 36, label: "24–36m" }, { max: Infinity, label: "36m+" },
];
export const TERMS = [6, 9, 12, 15, 18, 24, 30, 36, 48];
const SLICE = 7000, MAX_SLICES = 4, LOOK = 12;

const D = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
function addMonths(isoDate, n) {
  const d = D(isoDate);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  t.setUTCDate(Math.min(d.getUTCDate(), 28));
  return iso(t);
}
const months = (from, to) => (D(to) - D(from)) / 864e5 / 30.44;
const rungOf = (due, at) => RUNGS.findIndex((r) => months(at, due) <= r.max);

export function amounts(pos, at) {
  const out = RUNGS.map(() => 0);
  for (const p of pos) if (p.due > at) out[rungOf(p.due, at)] += p.amount;
  return out;
}
export function shares(pos, at) {
  const a = amounts(pos, at), s = a.reduce((x, y) => x + y, 0) || 1;
  return a.map((x) => x / s);
}
function cost(pos, at) {
  const t = 1 / RUNGS.length;
  let c = 0;
  for (let k = 0; k <= LOOK; k++) c += shares(pos, addMonths(at, k)).reduce((a, x) => a + (x - t) ** 2, 0);
  return c;
}

// rows: maturity groups { due, balance, issuer, tag }, every account's (the joint one included).
// Returns today's rungs, a reinvestment plan for the maturities in the next `horizon` months, and the distribution
// at the end of that horizon with and without following it.
export function ladder(rows, { today, horizon = 12 }) {
  const pos = rows.filter((r) => r.due > today).map((r) => ({ due: r.due, amount: r.balance }));
  const base = pos.map((p) => ({ ...p }));
  const total = pos.reduce((a, p) => a + p.amount, 0);
  const target = total / RUNGS.length;
  const now = amounts(pos, today).map((amount, k) => ({ ...RUNGS[k], amount, share: total ? amount / total : 0, gap: amount - target }));
  const end = addMonths(today, horizon);
  const plan = [];
  for (const due of [...new Set(rows.filter((r) => r.due > today && r.due <= end).map((r) => r.due))].sort()) {
    const here = rows.filter((r) => r.due === due);
    const cash = here.reduce((a, r) => a + r.balance, 0);
    const n = Math.min(MAX_SLICES, Math.max(1, Math.ceil(cash / SLICE)));
    const buys = new Map();
    for (let i = 0; i < n; i++) {
      let best = TERMS[0], bestCost = Infinity;
      for (const t of TERMS) {
        const c = cost([...pos, { due: addMonths(due, t), amount: cash / n }], due);
        if (c < bestCost) { bestCost = c; best = t; }
      }
      pos.push({ due: addMonths(due, best), amount: cash / n });
      buys.set(best, (buys.get(best) || 0) + cash / n);
    }
    plan.push({ due, amount: cash, issuers: [...new Set(here.map((r) => r.issuer))], brb: here.some((r) => r.tag === "brb"), buys: [...buys].sort((a, b) => a[0] - b[0]).map(([months, amount]) => ({ months, amount })) });
  }
  return { total, target, now, plan, end, without: shares(base, end), with: shares(pos, end) };
}
