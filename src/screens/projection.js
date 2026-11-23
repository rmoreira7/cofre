import { brl, mil, pct, ddmm } from "../lib/format.js";
import { project, validParams, assumptions, reality, salaryAt } from "../lib/projection.js";
import { bankName } from "../lib/model.js";
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
    ${realityCard(ctx, v, p, target)}
    ${assumptionsCard(v, p, target)}
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

// Real × projetado: the plan (target spending) from the projection's start date against what happened, same banks.
function realityCard(ctx, v, p, target) {
  const byDay = new Map();
  for (const w of ctx.data.rules?.wealth || []) byDay.set(w.d, w);
  for (const w of ctx.data.wealthLog || []) byDay.set(w.d, w);
  const r = reality(p, [...byDay.values()], { spend: target, from: p.from, today: v.today });
  if (!r || r.actual.length < 2) return `<div class="card"><div class="label">Real × projetado</div><div class="muted mt6">Começa a comparar a partir da próxima atualização.</div></div>`;
  const W = 340, H = 150, m = { l: 6, r: 6, t: 12, b: 22 };
  const endD = r.knots.find((k) => k.d >= v.today && k.d > r.today.d)?.d || r.knots.at(-1).d;
  const ks = r.knots.filter((k) => k.d <= endD);
  const ms = (d) => Date.parse(d + "T12:00:00Z");
  const vals = [...ks.map((k) => k.v), ...r.actual.map((a) => a.real)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (d) => m.l + ((ms(d) - ms(r.from)) / (ms(endD) - ms(r.from) || 1)) * (W - m.l - m.r);
  const y = (val) => m.t + (1 - (val - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const proj = ks.map((k) => `${x(k.d)},${y(k.v)}`).join(" ");
  const real = r.actual.map((a) => `${x(a.d)},${y(a.real)}`).join(" ");
  const g = r.gap;
  return `<div class="card">
      <div class="row"><div class="label">Real × projetado</div><span class="muted sm">desde ${ddmm(r.from)}</span></div>
      <div class="split">
        <div class="tile"><span class="muted">Real hoje</span><b>${mil(r.today.real)}</b><span class="muted sm">${brl(r.today.real - r.start)} desde ${ddmm(r.from)}</span></div>
        <div class="tile"><span class="muted">Projetado</span><b>${mil(r.today.projected)}</b><span class="muted sm">no plano (gasto ${brl(target)})</span></div>
      </div>
      <div class="mt8 ${g >= 0 ? "ok" : "bad"} strong">${g >= 0 ? "À frente" : "Atrás"} do plano em ${brl(Math.abs(g))}</div>
      <svg viewBox="0 0 ${W} ${H}" class="mt8" role="img" aria-label="Patrimônio real e projetado">
        <polyline points="${proj}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 5"/>
        <polyline points="${real}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linejoin="round"/>
        ${r.actual.map((a) => `<circle cx="${x(a.d)}" cy="${y(a.real)}" r="3.5" fill="var(--brand)"><title>${ddmm(a.d)} · real ${brl(a.real)} · projetado ${brl(a.projected)}</title></circle>`).join("")}
        <text x="${m.l}" y="${H - 6}" font-size="10.5" fill="var(--ink-3)">${ddmm(r.from)}</text>
        <text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">${ddmm(endD)}</text>
      </svg>
      <div class="muted sm">Linha cheia: real · tracejada: projeção. Mesmos bancos de ${ddmm(r.from)} (${r.banks.map(bankName).join(" + ")})${r.extra.length ? `; ${r.extra.map(bankName).join(" e ")} ${r.extra.length > 1 ? "entraram depois e ficam" : "entrou depois e fica"} fora da comparação` : ""}. O mês em curso só ganha rendimento na projeção; entradas e gastos dele contam a partir do fechamento.</div>
    </div>`;
}

// Premissas × realidade: what the projection assumes against what the data shows.
function assumptionsCard(v, p, target) {
  const sal = salaryAt(p, v.today.slice(0, 7));
  const realSal = v.left?.n ? v.left.avg.salary : null;
  const inv = v.mine.banks.filter((b) => b.cdiAvg);
  const w = inv.reduce((a, b) => a + b.invested, 0);
  const realCdi = w ? inv.reduce((a, b) => a + b.cdiAvg * b.invested, 0) / w : null;
  const line = (name, assumed, real, fmt, good) => {
    const ok = real == null ? null : good(real, assumed);
    return `<div><span class="l">${name}<small>premissa ${fmt(assumed)}</small></span><b class="${ok == null ? "" : ok ? "ok" : "bad"}">${real == null ? "—" : fmt(real)}</b></div>`;
  };
  return `<div class="card"><div class="row"><div class="label">Premissas × realidade</div><span class="muted sm">realidade</span></div>
    <div class="list mt6">
      ${line("Salário líquido / mês", sal, realSal, (n) => brl(n), (r, a) => r >= a * 0.97)}
      ${line(`Gasto / mês <span class="muted sm">(média ${v.avgN} meses)</span>`, target, v.avg12, (n) => brl(n), (r, a) => r <= a * 1.03)}
      ${line("Rendimento (% do CDI)", p.cdi_pct, realCdi, (n) => pct(n, 0), (r, a) => r >= a - 1)}
    </div>
    ${v.avg12 > target * 1.03 ? `<div class="muted sm mt6">No ritmo real de gastos (${brl(v.avg12)}), arraste o controle abaixo até "hoje" para ver onde isso leva.</div>` : ""}
  </div>`;
}
