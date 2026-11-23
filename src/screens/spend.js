import { brl, MES, MESES, ddmm } from "../lib/format.js";
import { header, needsSetup } from "./home.js";

const COLOR = { travel: "--c-travel", food: "--c-food", shop: "--c-shop", serv: "--c-serv", pix: "--c-pix", trans: "--c-trans", bills: "--c-bills", health: "--c-health", leis: "--c-leis", tobacco: "--c-cash", cash: "--c-cash", other: "--ink-3" };

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Gastos")) return;
  const { month: v, avg12, avgN } = ctx.view();
  const C = 2 * Math.PI * 56;
  const share = Math.min(1, v.spent / v.target);
  const m = Number(v.month.slice(5, 7));
  const elapsed = (v.length - v.daysLeft + 0.5) / v.length;
  const pace = v.over ? ["bad", "acima da meta"] : v.spent / v.target > elapsed + 0.05 ? ["warn", "acima do ritmo"] : ["", "no ritmo da meta"];

  el.innerHTML = `${header(ctx, "Gastos")}
    <div class="sub mb10">${MESES[m - 1]}${v.cycle ? ` · ciclo ${ddmm(v.start)}–${ddmm(v.end)}` : ""} · ${v.daysLeft} ${v.daysLeft === 1 ? "dia restante" : "dias restantes"}</div>
    <div class="card">
      <div class="row">
        <div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="56" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
          <circle cx="66" cy="66" r="56" fill="none" stroke="var(${v.over ? "--bad" : "--brand"})" stroke-width="12" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${C * share} ${C}"/></svg>
          <div class="c"><b>${brl(v.spent)}</b><span class="muted">de ${brl(v.target)}</span></div></div>
        <div class="grow">
          <div class="label">Pode gastar por dia</div><div class="kpi${v.over ? " bad" : ""}">${brl(v.perDay)}</div>
          <div class="muted mt6">${v.left >= 0 ? `Restam <b class="ink">${brl(v.left)}</b> até ${ddmm(v.end)}` : `Passou <b class="bad">${brl(-v.left)}</b> da meta`}</div>
          <span class="chip ${pace[0]} mt10">${pace[1]}</span>
        </div>
      </div>
    </div>
    <div class="card"><div class="row"><div class="label">Por grupo</div><span class="muted">gasto / limite</span></div>
      ${v.clusters.map((c) => {
        const p = c.limit ? Math.min(100, (c.spent / c.limit) * 100) : c.spent > 0 ? 100 : 0;
        return `<div class="bar${c.over ? " over" : ""}"><div class="t"><span>${c.label}</span><span>${brl(c.spent)}${c.limit !== null ? ` / ${brl(c.limit)}` : ""}</span></div>
        <div class="track"><div class="fill" style="width:${p}%;background:var(${c.over ? "--bad" : COLOR[c.id]})"></div></div></div>`;
      }).join("")}
    </div>
    <div class="card">
      <div class="label">Últimos meses</div>
      ${chart(v.history, v.target)}
      <div class="muted">Média ${avgN} meses: ${brl(avg12)} · meta ${brl(v.target)}</div>
    </div>`;
  el.addEventListener("click", (e) => { if (e.target.closest('[data-a="refresh"]')) ctx.refresh(); });
}

function chart(history, target) {
  const W = 340, H = 120, max = Math.max(target * 1.2, ...history.map((h) => h.spent)) || 1, bw = W / history.length;
  const y = (v) => H - 20 - (v / max) * (H - 30);
  let g = "";
  history.forEach((h, i) => {
    const x = i * bw + 5, top = y(h.spent);
    g += `<rect x="${x}" y="${top}" width="${bw - 10}" height="${H - 20 - top}" rx="4" fill="var(${h.spent > target ? "--ink-3" : "--brand"})" opacity="${i === history.length - 1 ? 1 : 0.55}"/>
      <text x="${x + (bw - 10) / 2}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${MES[Number(h.month.slice(5)) - 1]}</text>`;
  });
  g += `<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--brand)" stroke-dasharray="4 4"/><text x="${W}" y="${y(target) - 4}" text-anchor="end" font-size="10" fill="var(--brand)">meta ${target >= 1000 ? (target / 1000).toLocaleString("pt-BR") + "k" : target}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="mt10" role="img" aria-label="Gasto por mês, últimos 12 meses">${g}</svg>`;
}

