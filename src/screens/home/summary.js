// Início › Resumo: five short rows, each opening the sub-tab where it is dealt with; open decisions first.
import { brl, mil, ddmm, esc, MES } from "../../lib/format.js";
import { GO } from "../../ui/shell.js";
import { agendaRow } from "../../ui/agenda.js";
import { agendaTotals } from "../../lib/agenda.js";
import { paceLabel } from "../../lib/pace.js";

export const id = "summary";
export const label = "Resumo";

export function render(t) {
  const { v, board } = t;
  return `${cycleSummary(v)}${(v.projects || []).map((p) => tripCard(p, v.today)).join("")}
    ${decisionsSummary(board.open)}
    ${foundSummary(v.recurring)}
    ${timelineCard(v.timeline)}
    ${wealthSummary(v)}
    ${billsSummary(v)}`;
}

const money = (n) => brl(n, Math.abs(n) < 100 ? 2 : 0);
const when = (d) => (d.days <= 0 ? "hoje" : ddmm(d.due));

// The open decisions, by deadline; the details and the buttons are in Início › Decisões.
function decisionsSummary(open) {
  if (!open.length) return "";
  const shown = open.slice(0, 5);
  return `<button class="card tap-card sum-card alert-card" data-go="home:decisions">
      <div class="row"><div class="label">Decisões</div><span class="chip warn">${open.length} ${open.length === 1 ? "aberta" : "abertas"}</span></div>
      <div class="row"><div class="dlist grow">${shown.map((d) => `<div><span><b>${when(d)}</b> ${esc(d.title)}${d.joint ? " <small>conjunta</small>" : ""}</span><span class="nw${d.kind === "idle" ? " warn" : ""}">${d.kind === "idle" && d.cost ? `~${money(d.cost)}/dia útil` : d.amount != null ? brl(d.amount) : ""}</span></div>`).join("")}</div>${GO}</div>
      ${open.length > shown.length ? `<div class="muted sm">+ ${open.length - shown.length} outras</div>` : ""}
      <div class="to">Início › Decisões</div>
    </button>`;
}

