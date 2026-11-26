// Investimentos › Rendimentos: income after tax. Now: an estimate per month at today's CDI (each position taxed at its
// own maturity bracket), the net gain so far and the IR the banks will withhold. History: what each bank actually earned
// per month, measured position by position between refreshes, next to the estimate for the same business days. Then
// per bank, the split by IR bracket with the exempt-vs-CDB yardstick, and the joint account on its own.
import { brl, mil, pct, esc, MES } from "../../lib/format.js";
import { BANKS, bankName } from "../../lib/model.js";
import { cdbEquivalent } from "../../lib/income.js";
import { yearEndSummary } from "../../lib/yearend.js";

export const id = "income";
export const label = "Rendimentos";

let histBank = "own";

const BRACKET_COLOR = { 0: "--brand", 0.15: "--ok", 0.175: "--c-travel", 0.2: "--warn", 0.225: "--bad" };
const LCA_REF = 88;
export function render(t, ctx) {
  const x = t.income, left = t.left;
  if (!x?.own.n) return '<div class="card empty"><b>Sem aplicações</b>Nenhuma aplicação nas contas conectadas.</div>';
  const o = x.own, salary = left?.avg?.salary;
  const perMonth = x.cdiDaily && o.net > 0;
  const head = perMonth
    ? `<div class="hero-row mt6"><span class="big">${brl(o.net)}</span><span class="muted">/mês líquido</span></div>
       <div class="muted sm">${brl(o.gross)} bruto − ${brl(o.gross - o.net)} de IR · ${pct((o.net / o.balance) * 100, 2)} ao mês${salary ? ` · ≈ ${pct((o.net / salary) * 100, 0)} do salário` : ""}</div>`
    : `<div class="muted sm mt6">Sem a taxa do CDI de hoje: atualize para estimar o rendimento por mês.</div>`;
  const card = `<div class="card">
      <div class="label">Agora</div>
      ${head}
      <div class="split">
        <div class="tile"><span class="muted sm">Ganho líquido acumulado</span><b>${brl(o.gain)}</b><span class="muted sm">nas posições de hoje</span></div>
        <div class="tile"><span class="muted sm">IR a reter no resgate</span><b>${brl(o.tax)}</b><span class="muted sm">já descontado do saldo</span></div>
      </div>
    </div>`;
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
    ${yearEndCard(ctx?.data?.yearEnd, t.today)}
    ${historyCard(t.history, x)}
    <div class="card"><div class="label">Por banco</div><div class="list mt6">${own.map(bank).join("")}</div><div class="muted xs mt8">${notes}</div></div>
    ${brk}${jointCard}`;
}

export function bind(pane, t, ctx, { repaint }) {
  pane.onclick = (e) => {
    const b = e.target.closest("[data-hb]")?.dataset.hb;
    if (b) { histBank = b; repaint(); }
  };
}

const mon = (ym) => `${MES[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;

// Measured × estimated per month. "Seu total" sums the own banks; a bank can be picked on its own (the joint one too).
function historyCard(hist, x) {
  if (!hist?.length) return `<div class="card"><div class="label">Histórico, medido</div><div class="muted mt6">Começa a medir na próxima atualização: cada uma guarda as aplicações, e o rendimento de um mês é a diferença entre elas.</div></div>`;
  const own = new Set(x.banks.filter((b) => !b.joint).map((b) => b.label));
  const banks = [...new Set(hist.flatMap((m) => Object.keys(m.banks)))].sort((a, b) => (own.has(b) - own.has(a)) || a.localeCompare(b));
  if (histBank !== "own" && !banks.includes(histBank)) histBank = "own";
  const ownKeys = banks.filter((b) => own.has(b));
  const pick = (m, keys) => {
    const vals = keys.map((b) => m.banks[b]).filter(Boolean);
    const est = vals.length && vals.every((v) => v.estimated != null) ? vals.reduce((a, v) => a + v.estimated, 0) : null;
    return { measured: vals.reduce((a, v) => a + v.measured, 0), est };
  };
  const shown = histBank === "own" ? ownKeys : [histBank];
  const series = hist.map((m) => ({ m, ...pick(m, shown) }));
  const max = Math.max(1, ...series.flatMap((x) => [x.measured, x.est || 0]));
  const bar = (v, cls) => `<i class="${cls}" style="height:${Math.max(2, (Math.max(0, v) / max) * 90)}px"></i>`;
  const last = hist.at(-1);
  const ratio = (m, e) => (e ? pct((m / e) * 100, 0) : "");
  const row = (b) => {
    const v = last.banks[b];
    if (!v) return "";
    return `<tr><td><span class="bankdot" style="background:${BANKS[b]?.color || "var(--ink-3)"}"></span>${esc(bankName(b))}${own.has(b) ? "" : ' <span class="chip joint chip-s">conjunta</span>'}</td><td>${brl(v.measured)}</td><td class="dim">${v.estimated != null ? brl(v.estimated) : "—"}</td><td class="dim">${ratio(v.measured, v.estimated)}</td></tr>`;
  };
  const total = pick(last, ownKeys);
  return `<div class="card">
      <div class="label">Histórico, medido</div>
      <div class="seg mt8" role="group" aria-label="Banco">${[["own", "Seu total"], ...banks.map((b) => [b, bankName(b)])].map(([k, l]) => `<button data-hb="${k}" class="${k === histBank ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="hist-bars">${series.map((x) => `<div><div class="pair">${bar(x.measured, "me")}${x.est != null ? bar(x.est, "es") : ""}</div><span>${mon(x.m.month)}${x.m.partial ? "*" : ""}</span></div>`).join("")}</div>
      <div class="lg mt6"><span><i style="background:var(--brand)"></i>medido</span><span><i style="background:var(--ink-3)"></i>estimado no mesmo período</span></div>
      <table class="hist"><tr><th>${mon(last.month)}${last.partial ? "*" : ""} · ${last.bd} dias úteis</th><th>Medido</th><th>Estimado</th><th></th></tr>
        ${banks.map(row).join("")}
        <tr><td><b>Seu total</b></td><td><b>${brl(total.measured)}</b></td><td class="dim">${total.est != null ? brl(total.est) : "—"}</td><td class="dim">${ratio(total.measured, total.est)}</td></tr>
      </table>
      <div class="muted xs mt6">${hist[0].partial ? `* desde ${hist[0].from.slice(8, 10)}/${hist[0].from.slice(5, 7)}, a primeira atualização com as aplicações. ` : ""}Medido aplicação por aplicação, líquido de IR: um resgate parcial não vira perda e um vencimento não derruba o mês. Sem estimativa quando a maior parte do dinheiro mudou no meio do período.</div>
    </div>`;
}

// The balances kept for the tax return: this year's from December on, last year's until the next December.
function yearEndCard(all, today) {
  const year = Number(today.slice(5, 7)) === 12 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1);
  const ye = yearEndSummary(all, year);
  const current = year === today.slice(0, 4);
  if (!ye && !current) return "";
  const day = (d) => `${Number(d.slice(8, 10))}/${d.slice(5, 7)}`;
  const status = !ye ? "Ainda nada guardado."
    : ye.done ? `Todos os bancos guardados em 31/12.`
    : current ? `Atualize o Cofre no dia 31/12: a última atualização do ano fica guardada (a agenda Cofre lembra na véspera).`
    : `Nem todos os bancos foram guardados em 31/12: para esses, use o informe de rendimentos do banco.`;
  const rows = (ye?.banks || []).map((b) => `<div><span class="l"><span><i class="bankdot" style="background:${BANKS[b.label]?.color || "var(--ink-3)"}"></i><b>${esc(bankName(b.label))}</b></span><small>em ${day(b.d)}${b.onTime ? " ✓" : ""} · conta ${brl(b.checking)} · ${b.positions} ${b.positions === 1 ? "aplicação" : "aplicações"}</small></span><b class="nw">${brl(b.checking + b.invested)}</b></div>`).join("");
  return `<div class="card"><div class="row"><div class="label">Saldos de 31/12/${year}</div><span class="muted sm">IR ${Number(year) + 1}</span></div>
    <div class="muted sm mt6">${status}</div>${rows ? `<div class="list mt6">${rows}</div>` : ""}
    <div class="muted xs mt8">Para Bens e Direitos. O informe de rendimentos de cada banco é quem vale; isto serve para conferir.</div></div>`;
}
