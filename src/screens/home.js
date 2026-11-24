import { brl, mil, pct, ddmm, when, esc, MES } from "../lib/format.js";
import { ONE_OFF, BANK_CODES } from "../lib/spend.js";
import { BANKS, bankName, freshness } from "../lib/model.js";
import { cdbEquivalent } from "../lib/income.js";

let incomeOpen = false;

const REFRESH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

export function header(ctx, title, extra = "") {
  const snap = ctx.data?.snapshot;
  const f = snap ? freshness(snap) : null;
  const b = f?.bankAt ? when(f.bankAt) : null;
  const sub = ctx.busy ? "Atualizando…" : b ? `Dados dos bancos: ${b.text}` : snap ? `Atualizado ${when(snap.at).text}` : "Sem dados";
  return `<div class="top"><div><h1>${title}</h1><div class="sub${b?.stale ? " stale" : ""}">${sub}</div></div>
    <div class="top-btns">${extra}${ctx.data?.credentials ? `<button class="icon-btn" data-a="refresh" aria-label="Atualizar">${REFRESH_ICON}</button>` : ""}</div></div>`;
}

export function needsSetup(el, ctx, title) {
  const missing = !ctx.data?.credentials ? "Conecte o Pluggy em Ajustes." : !ctx.data?.rules ? "Importe o arquivo de regras pessoais em Ajustes." : !ctx.data?.snapshot ? "Toque em atualizar para buscar os dados." : null;
  if (!missing) return false;
  el.innerHTML = `${header(ctx, title)}<div class="card empty"><b>Sem dados ainda</b>${missing}</div>`;
  return true;
}

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Cofre")) return;
  const v = ctx.view();
  el.innerHTML = `${header(ctx, "Cofre")}
    ${cycleCard(v)}
    ${alertsCard(v.alerts)}
    ${timelineCard(v.timeline)}
    ${wealthCard(v.wealth)}
    ${incomeCard(v.income, v.left)}
    ${cardsCard(v.cards)}`;
  el.onclick = (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
    if (e.target.closest('[data-a="cycle"]')) ctx.go("spend");
    if (e.target.closest('[data-a="income"]')) { incomeOpen = !incomeOpen; render(el, ctx); if (incomeOpen) el.querySelector('[data-a="income"]')?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  };
}

const money2 = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tone = (x) => (x < 0 ? "bad" : "ok");
const num = (n) => Math.round(n).toLocaleString("pt-BR");
const signed = (x) => `${x < 0 ? "−" : "+"} ${brl(Math.abs(x))}`;

// 1 · this cycle: spending against the target, then income · spending · leftover, with the past cycles as context.
function cycleCard(v) {
  const m = v.month, l = v.left, now = l?.now;
  const p = m.target ? (m.spent / m.target) * 100 : 0;
  const goal = m.spent > m.target ? (m.target / m.spent) * 100 : 100;
  const bars = l?.history.map((h) => h.regular) || [];
  const max = Math.max(1, ...bars.map(Math.abs));
  const spark = bars.map((x, i) => `<i style="height:${Math.max(6, (Math.abs(x) / max) * 100)}%;background:var(${x < 0 ? "--bad" : "--brand"})" title="${MES[Number(l.history[i].month.slice(5)) - 1]}: ${brl(x)}"></i>`).join("");
  return `<div class="card tap-card" data-a="cycle">
      <div class="row"><div class="label">${m.cycle ? `Ciclo ${ddmm(m.start)} → ${ddmm(m.end)}` : `${MES[Number(m.month.slice(5)) - 1]}/${m.month.slice(2, 4)}`}</div><span class="chip${m.over ? " bad" : p > 80 ? " warn" : ""}">faltam ${m.daysLeft} ${m.daysLeft === 1 ? "dia" : "dias"}</span></div>
      <div class="row end mt6">
        <div><div class="muted sm">Gastos</div><div class="big">${brl(m.spent)}</div></div>
        <div class="right"><div class="muted sm">meta ${brl(m.target)}</div><div class="${m.over ? "bad" : "ok"} strong">${pct(p, 0)} · ${m.over ? `${brl(m.spent - m.target)} acima` : `${brl(m.perDay)}/dia`}</div></div>
      </div>
      <div class="track goal-track mt8"><div class="fill" style="width:${Math.min(100, p)}%;background:var(${m.over ? "--bad" : p > 80 ? "--warn" : "--brand"})"></div>${m.over ? `<span class="goal" style="left:${goal}%"></span>` : ""}</div>
      ${now ? `<div class="stats">
        <div class="stat"><span class="muted sm">Entradas</span><b>${brl(now.income)}</b><span class="muted sm">salário ${num(now.salary)}</span></div>
        <div class="stat"><span class="muted sm">Gastos</span><b>${brl(now.spent)}</b>${m.yearAgo ? `<span class="muted sm">cartão ${num(m.yearAgo.cardNow)}</span>` : ""}</div>
        <div class="stat"><span class="muted sm">Sobra</span><b class="${tone(now.left)}">${signed(now.left)}</b><span class="muted sm">até agora</span></div>
      </div>` : ""}
      ${l?.n ? `<div class="row muted sm mt8"><span>Média ${l.n} ciclos: sobra <b class="${tone(l.avg.left)}">${brl(l.avg.left)}</b></span>${m.yearAgo ? `<span>há 1 ano (cartão): ${brl(m.yearAgo.card)}</span>` : ""}</div>
      <div class="spark" role="img" aria-label="Sobra por ciclo">${spark}</div>
      ${l.avg.oneOff ? `<div class="muted xs">Sem entradas avulsas ≥ ${brl(ONE_OFF)} (${brl(l.avg.oneOff)} no período).</div>` : ""}` : ""}
    </div>`;
}

