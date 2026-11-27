// Gastos › Histórico: one bar per closed cycle (the same layout as Parcelas); tap one to see what it was spent on,
// per group against its limit, what came in, and its largest purchases. The realistic-target card comes last.
import { brl, ddmm, esc, MES } from "../../lib/format.js";
import { CLUSTERS } from "../../lib/spend.js";
import { kBRL } from "./common.js";
import { niceName } from "../../lib/recurring.js";

export const id = "history";
export const label = "Histórico";

const SHOWN = 12, FIRST = 12;
let picked = null; // period id ("YYYY-MM"); null = the latest closed one
let all = false;

const mon = (ym) => `${MES[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : String(Math.round(n)));
const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));

export function render(t) {
  const { month: v, avg12, avgN, goals } = t;
  const ids = Object.keys(t.periods || {}).sort().slice(-SHOWN);
  if (!ids.length) return '<div class="card empty"><b>Sem histórico</b>Nenhum ciclo fechado ainda.</div>';
  const sel = ids.includes(picked) ? picked : ids.at(-1);
  const p = t.periods[sel];
  return `${barsCard(ids, t.periods, sel, v, avg12, avgN)}${periodCard(p, t.trends)}${purchasesCard(t, p)}${goalsCard(goals, v.target, avg12, avgN)}`;
}

export function bind(pane, t, ctx, { repaint, rerender }) {
  pane.onclick = (e) => {
    const m = e.target.closest("[data-hm]")?.dataset.hm;
    if (m) { picked = m; all = false; repaint(); pane.querySelector("[data-period]")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    if (e.target.closest('[data-a="all-buys"]')) { all = true; repaint(); return; }
    if (e.target.closest('[data-a="goals"]') && t.goals) {
      const g = t.goals;
      ctx.save({ ...ctx.data, settings: { ...(ctx.data.settings || {}), target: g.target, limits: { ...(ctx.data.settings?.limits || {}), ...g.limits } } }).then(rerender);
    }
  };
}

function barsCard(ids, periods, sel, v, avg, n) {
  const max = Math.max(...ids.map((id) => periods[id].spent), v.target, 1);
  return `<div class="card">
      <div class="row"><div class="label">${v.cycle ? "Ciclos" : "Meses"} anteriores</div><b>média ${brl(avg)}</b></div>
      <div class="muted sm">meta ${brl(v.target)} · média de ${n} · toque num ${v.cycle ? "ciclo" : "mês"}</div>
      <div class="bill-bars" role="tablist">${ids.map((id) => {
        const p = periods[id];
        return `<button role="tab" data-hm="${id}" class="${id === sel ? "sel" : ""}${p.over ? " over" : " under"}${p.cardOnly ? " dim" : ""}" aria-selected="${id === sel}" aria-label="${mon(id)}: ${brl(p.spent)}${p.over ? ", acima da meta" : ""}">
          <b>${k(p.spent)}</b><i style="height:${Math.max(3, (p.spent / max) * 72)}px"></i><span>${MES[Number(id.slice(5)) - 1]}</span></button>`;
      }).join("")}</div>
      <div class="muted xs mt6">Vermelho: passou da meta.${ids.some((id) => periods[id].cardOnly) ? " Desbotado: só o cartão (extrato de fatura)." : ""}</div>
    </div>`;
}

// Against the usual: the group's median over the last 12 closed cycles. Shown when the gap is worth a look.
export function vsUsual(spent, usual) {
  if (!(usual > 0)) return null;
  const d = spent - usual;
  return Math.abs(d) >= Math.max(100, usual * 0.2) ? d : null;
}

function periodCard(p, trends = {}) {
  const pct = p.target ? Math.min(100, (p.spent / p.target) * 100) : 0;
  const groups = p.groups.map((g) => {
    const usual = trends[g.id]?.median, d = vsUsual(g.spent, usual);
    const sub = [g.limit != null ? `limite ${brl(g.limit)}` : "", usual > 0 ? `usual ${brl(usual)}` : ""].filter(Boolean).join(" · ");
    const gap = d == null ? "" : ` <span class="sm ${d > 0 ? "bad" : "ok"}">${d > 0 ? "▲ +" : "▼ −"}${brl(Math.abs(d))}</span>`;
    return `<div><span class="l">${esc(g.label)}${sub ? `<small>${sub}</small>` : ""}</span><span class="nw"><b>${brl(g.spent)}</b>${gap}</span></div>`;
  }).join("");
  return `<div class="card" data-period>
      <div class="row"><div class="label">${p.cycle ? `Ciclo ${ddmm(p.start)} → ${ddmm(p.end)}` : mon(p.id)}</div><span class="chip${p.over ? " bad" : " ok"}">${p.over ? `${brl(p.spent - p.target)} acima` : `sobrou ${brl(p.target - p.spent)}`}</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(p.spent)}</span><span class="muted">de ${brl(p.target)}</span></div></div>
      <div class="track goal-track mt8"><div class="fill" style="width:${pct}%;background:var(${p.over ? "--bad" : "--ok"})"></div></div>
      ${p.cardOnly ? "" : `<div class="dlist mt8">
        ${p.income ? `<div><span>Entrou</span><span>${brl(p.income)} · ${p.left >= 0 ? "sobrou" : "faltou"} ${brl(Math.abs(p.left))}</span></div>` : ""}
        ${p.earned != null ? `<div><span>Investimentos renderam</span><span class="ok">${brl(p.earned)}</span></div>` : ""}
      </div>`}
      <div class="sec mt10">Por grupo <span class="muted">· ▲▼ vs. o usual (mediana de 12 ciclos)</span></div>
      <div class="list">${groups || '<div class="muted">Nada gasto.</div>'}</div>
    </div>`;
}

function purchasesCard(t, p) {
  const key = t.month.cycle ? "cyc" : "m";
  const buys = t.rows.filter((r) => r[key] === p.id && r.amt > 0).sort((a, b) => b.amt - a.amt);
  if (!buys.length) return "";
  const rows = all ? buys : buys.slice(0, FIRST);
  return `<div class="card">
      <div class="row"><div class="label">Maiores gastos</div><span class="muted sm">${buys.length} lançamentos</span></div>
      <div class="list mt6">${rows.map((r) => `<div><span class="l"><span class="find" data-find="${esc(niceName(r.desc))}">${esc(String(r.desc || "").split("|").at(-1).trim() || "—")}</span><small>${ddmm(r.d)} · ${esc(GROUP[r.cluster] || "Outros")}${r.src === "account" ? " · conta" : ""}</small></span><b class="nw">${brl(r.amt, 2)}</b></div>`).join("")}</div>
      ${buys.length > rows.length ? `<button class="lnk mt6" data-a="all-buys">mostrar todos (${buys.length}) ›</button>` : ""}
    </div>`;
}

// Shown while the target sits more than 10% under the average spend: a target that is always blown stops warning.
function goalsCard(g, target, avg, n) {
  if (!g || target >= avg * 0.9 || g.target <= target) return "";
  return `<div class="card">
    <div class="row"><div class="label">Meta realista</div><span class="chip bad">meta atual: ${kBRL(target)}</span></div>
    <div class="muted mt6">Sua média é <b class="ink">${kBRL(avg)}</b> por ciclo e entram <b class="ink">${kBRL(g.income)}</b>. Uma meta sempre estourada deixa de avisar.</div>
    <div class="split">
      <div class="tile"><span class="label">Sugerida</span><b>${brl(g.target)}</b><span class="muted sm">90% do que entra</span></div>
      <div class="tile"><span class="label">Sobra prevista</span><b class="${g.left >= 0 ? "ok" : "bad"}">${g.left >= 0 ? "+" : "−"}${brl(Math.abs(g.left))}</b><span class="muted sm">por ciclo</span></div>
    </div>
    <button class="btn" data-a="goals">Usar ${kBRL(g.target)} e os limites sugeridos</button>
    <div class="muted sm mt6">Limites = a mediana de ${n} ciclos de cada grupo, na proporção da meta. Dá para editar um a um em Ajustes.</div>
  </div>`;
}
