// Início › Resumo: five short rows, each opening the sub-tab where it is dealt with; open decisions first.
import { brl, mil, ddmm, esc, MES } from "../../lib/format.js";
import { GO } from "../../ui/shell.js";
import { agendaRow } from "../../ui/agenda.js";

export const id = "summary";
export const label = "Resumo";

export function render(t) {
  const { v, board } = t;
  return `${cycleSummary(v)}
    ${decisionsSummary(board.open)}
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

function cycleSummary(v) {
  const m = v.month;
  const p = m.target ? (m.spent / m.target) * 100 : 0;
  return `<button class="card tap-card sum-card" data-go="spend:cycle">
      <div class="row"><div class="label">${m.cycle ? `Ciclo ${ddmm(m.start)} → ${ddmm(m.end)}` : `${MES[Number(m.month.slice(5)) - 1]}/${m.month.slice(2, 4)}`}</div><span class="chip${m.over ? " bad" : p > 80 ? " warn" : ""}">faltam ${m.daysLeft} ${m.daysLeft === 1 ? "dia" : "dias"}</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(m.spent)}</span><span class="muted">de ${brl(m.target)}</span></div>${GO}</div>
      <div class="track goal-track mt8"><div class="fill" style="width:${Math.min(100, p)}%;background:var(${m.over ? "--bad" : p > 80 ? "--warn" : "--brand"})"></div></div>
      <div class="to">${m.over ? `${brl(m.spent - m.target)} acima da meta` : `${brl(m.perDay)}/dia até ${ddmm(m.end)}`} · Gastos › Ciclo</div>
    </button>`;
}

function wealthSummary(v) {
  const own = v.mine.total, x = v.income;
  const perMonth = x?.cdiDaily && x.own.net > 0;
  return `<button class="card tap-card sum-card" data-go="investments:wallet">
      <div class="label">Patrimônio</div>
      <div class="row"><div class="hero-row"><span class="kpi">${mil(v.wealth.total)}</span>${v.wealth.banks.some((b) => b.joint) ? `<span class="muted sm">seu ${mil(own)}</span>` : ""}</div>${GO}</div>
      ${perMonth ? `<div class="muted sm">rende ≈ <b class="ok">${brl(x.own.net)}/mês</b> líquido${x.joint.n ? ` · conjunta + ${brl(x.joint.net)}` : ""}</div>` : ""}
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
      ${ahead > 0 ? `<div class="muted sm">${brl(ahead)} já parcelado nas próximas</div>` : ""}
      <div class="to">Gastos › Fatura · Parcelas</div>
    </button>`;
}


// 3 · the next 30 days, the first lines; the whole list (30 or 90 days) is Início › Agenda.
const SHOWN = 7;
function timelineCard(list) {
  if (!list?.length) return "";
  const pay = list.filter((e) => e.pay && !e.paid).reduce((a, e) => a - (e.amount || 0), 0);
  return `<button class="card tap-card sum-card" data-go="home:agenda">
    <div class="row"><div class="label">Próximos 30 dias</div><span class="muted sm">${pay ? `a pagar ${brl(pay)}` : "entra · sai · vence"}</span></div>
    <div class="row"><div class="tl mt6 grow">${list.slice(0, SHOWN).map(agendaRow).join("")}</div>${GO}</div>
    <div class="to">${list.length > SHOWN ? `+ ${list.length - SHOWN} · ` : ""}Início › Agenda</div></button>`;
}