// 3 · the next 30 days: what goes out, what comes in, what matures.
function timelineCard(list) {
  if (!list?.length) return "";
  const row = (e) => {
    const [, mo, d] = e.date.split("-");
    const dot = e.kind === "bill" ? "--c-bills" : e.kind === "salary" ? "--ok" : "--c-travel";
    const text = e.kind === "bill" ? `${esc(e.name)}<small>${e.early ? `já abatido ${brl(e.early)} pago adiantado` : "fatura do cartão"}</small>`
      : e.kind === "salary" ? `Salário · ${esc(BANK_CODES[e.from] || "conta salário")}<small>previsto</small>`
      : `${esc(e.name)}<small>${esc(bankName(e.bank))}${e.joint ? " · conta conjunta" : ""}${e.rates?.length ? ` · ${esc(e.rates.join(" / "))}` : ""}${e.brb ? " · não renovar" : ""}</small>`;
    const amt = e.kind === "bill" ? `− ${brl(-e.amount)}` : e.kind === "salary" ? `+ ~${brl(e.amount)}` : brl(e.amount);
    return `<div class="${e.forecast ? "fore" : ""}"><span class="d"><b>${d}</b>${MES[Number(mo) - 1]}</span><i class="dot" style="background:var(${dot})"></i><span class="t">${text}</span><b class="${e.kind === "salary" ? "ok" : ""}">${amt}</b></div>`;
  };
  return `<div class="card"><div class="row"><div class="label">Próximos 30 dias</div><span class="muted sm">entra · sai · vence</span></div>
    <div class="tl mt6">${list.map(row).join("")}</div></div>`;
}

// 4 · wealth (the joint account included, tagged): total, the split by bank, the big banks as tiles, the small ones (and foreign money) as lines.
function wealthCard(mine) {
  const big = mine.banks.filter((b) => b.invested > 0 && b.count > 0);
  const small = mine.banks.filter((b) => !big.includes(b) && b.total);
  const stack = mine.banks.filter((b) => b.total > 0).map((b) => `<div style="width:${(b.total / mine.total) * 100}%;background:${BANKS[b.label]?.color || "var(--ink-3)"}"></div>`).join("");
  const sub = (b) => [
    ...(b.foreign || []).map((f) => `${f.currency} ${money2(f.amount)}${f.brl ? "" : " · sem cotação"}`),
    ...b.reserved.map((r) => `Cofrinho ${brl(r.balance)}`),
  ].join(" · ");
  return `<div class="card">
      <div class="label">Patrimônio</div>
      <div class="big">${brl(mine.total)}</div>
      <div class="stack">${stack}</div>
      <div class="split">${big.map((b) => `<div class="tile"><span class="muted"><i class="bankdot" style="background:${BANKS[b.label]?.color}"></i>${esc(b.name)}${b.joint ? ' <span class="chip joint chip-s">conjunta</span>' : ""}</span><b>${mil(b.total)}</b><span class="muted">${b.cdiAvg ? `~${pct(b.cdiAvg, 0)} CDI · ` : ""}${b.count} ${b.count === 1 ? "título" : "títulos"}</span></div>`).join("")}</div>
      ${small.length ? `<div class="list mt6">${small.map((b) => `<div><span class="l"><span><i class="bankdot" style="background:${BANKS[b.label]?.color || "var(--ink-3)"}"></i>${esc(b.name)}${b.joint ? ' <span class="chip joint chip-s">conjunta</span>' : ""}</span>${sub(b) ? `<small>${esc(sub(b))}</small>` : ""}</span><span class="muted">${brl(b.total, 2)}</span></div>`).join("")}</div>` : ""}
    </div>`;
}

