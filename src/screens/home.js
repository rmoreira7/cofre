import { brl, mil, ddmm, esc, MES } from "../lib/format.js";
import { header, needsSetup, GO } from "../ui/shell.js";

// Início is a summary: five short rows, each opening the sub-tab where it is dealt with.
export function render(el, ctx) {
  if (needsSetup(el, ctx, "Cofre")) return;
  const v = ctx.view();
  el.innerHTML = `${header(ctx, "Cofre")}
    ${cycleSummary(v)}
    ${alertsCard(v.alerts)}
    ${timelineCard(v.timeline)}
    ${wealthSummary(v)}
    ${billsSummary(v)}`;
  el.onclick = (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
  };
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
      <div class="to">Gastos › Faturas</div>
    </button>`;
}


// 3 · the next 30 days: what goes out, what comes in, what matures.
function timelineCard(list) {
  if (!list?.length) return "";
  const row = (e) => {
    const [, mo, d] = e.date.split("-");
    const dot = e.kind === "bill" ? "--c-bills" : e.kind === "salary" ? "--ok" : "--c-travel";
    // One line per event; the details live in Faturas and Vencimentos.
    const text = e.kind === "bill" ? esc(e.name)
      : e.kind === "salary" ? `Salário <small>previsto</small>`
      : `${esc(e.name)}${e.joint ? " <small>conjunta</small>" : ""}`;
    const amt = e.kind === "bill" ? `− ${brl(-e.amount)}` : e.kind === "salary" ? `+ ~${brl(e.amount)}` : brl(e.amount);
    return `<div class="${e.forecast ? "fore" : ""}"><span class="d"><b>${d}</b>${MES[Number(mo) - 1]}</span><i class="dot" style="background:var(${dot})"></i><span class="t">${text}</span><b class="${e.kind === "salary" ? "ok" : ""}">${amt}</b></div>`;
  };
  return `<div class="card"><div class="row"><div class="label">Próximos 30 dias</div><span class="muted sm">entra · sai · vence</span></div>
    <div class="tl mt6">${list.map(row).join("")}</div></div>`;
}

function alertsCard(list) {
  if (!list.length) return "";
  const row = (a) => {
    if (a.kind === "bill") return `<div data-go="spend:bills" class="tap"><span class="l">Fatura ${esc(a.bank)} ${a.days === 0 ? "vence hoje" : `vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}`}<small>${ddmm(a.due)}</small></span><b>${brl(a.amount)}</b></div>`;
    if (a.kind === "fgc") return `<div data-go="investments:rules" class="tap"><span class="l">${esc(a.issuer)}: ${brl(a.amount)} acima do FGC<small>${brl(a.over)} além dos R$ 250 mil por emissor${a.joint ? " · inclui a conta conjunta" : ""} · mover o excedente para outro emissor</small></span><span class="chip bad">FGC</span></div>`;
    if (a.kind === "maturity") return `<div data-go="investments:maturities" class="tap"><span class="l">${esc(a.issuer)}${a.n > 1 ? ` ×${a.n}` : ""} vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}<small>${a.scope === "joint" ? "conta conjunta · " : ""}${a.brb ? "não renovar no BRB" : `reinvestir em CDB ≥ ${a.cdbMin}% CDI ou liquidez diária`}</small></span><b>${brl(a.amount)}</b></div>`;
    return `<div data-go="investments:wallet" class="tap"><span class="l">${brl(a.amount)} parados na conta<small>${esc(a.bank)}${a.scope === "joint" ? " · conta conjunta" : ""} · investir o que passar da reserva</small></span><span class="chip warn">parado</span></div>`;
  };
  return `<div class="card alert-card"><div class="label">Atenção</div><div class="list mt6">${list.map(row).join("")}</div></div>`;
}
