import { brl, mil } from "../lib/format.js";
import { project, validParams, assumptions } from "../lib/projection.js";
import { header, needsSetup } from "./home.js";

const MIN = 5000;
let chosen = null;

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Projeção")) return;
  const v = ctx.view();
  const p = ctx.data.rules?.projection;
  if (!validParams(p)) {
    el.innerHTML = `${header(ctx, "Projeção")}<div class="card empty"><b>Sem premissas</b>O arquivo de regras não traz os parâmetros da projeção.<br>Gere de novo no notebook com <code>projection.json</code> e importe em Ajustes.</div>`;
    return;
  }
  const now = Math.max(MIN + 100, Math.ceil(v.avg3 / 100) * 100);
  const target = ctx.data.settings?.target ?? 7000;
  if (chosen === null || chosen > now) chosen = Math.min(now, Math.max(MIN, target));
  const run = (spend) => project(p, { start: v.mine.total, today: v.today, spend }).byYear;
  const y0 = Number(v.today.slice(0, 4)) + 1, y1 = y0 + 1;
  const base = run(now);
  const steps = Array.from({ length: 21 }, (_, i) => MIN + ((now - MIN) * i) / 20);
  const curve = steps.map((s) => [s, run(s)[y0]]);

  el.innerHTML = `${header(ctx, "Projeção")}
    <div class="sub mb10">Patrimônio ${v.mine.banks.map((b) => b.name).join(" + ")}</div>
    <div class="card">
      <div class="label">Se eu gastar por mês</div>
      <div class="kpi" data-o="spend"></div>
      <input type="range" data-i="spend" min="${MIN}" max="${now}" step="100" value="${chosen}" aria-label="Gasto mensal">
      <div class="row muted"><span>${mil(MIN)}</span><span>hoje ≈ ${mil(now)} <small>(média 3 meses)</small></span></div>
      <div class="split">
        <div class="tile"><span class="muted">Fim de ${y0}</span><b data-o="y0"></b></div>
        <div class="tile"><span class="muted">Fim de ${y1}</span><b data-o="y1"></b></div>
      </div>
      <div class="muted mt10" data-o="delta"></div>
    </div>
    <div class="card">
      <div class="label">Curva · fim de ${y0}</div>
      <svg data-o="curve" viewBox="0 0 340 170" class="mt8" role="img" aria-label="Patrimônio no fim de ${y0} por gasto mensal"></svg>
      <div class="muted">${assumptions(p)} · parte de ${brl(v.mine.total)} hoje</div>
    </div>`;

  const out = (k) => el.querySelector(`[data-o="${k}"]`);
  const W = 340, H = 170, m = { l: 8, r: 8, t: 14, b: 26 };
  const lo = Math.min(...curve.map((c) => c[1])), hi = Math.max(...curve.map((c) => c[1]));
  const x = (s) => m.l + ((s - MIN) / (now - MIN)) * (W - m.l - m.r);
  const y = (val) => m.t + (1 - (val - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const pts = curve.map(([s, val]) => `${x(s)},${y(val)}`).join(" ");

  const paint = () => {
    const r = run(chosen);
    out("spend").textContent = brl(chosen);
    out("y0").textContent = mil(r[y0]);
    out("y1").textContent = mil(r[y1]);
    const d0 = r[y0] - base[y0], d1 = r[y1] - base[y1];
    out("delta").innerHTML = chosen === now ? "No ritmo de hoje." : `vs. hoje: <b class="ok">+${mil(d0)}</b> em ${y0} · <b class="ok">+${mil(d1)}</b> em ${y1}`;
    out("curve").innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linejoin="round"/>
      <line x1="${x(chosen)}" x2="${x(chosen)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="3 4"/>
      <circle cx="${x(chosen)}" cy="${y(r[y0])}" r="6" fill="var(--brand)" stroke="var(--surface)" stroke-width="3"/>
      <circle cx="${x(now)}" cy="${y(base[y0])}" r="4" fill="var(--ink-3)"/>
      <text x="${x(now)}" y="${y(base[y0]) - 10}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">hoje</text>
      <text x="${m.l}" y="${H - 6}" font-size="10.5" fill="var(--ink-3)">${mil(MIN).replace(",0 mil", "k").replace(" mil", "k")}</text>
      <text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">${mil(now).replace(" mil", "k")}</text>`;
  };
  el.querySelector('[data-i="spend"]').addEventListener("input", (e) => { chosen = Number(e.target.value); paint(); });
  el.addEventListener("click", (e) => { if (e.target.closest('[data-a="refresh"]')) ctx.refresh(); });
  paint();
}
