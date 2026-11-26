// Início › Agenda: everything dated ahead, 30 or 90 days, by month: card bills, contas do mês, renewals, maturities and
// the forecast salary. A filter keeps only what there is to pay.
import { brl, daysBetween, esc, MESES, ddmm } from "../../lib/format.js";
import { agendaTotals, lowPoint, keptShort } from "../../lib/agenda.js";
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
    ${cashCard(v, (v.agenda || []).filter((e) => e.late || daysBetween(v.today, e.date) <= +range))}
    <div class="card"><div class="label">No período</div><div class="split">
      <div class="tile"><span class="muted sm">A pagar</span><b>${brl(tot.pay)}</b><span class="muted sm">${tot.reserve ? `${brl(tot.out)} da conta · ${brl(tot.reserve)} da reserva` : "faturas e contas"}</span></div>
      <div class="tile"><span class="muted sm">Entra</span><b class="ok">${brl(tot.in)}</b><span class="muted sm">salário previsto</span></div>
    </div></div>
    ${months.length ? months.map((g) => `<div class="card"><div class="label">${esc(head(g.m))}</div><div class="tl mt6">${g.rows.map((e) => agendaRow(e, { balance: true })).join("")}</div></div>`).join("")
      : '<div class="card empty"><b>Nada neste período</b>Nenhuma conta, vencimento ou renovação.</div>'}
    <div class="muted xs">"~" = valor de referência; faturas futuras: a média das últimas 6, ou as parcelas já lançadas se forem mais; o valor certo aparece quando a cobrança entra. Contas do mês e renovações: Ajustes › Contas.</div>`;
}

// The checking account over the period: today, the lowest point, and what to bring from the reserve if it goes below 0.
function cashCard(v, list) {
  if (!v.cash) return "";
  const low = lowPoint(list), c = v.cash, ks = keptShort(list);
  const short = low && low.balance < 0 ? -low.balance : 0;
  const kept = c.earmark ? `<div class="muted sm mt6">Reserva Nubank ${brl(c.reserve)}: <b>${brl(c.earmark)}</b> para a fatura + ${brl(c.free)} livre.${ks ? ` <b class="bad">A fatura de ${ddmm(ks.date)} passa a reserva em ${brl(ks.short)}</b>: complete antes.` : ""}</div>` : "";
  return `<div class="card${short ? " alert-card" : ""}"><div class="row"><div class="label">Saldo previsto na conta</div><span class="muted sm">hoje ${brl(c.checking)}</span></div>
    ${low ? `<div class="hero-row mt6"><span class="kpi${short ? " bad" : ""}">${brl(low.balance)}</span><span class="muted">no ponto mais baixo, ${ddmm(low.date)}</span></div>` : '<div class="muted sm mt6">Nada sai da conta neste período.</div>'}
    <div class="muted sm">${short ? `Faltam <b>${brl(short)}</b>: resgate da reserva (${brl(c.free)} livre, liquidez diária) antes de ${ddmm(low.date)}.` : `Conta mais a reserva livre: ${brl(c.checking + c.free)}.`}</div>${kept}
    <div class="muted xs mt6">Contas correntes suas (sem a conjunta), menos faturas e contas a pagar, mais o salário previsto${c.earmark ? "; a fatura Nubank sai da reserva" : ""}. Faturas futuras pela média das últimas 6.</div></div>`;
}

export function bind(pane, t, ctx, { repaint }) {
  pane.onclick = (e) => {
    const r = e.target.closest("[data-r]")?.dataset.r, o = e.target.closest("[data-o]")?.dataset.o;
    if (r) { range = r; repaint(); }
    if (o) { only = o; repaint(); }
  };
}
