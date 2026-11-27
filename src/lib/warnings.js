// Mid-cycle warnings for Telegram: a group past its limit, the cycle past its target, or spending well above the usual
// pace. Built on the phone (the watcher has no categorization rules), sent once each per cycle by watch/run.mjs.
import { brl } from "./format.js";

const PACE_OVER = 1.1; // projected at least 10 % over the target

// v: buildView(). → { cycle, daysLeft, items: [{ id, kind: "group" | "target" | "pace", ... }] } or null.
export function cycleWarnings(v) {
  const m = v.month;
  if (!m?.month) return null;
  const items = [];
  if (m.over) items.push({ id: "target", kind: "target", spent: m.spent, target: m.target });
  else if (v.pace?.tone === "warn" && v.pace.projected > m.target * PACE_OVER) items.push({ id: "pace", kind: "pace", spent: m.spent, expected: v.pace.expected, projected: v.pace.projected, target: m.target });
  const trip = (v.projects || []).reduce((s, p) => s + (p.open || 0), 0);
  for (const c of m.clusters || []) {
    if (!c.over || c.limit == null) continue;
    items.push({ id: `group:${c.id}`, kind: "group", label: c.label, spent: c.spent, limit: c.limit, ...(c.id === "travel" && trip > 0 && { trip }) });
  }
  return { cycle: m.month, at: v.today, daysLeft: m.daysLeft, items };
}

export function validWarnings(w) {
  return w && /^\d{4}-\d{2}$/.test(w.cycle) && /^\d{4}-\d{2}-\d{2}$/.test(w.at) && Number.isInteger(w.daysLeft) && Array.isArray(w.items)
    && w.items.every((i) => i && typeof i.id === "string" && ["group", "target", "pace"].includes(i.kind) && Number.isFinite(i.spent));
}

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const left = (n) => (n <= 0 ? "o ciclo fecha hoje" : n === 1 ? "falta 1 dia para fechar o ciclo" : `faltam ${n} dias para fechar o ciclo`);

export function warningText(i, daysLeft) {
  if (i.kind === "target") return [`🔴 <b>O ciclo passou da meta</b>`, `<b>${brl(i.spent)}</b> de ${brl(i.target)} · +${brl(i.spent - i.target)}`, left(daysLeft)].join("\n");
  if (i.kind === "pace") return [`📈 <b>Gastos acima do ritmo</b>`, `<b>${brl(i.spent)}</b> até agora; o usual até aqui seria ${brl(i.expected)}`, `Nesse ritmo o ciclo fecha em ~${brl(i.projected)} (meta ${brl(i.target)})`, left(daysLeft)].join("\n");
  return [`⚠️ <b>${esc(i.label)} passou do limite</b>`, `<b>${brl(i.spent)}</b> de ${brl(i.limit)} · +${brl(i.spent - i.limit)}`, ...(i.trip ? [`inclui ${brl(i.trip)} da viagem`] : []), left(daysLeft)].join("\n");
}

// The ones not sent yet in this cycle; marks them sent in state.warned ({ cycle, ids }). Nothing once the cycle the
// phone last saw has closed (the phone was not opened since): those numbers are the Fechamento's now.
const plus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export function newWarnings(state, w, today) {
  if (!validWarnings(w) || plus(w.at, w.daysLeft) < today) return [];
  if (state.warned?.cycle !== w.cycle) state.warned = { cycle: w.cycle, ids: [] };
  const fresh = w.items.filter((i) => !state.warned.ids.includes(i.id));
  state.warned.ids.push(...fresh.map((i) => i.id));
  const days = w.daysLeft - Math.round((Date.parse(today) - Date.parse(w.at)) / 864e5);
  return fresh.map((i) => warningText(i, days));
}
