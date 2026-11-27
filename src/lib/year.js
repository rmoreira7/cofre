// Início › Seu ano: the calendar year so far, from the same per-period summaries as Histórico. A period belongs to the
// year its id names (the cycle that closes in January is "YYYY-01"). The open period counts in spending (marked);
// income and what was left come from the closed ones only, where they are final.
import { topStores } from "./search.js";

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);

// v: buildView(). → null before the first period of the year.
export function yearView(v, year = v.today.slice(0, 4)) {
  const key = v.month.cycle ? "cyc" : "m";
  const closed = Object.values(v.periods || {}).filter((p) => p.id.startsWith(year) && !p.cardOnly).sort((a, b) => a.id.localeCompare(b.id));
  const open = v.month.month.startsWith(year) ? v.month : null;
  if (!closed.length && !open) return null;
  const ids = [...closed.map((p) => p.id), ...(open ? [open.month] : [])];
  const groups = new Map();
  const add = (id, label, s) => { const g = groups.get(id) || { id, label, spent: 0 }; g.spent += s; groups.set(id, g); };
  for (const p of closed) for (const g of p.groups) add(g.id, g.label, g.spent);
  if (open) for (const c of open.clusters) if (c.spent > 0) add(c.id, c.label, c.spent);
  const closedSpent = sum(closed, (p) => p.spent);
  const ranked = [...closed].sort((a, b) => b.spent - a.spent);
  const buys = v.rows.filter((r) => r.amt > 0 && !r.hist && !r.ahead && r.d <= v.today && ids.includes(r[key])).sort((a, b) => b.amt - a.amt).slice(0, 8);
  const measured = (v.history || []).filter((m) => m.month.startsWith(year));
  return {
    year, cycle: v.month.cycle, n: closed.length, open: open ? { id: open.month, spent: open.spent, daysLeft: open.daysLeft } : null,
    spent: closedSpent + (open?.spent || 0), closedSpent, avg: closed.length ? closedSpent / closed.length : 0,
    over: closed.filter((p) => p.over).length,
    high: ranked[0] || null, low: ranked.at(-1) || null,
    income: sum(closed, (p) => p.income), left: sum(closed, (p) => p.left),
    groups: [...groups.values()].filter((g) => g.spent > 0).sort((a, b) => b.spent - a.spent),
    buys,
    stores: topStores(v.rows, { key, today: v.today, periods: ids, n: 8 }),
    wealth: v.wealth?.total ?? null,
    earned: measured.length ? { amount: sum(measured, (m) => sum(Object.values(m.banks), (b) => b.measured)), from: measured[0].from } : null,
  };
}