// Investment income after tax: an estimate per month at today's CDI (each position taxed at its own maturity bracket),
// the net gain so far on the positions held today, and the IR the banks will withhold. Tap → per bank, the split by
// bracket, the exempt-vs-CDB yardstick, and the joint account on its own.
const BRACKET_COLOR = { 0: "--brand", 0.15: "--ok", 0.175: "--c-travel", 0.2: "--warn", 0.225: "--bad" };
const LCA_REF = 88;
function incomeCard(x, left) {
  if (!x?.own.n) return "";
  const o = x.own, salary = left?.avg?.salary;
  const perMonth = x.cdiDaily && o.net > 0;
  const head = perMonth
    ? `<div class="hero-row mt6"><span class="big">${brl(o.net)}</span><span class="muted">/mês líquido</span></div>
       <div class="muted sm">${brl(o.gross)} bruto − ${brl(o.gross - o.net)} de IR · ${pct((o.net / o.balance) * 100, 2)} ao mês${salary ? ` · ≈ ${pct((o.net / salary) * 100, 0)} do salário` : ""}</div>`
    : `<div class="muted sm mt6">Sem a taxa do CDI de hoje: atualize para estimar o rendimento por mês.</div>`;
  const card = `<div class="card tap-card" data-a="income" aria-expanded="${incomeOpen}">
      <div class="row"><div class="label">Rendimentos</div><span class="muted">${incomeOpen ? "⌃" : "›"}</span></div>
      ${head}
      <div class="split">
        <div class="tile"><span class="muted sm">Ganho líquido acumulado</span><b>${brl(o.gain)}</b><span class="muted sm">nas posições de hoje</span></div>
        <div class="tile"><span class="muted sm">IR a reter no resgate</span><b>${brl(o.tax)}</b><span class="muted sm">já descontado do saldo</span></div>
      </div>
    </div>`;
  if (!incomeOpen) return card;
  const own = x.banks.filter((b) => !b.joint), joint = x.joint;
  const bank = (b) => `<div><span class="l"><span><i class="bankdot" style="background:${BANKS[b.label]?.color || "var(--ink-3)"}"></i><b>${esc(b.name)}</b></span><small>saldo ${mil(b.balance)} · ${b.n} ${b.n === 1 ? "posição" : "posições"} · acumulado ${brl(b.gain)} · IR ${brl(b.tax)}</small></span><b class="nw">${perMonth ? `${brl(b.net)}/mês` : ""}</b></div>`;
  const label = (r) => (r ? pct(r * 100, r * 1000 % 10 ? 1 : 0) : "isento");
  const shown = x.brackets.filter((b) => b.share >= 0.005);
  const brk = `<div class="card"><div class="label">IR no vencimento</div>
      <div class="muted sm mt6">Alíquota de cada aplicação pelo prazo da compra até o vencimento</div>
      <div class="brk">${shown.map((b) => `<i style="flex:${b.share};background:var(${BRACKET_COLOR[b.rate] || "--ink-3"})"></i>`).join("")}</div>
      <div class="legend legend-2">${shown.map((b) => `<span><span class="bankdot" style="background:var(${BRACKET_COLOR[b.rate] || "--ink-3"})"></span>${label(b.rate)} · ${mil(b.amount)} (${pct(b.share * 100, 0)})</span>`).join("")}</div>
      <div class="eq"><b>Para comparar ofertas:</b> uma LCA/LCI a ${LCA_REF}% CDI (isenta) rende o mesmo que um CDB a <b>${pct(cdbEquivalent(LCA_REF, 0.15), 1)} CDI</b> com IR de 15%. Abaixo de 2 anos, a régua sobe: ${LCA_REF}% isento = CDB a ${pct(cdbEquivalent(LCA_REF, 0.175), 1)} (17,5%).</div>
    </div>`;
  const jointCard = joint.n ? `<div class="card joint-card"><div class="row"><div class="label">Conta conjunta</div><span class="chip joint">${esc(x.banks.filter((b) => b.joint).map((b) => b.name).join(" · "))}</span></div>
      ${perMonth ? `<div class="hero-row mt6"><span class="kpi">${brl(joint.net)}</span><span class="muted">/mês líquido</span></div>` : ""}
      <div class="muted sm">${perMonth ? `${pct((joint.net / joint.balance) * 100, 2)} ao mês · ` : ""}acumulado ${brl(joint.gain)} · IR ${brl(joint.tax)}</div>
    </div>` : "";
  const notes = [
    x.cdiAnnual ? `CDI ${pct(x.cdiAnnual * 100, 2)} a.a. (Banco Central)` : null,
    o.unrated ? `${o.unrated} ${o.unrated === 1 ? "aplicação" : "aplicações"} sem taxa conhecida (IPCA ou fundo) fora da estimativa mensal` : null,
    "o que já venceu e foi reaplicado não entra no acumulado",
  ].filter(Boolean).join(" · ");
  return `${card}
    <div class="card"><div class="label">Por banco</div><div class="list mt6">${own.map(bank).join("")}</div><div class="muted xs mt8">${notes}</div></div>
    ${brk}${jointCard}`;
}

