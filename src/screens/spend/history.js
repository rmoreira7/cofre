// Gastos › Histórico: the realistic target (when the current one is always blown) and spending per month.
import { brl, MES } from "../../lib/format.js";
import { kBRL } from "./common.js";

export const id = "history";
export const label = "Histórico";

export function render(t) {
  const { month: v, avg12, avgN, goals, left: lo } = t;
  const income = lo?.n ? lo.avg.left + lo.avg.spent : null;
  return `${goalsCard(goals, v.target, avg12, avgN)}
    <div class="card">
      <div class="label">Últimos meses</div>
      ${chart(v.long || v.history, v.target, income)}
      <div class="muted">Média ${avgN} ${v.cycle ? "ciclos" : "meses"}: ${brl(avg12)}${income ? ` · entra ${kBRL(income)}` : ""} · meta ${brl(v.target)}</div>
      ${v.long ? '<div class="muted mt6">Barras claras: só o cartão (extratos de fatura), sem as contas. Ficam fora da média.</div>' : ""}
      ${v.yearAgo ? `<div class="field mt6"><span>Cartão neste ciclo · mesmo ciclo em ${MES[Number(v.yearAgo.month.slice(5)) - 1]}/${v.yearAgo.month.slice(2, 4)}</span><span>${brl(v.yearAgo.cardNow)} · ${brl(v.yearAgo.card)}</span></div>` : ""}
    </div>`;
}

export function bind(pane, t, ctx, { rerender }) {
  pane.onclick = (e) => {
    if (e.target.closest('[data-a="goals"]') && t.goals) {
      const g = t.goals;
      ctx.save({ ...ctx.data, settings: { ...(ctx.data.settings || {}), target: g.target, limits: { ...(ctx.data.settings?.limits || {}), ...g.limits } } }).then(rerender);
    }
  };
}

// Shown while the target sits more than 10% under the average spend: a target that is always blown stops warning.
function goalsCard(g, target, avg, n) {
  if (!g || target >= avg * 0.9 || g.target <= target) return "";
  const lo = Math.min(target, g.target), hi = Math.max(avg, g.income), at = (x) => ((x - lo) / (hi - lo || 1)) * 96 + 2;
  return `<div class="card">
    <div class="row"><div class="label">Meta realista</div><span class="chip bad">meta atual: ${kBRL(target)}</span></div>
    <div class="muted mt6">Sua média é <b class="ink">${kBRL(avg)}</b> por ciclo e entram <b class="ink">${kBRL(g.income)}</b>. Uma meta sempre estourada deixa de avisar.</div>
    <div class="scale" aria-hidden="true"><div class="ln"></div>
      <div class="m" style="left:${at(target)}%"><i></i>atual</div>
      <div class="m sug" style="left:${at(g.target)}%"><i></i>${kBRL(g.target).replace("R$ ", "")}</div>
      <div class="m inc up" style="left:${at(g.income)}%"><i></i>entra</div>
      <div class="m avg" style="left:${at(avg)}%"><i></i>média</div></div>
    <div class="split">
      <div class="tile"><span class="label">Sugerida</span><b>${brl(g.target)}</b><span class="muted sm">90% do que entra</span></div>
      <div class="tile"><span class="label">Sobra prevista</span><b class="${g.left >= 0 ? "ok" : "bad"}">${g.left >= 0 ? "+" : "−"}${brl(Math.abs(g.left))}</b><span class="muted sm">por ciclo</span></div>
    </div>
    <button class="btn" data-a="goals">Usar ${kBRL(g.target)} e os limites sugeridos</button>
    <div class="muted sm mt6">Limites = a mediana de ${n} ciclos de cada grupo, na proporção da meta (um ciclo fora da curva não infla o limite). Dá para editar um a um em Ajustes.</div>
  </div>`;
}

function chart(history, target, income) {
  const n = history.length, W = 340, H = 120, max = Math.max(target * 1.2, (income || 0) * 1.1, ...history.map((h) => Math.max(0, h.spent))) || 1, bw = W / n;
  const y = (v) => H - 20 - (Math.max(0, v) / max) * (H - 30);
  const w = n > 12 ? bw * 0.7 : bw - 10, pad = (bw - w) / 2;
  let g = "";
  history.forEach((h, i) => {
    const x = i * bw + pad, top = y(h.spent);
    const label = n <= 12 || (n - 1 - i) % 3 === 0;
    const mes = MES[Number(h.month.slice(5)) - 1];
    g += `<rect x="${x}" y="${top}" width="${w}" height="${H - 20 - top}" rx="${n > 12 ? 2 : 4}" fill="var(${h.spent > (income || target) ? "--ink-3" : "--brand"})" opacity="${i === n - 1 ? 1 : h.cardOnly ? 0.25 : 0.55}"><title>${mes}/${h.month.slice(2, 4)} · ${brl(h.spent)}${h.cardOnly ? " · só cartão" : ""}</title></rect>
      ${label ? `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${n > 12 && h.month.endsWith("-01") ? h.month.slice(2, 4) : mes}</text>` : ""}`;
  });
  const kk = (x) => (x >= 1000 ? (x / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k" : Math.round(x));
  const halo = 'paint-order="stroke" stroke="var(--surface)" stroke-width="3"';
  g += `<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--brand)" stroke-dasharray="4 4"/>`;
  if (income) g += `<line x1="0" x2="${W}" y1="${y(income)}" y2="${y(income)}" stroke="var(--ok)" stroke-width="1.5"/><text x="${W}" y="${y(income) - 4}" text-anchor="end" font-size="10" fill="var(--ok)" ${halo}>entra ${kk(income)}</text>`;
  g += `<text x="2" y="${Math.min(y(target), income ? y(income) : Infinity) - 4}" font-size="10" fill="var(--brand)" ${halo}>meta ${kk(target)} ┄</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="mt10" role="img" aria-label="Gasto por mês, últimos ${n} meses">${g}</svg>`;
}
