// Início › Resumo: five short rows, each opening the sub-tab where it is dealt with; open decisions first.
import { brl, mil, ddmm, esc, MES } from "../../lib/format.js";
import { GO } from "../../ui/shell.js";
import { agendaRow } from "../../ui/agenda.js";
import { agendaTotals } from "../../lib/agenda.js";
import { CLOSING_DAYS } from "../../lib/closing.js";
import { paceLabel } from "../../lib/pace.js";
import { daysBetween } from "../../lib/format.js";

export const id = "summary";
export const label = "Resumo";

export function render(t) {
  const { v, board } = t;
  return `${closingCard(v)}${cycleSummary(v)}
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

// The period that just closed, for CLOSING_DAYS after it: spent against the target, groups over their limit, what came
// in and what the investments earned. The same summary goes to Telegram once.
function closingCard(v) {
  const c = v.closing;
  if (!c || daysBetween(c.end, v.today) > CLOSING_DAYS) return "";
  const p = c.target ? Math.min(100, (c.spent / c.target) * 100) : 0;
  return `<button class="card tap-card sum-card" data-go="spend:history">
      <div class="row"><div class="label">Fechamento · ${c.cycle ? `${ddmm(c.start)} → ${ddmm(c.end)}` : `${MES[Number(c.id.slice(5)) - 1]}/${c.id.slice(2, 4)}`}</div><span class="chip${c.over ? " bad" : " ok"}">${c.over ? `${brl(c.spent - c.target)} acima` : `sobrou ${brl(c.target - c.spent)}`}</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(c.spent)}</span><span class="muted">de ${brl(c.target)}</span></div>${GO}</div>
      <div class="track goal-track mt8"><div class="fill" style="width:${p}%;background:var(${c.over ? "--bad" : "--ok"})"></div></div>
      <div class="dlist mt8">
        ${c.overGroups.length ? `<div><span>Acima do limite</span><span class="bad">${c.overGroups.map((g) => `${esc(g.label)} +${brl(g.over)}`).join(" · ")}</span></div>` : ""}
        ${c.income ? `<div><span>Entrou</span><span>${brl(c.income)} · ${c.left >= 0 ? "sobrou" : "faltou"} ${brl(Math.abs(c.left))}</span></div>` : ""}
        ${c.earned != null ? `<div><span>Investimentos renderam</span><span class="ok">${brl(c.earned)}</span></div>` : ""}
        ${c.committed?.amount > 0 ? `<div><span>Próxima fatura já tem</span><span>${brl(c.committed.amount)} em parcelas</span></div>` : ""}
      </div>
      <div class="to">Gastos › Histórico</div>
    </button>`;
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
      <div class="to">${m.over ? `${brl(m.spent - m.target)} acima da meta` : `${brl(v.pace ? v.pace.perDay : m.perDay)}/dia livre até ${ddmm(m.end)}`} · Gastos › Ciclo</div>
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
  const pay = agendaTotals(list).pay;
  return `<button class="card tap-card sum-card" data-go="home:agenda">
    <div class="row"><div class="label">Próximos 30 dias</div><span class="muted sm">${pay ? `a pagar ${brl(pay)}` : "entra · sai · vence"}</span></div>
    <div class="row"><div class="tl mt6 grow">${list.slice(0, SHOWN).map(agendaRow).join("")}</div>${GO}</div>
    <div class="to">${list.length > SHOWN ? `+ ${list.length - SHOWN} · ` : ""}Início › Agenda</div></button>`;
}