// 5 · every card in one block; installments ahead summed across cards.
function cardsCard(cards) {
  const live = cards.filter((c) => c.bill > 0 || c.used > 0);
  if (!live.length) return "";
  const ahead = live.reduce((a, c) => a + (c.ahead || 0), 0);
  return `<div class="card"><div class="label">Cartões</div><div class="list mt6">
      ${live.map((c) => `<div><span class="l"><b>${esc(c.name)} · ${brl(c.bill)}</b><small>${c.due ? `vence ${ddmm(c.due)}` : "sem vencimento"}${c.limit ? ` · ${pct((c.used / c.limit) * 100, 0)} do limite (${brl(c.used)} de ${brl(c.limit)})` : ""}</small></span>${c.due ? `<span class="chip">${ddmm(c.due)}</span>` : ""}</div>`).join("")}
      ${ahead > 0 ? `<div><span class="l">Parcelado nas próximas faturas<small>detalhe em Gastos</small></span><b>${brl(ahead)}</b></div>` : ""}
    </div></div>`;
}

function alertsCard(list) {
  if (!list.length) return "";
  const row = (a) => {
    if (a.kind === "bill") return `<div><span class="l">Fatura ${esc(a.bank)} ${a.days === 0 ? "vence hoje" : `vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}`}<small>${ddmm(a.due)}</small></span><b>${brl(a.amount)}</b></div>`;
    if (a.kind === "fgc") return `<div><span class="l">${esc(a.issuer)}: ${brl(a.amount)} acima do FGC<small>${brl(a.over)} além dos R$ 250 mil por emissor${a.joint ? " · inclui a conta conjunta" : ""} · mover o excedente para outro emissor</small></span><span class="chip bad">FGC</span></div>`;
    if (a.kind === "maturity") return `<div><span class="l">${esc(a.issuer)}${a.n > 1 ? ` ×${a.n}` : ""} vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}<small>${a.scope === "joint" ? "conta conjunta · " : ""}${a.brb ? "não renovar no BRB" : `reinvestir em CDB ≥ ${a.cdbMin}% CDI ou liquidez diária`}</small></span><b>${brl(a.amount)}</b></div>`;
    return `<div><span class="l">${brl(a.amount)} parados na conta<small>${esc(a.bank)}${a.scope === "joint" ? " · conta conjunta" : ""} · investir o que passar da reserva</small></span><span class="chip warn">parado</span></div>`;
  };
  return `<div class="card alert-card"><div class="label">Atenção</div><div class="list mt6">${list.map(row).join("")}</div></div>`;
}
