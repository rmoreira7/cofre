// Gastos › Ciclo: how much is left to spend this cycle, and what came in against what went out.
import { brl, MESES, ddmm, MES, esc } from "../../lib/format.js";
import { ONE_OFF } from "../../lib/spend.js";
import { paceLabel } from "../../lib/pace.js";
import { kBRL } from "./common.js";

export const id = "cycle";
export const label = "Ciclo";

export function render(t) {
  const { month: v, left: l, pace: p } = t;
  const C = 2 * Math.PI * 56;
  const share = Math.min(1, v.spent / v.target);
  const m = Number(v.month.slice(5, 7));
  return `    <div class="sub mb10">${MESES[m - 1]}${v.cycle ? ` · ciclo ${ddmm(v.start)}–${ddmm(v.end)}` : ""} · ${v.daysLeft} ${v.daysLeft === 1 ? "dia restante" : "dias restantes"}</div>
    <div class="card">
      <div class="row">
        <div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="56" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
          <circle cx="66" cy="66" r="56" fill="none" stroke="var(${v.over ? "--bad" : "--brand"})" stroke-width="12" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${C * share} ${C}"/></svg>
          <div class="c"><b>${brl(v.spent)}</b><span class="muted">de ${brl(v.target)}</span></div></div>
        <div class="grow">
          <div class="label">Livre por dia</div><div class="kpi${p.free < 0 ? " bad" : ""}">${brl(p.perDay)}</div>
          <div class="muted mt6">${v.left >= 0 ? `Restam <b class="ink">${brl(v.left)}</b> até ${ddmm(v.end)}` : `Passou <b class="bad">${brl(-v.left)}</b> da meta`}</div>
          ${(t.projects || []).filter((x) => x.open > 0).map((x) => `<div class="muted sm mt6">inclui ${brl(x.open)} da viagem ${esc(x.name)}</div>`).join("")}
          ${p.committedTotal ? `<div class="muted sm mt6">${p.free >= 0 ? "já tirando" : "e ainda vêm"} ${brl(p.committedTotal)} de contas</div>` : ""}
          ${p.projected ? `<div class="muted sm mt6">No ritmo de sempre, fecha em ~<b class="ink">${kBRL(p.projected)}</b></div>` : ""}
          <span class="chip ${p.tone} mt10">${paceLabel(p, brl)}</span>
        </div>
      </div>
    </div>
    ${paceCard(v, p)}
    ${leftoverCard(v, l)}`;
}

// The pace, explained: what is usually gone by this day of the cycle, and the contas still to come before the close.
function paceCard(v, p) {
  const lines = p.committed.map((c) => `<div><span>${ddmm(c.date)} ${esc(c.name)}</span><span>${brl(c.amount)}</span></div>`).join("");
  return `<div class="card">
      <div class="label">Ritmo</div>
      <div class="muted sm mt6">${p.early ? "Começo do ciclo: cedo para comparar." : `Até hoje você costuma ter gasto <b class="ink">${Math.round(p.share * 100)}%</b> do ciclo (${brl(p.expected)} da meta); gastou ${brl(v.spent)}.`}
        ${p.usual ? `Base: ${p.usual} ciclos anteriores.` : "Sem 3 ciclos anteriores: ritmo linear."}</div>
      ${lines ? `<div class="label mt10">Ainda vêm até ${ddmm(v.end)}</div><div class="dlist">${lines}</div>` : ""}
    </div>`;
}

const tone = (x) => (x < 0 ? "bad" : "ok");
const num = (n) => Math.round(n).toLocaleString("pt-BR");
const signed = (x) => `${x < 0 ? "−" : "+"} ${brl(Math.abs(x))}`;

// What came in, what went out and what is left this cycle, with the past cycles' leftover as context.
function leftoverCard(m, l) {
  const now = l?.now;
  if (!now && !l?.n) return "";
  const bars = l?.history.map((h) => h.regular) || [];
  const max = Math.max(1, ...bars.map(Math.abs));
  const spark = bars.map((x, i) => `<i style="height:${Math.max(6, (Math.abs(x) / max) * 100)}%;background:var(${x < 0 ? "--bad" : "--brand"})" title="${MES[Number(l.history[i].month.slice(5)) - 1]}: ${brl(x)}"></i>`).join("");
  return `<div class="card">
      <div class="label">Entradas · gastos · sobra</div>
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
