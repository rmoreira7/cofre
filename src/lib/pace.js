// How the current period is going against the usual one: by this point of a past cycle, what share of its spending had
// already gone out (the median of the last six). Spending is not linear (the market at the start, a subscription on
// its day), so "R$ 3 mil in on day 10" is compared with what the owner usually has spent by day 10, not with 10/30 of
// the target. Plus what is already known to come before the close (contas do mês, renewals), so the daily allowance
// is what is really free.
import { cycleBounds } from "./spend.js";
import { nextMonthly, monthlyPayment, upcomingRenewals } from "./decisions.js";
import { daysBetween } from "./format.js";

const PAST = 6, MIN_PAST = 3, NEAR = 0.05, EARLY = 0.2; // within 5 % of the target = on pace; no verdict in the first 20 %
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function boundsOf(label, cycles) {
  if (cycles) { const b = cycleBounds(label, cycles); return b && { start: b.start, end: addDays(b.end, -1) }; }
  const [y, m] = label.split("-").map(Number);
  return { start: `${label}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

// month: monthView(). → { share, usual (past cycles used), expected, delta, projected, committed: [{ name, date, amount }],
// committedTotal, free, perDay, tone }
export function pace(month, { rows, cycles = null, monthly = [], renewals = [], snapshot = null, today }) {
  const key = cycles ? "cyc" : "m";
  const elapsed = Math.min(1, (daysBetween(month.start, today) + 1) / month.length);
  const shares = [];
  for (const h of month.history.slice(0, -1).reverse()) {
    if (shares.length === PAST) break;
    const b = boundsOf(h.month, cycles);
    const xs = rows.filter((r) => r[key] === h.month && !r.hist);
    const total = xs.reduce((a, r) => a + r.amt, 0);
    if (!b || total <= 0) continue;
    const len = daysBetween(b.start, b.end) + 1;
    const cut = addDays(b.start, Math.round(elapsed * len) - 1);
    shares.push(xs.filter((r) => r.d <= cut).reduce((a, r) => a + r.amt, 0) / total);
  }
  const usual = shares.length >= MIN_PAST;
  const share = usual ? Math.min(1, Math.max(0, median(shares))) : elapsed;
  const expected = month.target * share, delta = month.spent - expected;
  const early = elapsed < EARLY;
  const projected = !early && share >= 0.1 && month.daysLeft > 1 ? month.spent / share : null;
  // Known to come before the close and not paid yet. A conta on the card counts on the day it is charged; the
  // renewals with a price, on their date.
  const committed = [];
  for (const m of nextMonthly(monthly, today, snapshot)) {
    if (m.amount == null || m.due <= today || m.due > month.end || monthlyPayment(snapshot, m, m.due)) continue;
    committed.push({ name: m.name, date: m.due, amount: m.amount });
  }
  for (const r of upcomingRenewals(renewals, today, daysBetween(today, month.end))) {
    if (r.amount != null && r.date > today) committed.push({ name: r.name, date: r.date, amount: r.amount });
  }
  committed.sort((a, b) => a.date.localeCompare(b.date));
  const committedTotal = committed.reduce((a, c) => a + c.amount, 0);
  const free = month.target - month.spent - committedTotal;
  const tone = month.over ? "bad" : early ? "" : delta > month.target * NEAR ? "warn" : delta < -month.target * NEAR ? "ok" : "";
  return { early, share, usual: usual ? shares.length : 0, expected, delta, projected, committed, committedTotal, free, perDay: free > 0 ? free / month.daysLeft : 0, tone };
}

// "R$ 400 acima do ritmo" / "abaixo" / "no ritmo", for a chip.
export const paceLabel = (p, brl) => (p.tone === "bad" ? "acima da meta" : p.early ? "começo do ciclo" : p.tone === "warn" ? `${brl(p.delta)} acima do ritmo` : p.tone === "ok" ? `${brl(-p.delta)} abaixo do ritmo` : "no ritmo");