// A trip (rules file › projects): its whole cost, by where it is in the bills, plus what is paid at the hotel.
function tripCard(p, today) {
  const days = p.start ? Math.round((Date.parse(p.start + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5) : null;
  const chip = days == null ? "" : days > 0 ? `faltam ${days} dias` : p.end && today <= p.end ? "em viagem" : "terminou";
  const fx = (e) => (e.currency === "BRL" ? brl(e.amount, 2) : `${e.currency === "USD" ? "US$" : e.currency} ${e.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const extra = p.extras.map((e) => `<div><span>${esc(e.name)}${e.due ? ` · ${ddmm(e.due)}` : ""}</span><span>${fx(e)}${e.currency !== "BRL" && e.brl ? ` <small class="muted">≈ ${brl(e.brl)}</small>` : ""}</span></div>`).join("");
  return `<div class="card sum-card">
      <div class="row"><div class="label">Viagem · ${esc(p.name)}</div>${chip ? `<span class="chip">${chip}</span>` : ""}</div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(p.total)}</span><span class="muted">no total</span></div></div>
      <div class="dlist mt8">
        <div><span>Já faturado</span><span>${brl(p.billed)}</span></div>
        <div><span>Na fatura aberta (este ciclo)</span><span>${brl(p.open)}</span></div>
        ${p.ahead ? `<div><span>Parcelas por vir${p.lastAhead ? ` · até ${MES[Number(p.lastAhead.slice(5)) - 1]}/${p.lastAhead.slice(2, 4)}` : ""}</span><span>${brl(p.ahead)}</span></div>` : ""}
        ${extra}
      </div>
      <details class="mt6"><summary class="muted sm">${p.buys.length} compras no cartão</summary><div class="list mt6">${p.buys.map((b) => `<div><span class="l">${esc(b.name)}<small>${ddmm(b.bought)}${b.n > 1 ? ` · ${b.n}x` : ""}</small></span><b class="nw">${brl(b.amount, 2)}</b></div>`).join("")}</div></details>
    </div>`;
}

// Monthly charges found in the statements that are in no list: a nudge to Ajustes › Contas.
function foundSummary(found) {
  if (!found?.length) return "";
  return `<button class="card tap-card sum-card" data-go="settings:bills">
      <div class="row"><div class="label">Cobranças recorrentes</div><span class="chip warn">${found.length} ${found.length === 1 ? "nova" : "novas"}</span></div>
      <div class="row"><div class="muted grow">${found.slice(0, 3).map((r) => `${esc(r.name)} <b class="ink">${brl(r.amount, 2)}</b>`).join(" · ")}</div>${GO}</div>
      <div class="to">Ajustes › Contas</div>
    </button>`;
}

function cycleSummary(v) {
  const m = v.month;
  const p = m.target ? (m.spent / m.target) * 100 : 0;
  return `<button class="card tap-card sum-card" data-go="spend:cycle">
      <div class="row"><div class="label">${m.cycle ? `Ciclo ${ddmm(m.start)} → ${ddmm(m.end)}` : `${MES[Number(m.month.slice(5)) - 1]}/${m.month.slice(2, 4)}`}</div><span class="chip${m.over ? " bad" : p > 80 ? " warn" : ""}">faltam ${m.daysLeft} ${m.daysLeft === 1 ? "dia" : "dias"}</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(m.spent)}</span><span class="muted">de ${brl(m.target)}</span></div>${GO}</div>
      <div class="track goal-track mt8"><div class="fill" style="width:${Math.min(100, p)}%;background:var(${m.over ? "--bad" : p > 80 ? "--warn" : "--brand"})"></div></div>
      ${v.pace ? `<div class="muted sm mt6"><b class="${v.pace.tone}">${paceLabel(v.pace, brl)}</b>${v.pace.committedTotal ? ` · ainda vêm ${brl(v.pace.committedTotal)} de contas` : ""}</div>` : ""}
      ${weekRow(v.week)}
      <div class="to">${m.over ? `${brl(m.spent - m.target)} acima da meta` : `${brl(v.pace ? v.pace.perDay : m.perDay)}/dia livre até ${ddmm(m.end)}`} · Gastos › Ciclo</div>
    </button>`;
}

// Every connected bank together, the joint account included (as in Investimentos › Rendimentos).
function wealthSummary(v) {
  const x = v.income;
  const perMonth = x?.cdiDaily && x.all.net > 0;
  return `<button class="card tap-card sum-card" data-go="investments:wallet">
      <div class="label">Patrimônio</div>
      <div class="row"><div class="hero-row"><span class="kpi">${mil(v.wealth.total)}</span></div>${GO}</div>
      ${perMonth ? `<div class="muted sm">rende ≈ <b class="ok">${brl(x.all.net)}/mês</b> líquido</div>` : ""}
      <div class="to">Investimentos › Carteira</div>
    </button>`;
}

function billsSummary(v) {
  const live = v.cards.filter((c) => c.bill > 0 || c.used > 0);
  if (!live.length) return "";
  const ahead = v.installments?.total || 0;
  return `<button class="card tap-card sum-card" data-go="spend:bills">
      <div class="row"><div class="label">Faturas</div>${GO}</div>
      <div class="muted">${live.map((c) => `${esc(c.name)} <b class="ink">${brl(c.bill)}</b>${c.due ? ` ${ddmm(c.due)}` : ""}`).join(" · ")}</div>
      ${live.some((c) => c.paid) ? `<div class="muted sm"><span class="ok">✓</span> ${live.filter((c) => c.paid).map((c) => `${esc(c.name)} ${MES[Number(c.paid.due.slice(5, 7)) - 1]} paga`).join(" · ")}</div>` : ""}
      ${ahead > 0 ? `<div class="muted sm">${brl(ahead)} já parcelado nas próximas</div>` : ""}
      <div class="to">Gastos › Fatura · Parcelas</div>
    </button>`;
}


// 3 · the next 30 days, the first lines; the whole list (30 or 90 days) is Início › Agenda.
const SHOWN = 7;
function timelineCard(list) {
  if (!list?.length) return "";
  const pay = agendaTotals(list).pay;
  return `<button class="card tap-card sum-card" data-go="home:agenda">
    <div class="row"><div class="label">Próximos 30 dias</div><span class="muted sm">${pay ? `a pagar ${brl(pay)}` : "entra · sai · vence"}</span></div>
    <div class="row"><div class="tl mt6 grow">${list.slice(0, SHOWN).map(agendaRow).join("")}</div>${GO}</div>
    <div class="to">${list.length > SHOWN ? `+ ${list.length - SHOWN} · ` : ""}Início › Agenda</div></button>`;
}

const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const wd = (iso) => `${WD[new Date(iso + "T12:00:00Z").getUTCDay()]} ${Number(iso.slice(8, 10))}`;
// This week against its own budget (src/lib/pace.js weekBudget), and what is left per week after it.
function weekRow(w) {
  if (!w) return "";
  const head = `<div class="row mt10"><span class="label">Esta semana · ${wd(w.start)} → ${wd(w.end)}</span>`;
  if (w.over) return `<div class="wk">${head}<b class="nw">${brl(w.spent)}</b></div><div class="muted sm bad">sem folga: ${brl(w.by)} acima da meta</div></div>`;
  const pct = Math.min(100, (w.spent / w.budget) * 100), over = w.left < 0;
  return `<div class="wk">${head}<span class="nw"><b>${brl(w.spent)}</b> <span class="muted">de ${brl(w.budget)}</span></span></div>
      <div class="track mt6"><div class="fill" style="width:${pct}%;background:var(${over ? "--bad" : pct > 80 ? "--warn" : "--brand"})"></div></div>
      <div class="muted sm mt6">${over ? `<b class="bad">${brl(-w.left)} acima</b> do valor da semana` : `sobram <b class="ink">${brl(w.left)}</b> até ${wd(w.end).split(" ")[0] === "dom" ? "domingo" : wd(w.end)}`}${w.after ? ` · depois ~${brl(w.after.perWeek)}/semana (${w.after.weeks} ${w.after.weeks === 1 ? "semana" : "semanas"})` : ""}</div></div>`;
}
