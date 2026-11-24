// Projeção › Cenários: wealth at the end of next year in each spending scenario (real pace · target · plan), the
// milestones each one reaches, and a slider for "what if I spend X a month".
import { brl, mil, MES } from "../../lib/format.js";
import { ui, MIN, STEP } from "./state.js";
import { chart } from "./chart.js";

export const id = "scenarios";
export const label = "Cenários";

export function render(t) {
  const { scns, y0, y1, levels, hits, realSpend, max } = t;
  const when = (m) => (m ? `${MES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}` : `após ${y0 + 3}`);
  const perK = t.run(ui.chosen).byYear[y0] - t.run(ui.chosen + STEP).byYear[y0];
  return `<div class="card">
      <div class="label">Fim de ${y0}</div>
      <div class="hero-row"><span class="big" data-o="hv"></span><span class="strong sm" data-o="hg"></span></div>
      <div class="muted sm" data-o="hs"></div>
      <div class="scn">${scns.map(([k, label, sp]) => `<button data-s="${k}" class="${k === ui.scenario ? "on" : ""}"><b>${label}</b><small>${mil(sp)}/mês</small></button>`).join("")}</div>
      <svg data-o="chart" viewBox="0 0 340 170" class="mt10" role="img" aria-label="Patrimônio projetado por cenário até dezembro de ${y1}"></svg>
      <div class="lg"><span><i style="background:var(--brand)"></i>cenário escolhido</span><span><i style="background:var(--ink-3)"></i>outros</span><span><i class="pt"></i>real</span></div>
    </div>
    <div class="card">
      <div class="label">Marcos</div>
      <table class="ms"><tr><th></th>${levels.map((l) => `<th>${l / 1000} mil</th>`).join("")}</tr>
        ${hits.map(([k, label, h]) => `<tr data-row="${k}" class="${k === ui.scenario ? "on" : ""}"><td>${label}</td>${h.map((x) => `<td>${when(x.month)}</td>`).join("")}</tr>`).join("")}</table>
    </div>
    <div class="card">
      <div class="label">E se eu gastar por mês</div>
      <div class="kpi" data-o="spend"></div>
      <input type="range" data-i="spend" min="${MIN}" max="${max}" step="100" value="${ui.chosen}" aria-label="Gasto mensal">
      <div class="row muted sm"><span>${mil(MIN)}</span><span>ritmo real ${mil(realSpend)}</span></div>
      <div class="split">
        <div class="tile"><span class="muted">Fim de ${y0}</span><b data-o="y0"></b></div>
        <div class="tile"><span class="muted">Fim de ${y1}</span><b data-o="y1"></b></div>
      </div>
      <div class="muted mt10">Cada <b class="ink">${brl(STEP)} a menos</b> por mês = <b class="ok">+${mil(perK)}</b> no fim de ${y0}.</div>
    </div>`;
}

export function bind(pane, t, ctx, { rerender }) {
  const { scns, y0, y1, start, run, planSpend, rr, spend: sp } = t;
  const out = (k) => pane.querySelector(`[data-o="${k}"]`);
  const r = run(sp).byYear[y0];
  out("hv").textContent = mil(r);
  const gap = r - run(planSpend).byYear[y0];
  out("hg").innerHTML = sp === planSpend ? '<span class="muted">o plano do arquivo</span>' : `<span class="${gap >= 0 ? "ok" : "bad"}">${gap >= 0 ? "+" : "−"}${mil(Math.abs(gap)).replace("−", "")} vs. plano</span>`;
  out("hs").textContent = `Gastando ${brl(sp)}/mês a partir do próximo mês · hoje ${mil(start)}`;
  out("chart").innerHTML = chart(scns, ui.scenario, run, start, t.v.today, y1, rr);
  const slide = () => {
    const byYear = run(ui.chosen).byYear;
    out("spend").textContent = brl(ui.chosen);
    out("y0").textContent = mil(byYear[y0]);
    out("y1").textContent = mil(byYear[y1]);
  };
  pane.querySelector('[data-i="spend"]').addEventListener("input", (e) => { ui.chosen = Number(e.target.value); slide(); });
  // The scenario also drives Real × plano: redraw the whole tab.
  pane.onclick = (e) => {
    const b = e.target.closest("[data-s]");
    if (b && b.dataset.s !== ui.scenario) { ui.scenario = b.dataset.s; rerender(); }
  };
  slide();
}
