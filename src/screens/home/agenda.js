// Início › Agenda: everything dated ahead, 30 or 90 days, by month: card bills, contas do mês, renewals, maturities and
// the forecast salary. A filter keeps only what there is to pay.
import { brl, daysBetween, esc, MESES } from "../../lib/format.js";
import { agendaTotals } from "../../lib/agenda.js";
import { agendaRow } from "../../ui/agenda.js";

export const id = "agenda";
export const label = "Agenda";

let range = "30", only = "all";
const KINDS = { all: () => true, pay: (e) => e.pay, in: (e) => e.kind === "salary", mat: (e) => e.kind === "maturity" || e.kind === "renewal" };

export function render(t) {
  const { v } = t;
  const list = (v.agenda || []).filter((e) => (e.late || daysBetween(v.today, e.date) <= +range) && KINDS[only](e));
  const tot = agendaTotals(list);
  const months = [];
  for (const e of list) {
    const m = e.late ? "late" : e.date.slice(0, 7);
    if (months.at(-1)?.m !== m) months.push({ m, rows: [] });
    months.at(-1).rows.push(e);
  }
  const head = (m) => (m === "late" ? "Atrasadas" : `${MESES[Number(m.slice(5)) - 1]}${m.slice(0, 4) !== v.today.slice(0, 4) ? ` ${m.slice(0, 4)}` : ""}`);
  return `<div class="seg">${[["30", "30 dias"], ["90", "90 dias"]].map(([k, l]) => `<button data-r="${k}" class="${k === range ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="seg mt6">${[["all", "Tudo"], ["pay", "A pagar"], ["in", "Entra"], ["mat", "Vence · renova"]].map(([k, l]) => `<button data-o="${k}" class="${k === only ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card"><div class="split">
      <div class="tile"><span class="muted sm">A pagar</span><b>${brl(tot.out)}</b><span class="muted sm">faturas e contas</span></div>
      <div class="tile"><span class="muted sm">Entra</span><b class="ok">${brl(tot.in)}</b><span class="muted sm">salário previsto</span></div>
    </div></div>
    ${months.length ? months.map((g) => `<div class="card"><div class="label">${esc(head(g.m))}</div><div class="tl mt6">${g.rows.map(agendaRow).join("")}</div></div>`).join("")
      : '<div class="card empty"><b>Nada neste período</b>Nenhuma conta, vencimento ou renovação.</div>'}
    <div class="muted xs">"~" = valor de referência ou só as parcelas já lançadas; o valor certo aparece quando a cobrança entra. Contas do mês e renovações vêm do arquivo de regras.</div>`;
}

export function bind(pane, t, ctx, { repaint }) {
  pane.onclick = (e) => {
    const r = e.target.closest("[data-r]")?.dataset.r, o = e.target.closest("[data-o]")?.dataset.o;
    if (r) { range = r; repaint(); }
    if (o) { only = o; repaint(); }
  };
}
