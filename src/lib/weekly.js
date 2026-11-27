// The Monday message's week: what the past week (Monday to Sunday) cost and how the cycle stands. Built on the phone
// (the watcher has no categorization rules) for the current and the previous week, so a phone last opened on a Sunday
// still has the week the watcher sends on Monday; `at` says how far the phone's data went.
import { brl } from "./format.js";
import { niceName } from "./recurring.js";
import { paceLabel } from "./pace.js";

const plus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const weekStart = (iso) => plus(iso, -((new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7));
const TOP = 3;

export function weekSummary(v, start) {
  const end = plus(start, 6);
  const rows = v.rows.filter((r) => !r.hist && !r.ahead && r.d >= start && r.d <= end && r.d <= v.today);
  const by = new Map();
  for (const r of rows) {
    const c = (v.month.clusters || []).find((x) => x.id === r.cluster);
    const g = by.get(r.cluster) || { label: c?.label || "Outros", spent: 0 };
    g.spent += r.amt; by.set(r.cluster, g);
  }
  const groups = [...by.values()].filter((g) => g.spent > 0.5).sort((a, b) => b.spent - a.spent);
  const buys = rows.filter((r) => r.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, TOP).map((r) => ({ name: niceName(r.desc), amount: r.amt, d: r.d }));
  const m = v.month, p = v.pace;
  return {
    start, end, at: v.today, total: rows.reduce((s, r) => s + r.amt, 0), n: rows.filter((r) => r.amt > 0).length, groups, buys,
    cycle: m?.month ? { spent: m.spent, target: m.target, daysLeft: m.daysLeft, over: m.over, pace: p ? paceLabel(p, brl) : null } : null,
  };
}

export const weeksForPhone = (v) => { const cur = weekStart(v.today); return [weekSummary(v, plus(cur, -7)), weekSummary(v, cur)]; };

export function validWeeks(w) {
  return Array.isArray(w) && w.every((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.start) && /^\d{4}-\d{2}-\d{2}$/.test(x.at) && Number.isFinite(x.total) && Array.isArray(x.groups) && Array.isArray(x.buys));
}

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// The past week's lines for the Monday message (week = the one ending yesterday), or [] when the phone has not sent it.
export function weekLines(weeks, today) {
  const start = plus(weekStart(today), -7);
  const w = (weeks || []).find((x) => x.start === start);
  if (!w) return [];
  const L = [`🧾 <b>Semana passada</b> · <b>${brl(w.total)}</b> em ${w.n} ${w.n === 1 ? "compra" : "compras"}`];
  if (w.at < w.end) L.push(`<i>dados até ${ddmm(w.at)} (o Cofre não abriu depois)</i>`);
  const top = w.groups.slice(0, TOP).map((g) => `${esc(g.label)} ${brl(g.spent)}`);
  const rest = w.groups.slice(TOP);
  if (top.length) L.push(`• ${top.join(" · ")}${rest.length ? ` · + ${brl(rest.reduce((s, g) => s + g.spent, 0))}` : ""}`);
  if (w.buys.length) L.push(`• maiores: ${w.buys.map((b) => `${esc(b.name)} ${brl(b.amount)}`).join(" · ")}`);
  const c = w.cycle;
  if (c) L.push(`📊 <b>Ciclo</b> ${brl(c.spent)} de ${brl(c.target)}${c.pace ? ` · ${esc(c.pace)}` : ""} · ${c.daysLeft === 1 ? "falta 1 dia" : `faltam ${c.daysLeft} dias`}`);
  return L;
}
