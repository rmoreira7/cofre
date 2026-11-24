import { brl, mil, pct, ddmm, MES } from "../lib/format.js";
import { project, validParams, assumptions, reality, salaryAt, milestones, nextLevels } from "../lib/projection.js";
import { bankName } from "../lib/model.js";
import { header, needsSetup } from "./home.js";

const MIN = 5000;
const STEP = 1000; // the "each R$ X a month" rule of thumb
const PLAN_SPEND = 7000; // the spending the original simulation assumed (projection.spend in the rules file overrides it)
let chosen = null;
let scenario = "real";

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Projeção")) return;
  const v = ctx.view();
  const p = ctx.data.rules?.projection;
  if (!validParams(p)) {
    el.innerHTML = `${header(ctx, "Projeção")}<div class="card empty"><b>Sem premissas</b>O arquivo de regras não traz os parâmetros da projeção.<br>Gere de novo no notebook com <code>projection.json</code> e importe em Ajustes.</div>`;
    return;
  }
  const target = ctx.data.settings?.target ?? 7000;
  const realSpend = Math.round(v.avg12 / 100) * 100;
  // Ritmo real = the average of the closed cycles; Meta = the Gastos target; Plano = the original simulation's spending.
  const planSpend = p.spend ?? PLAN_SPEND;
  const scns = [["real", "Ritmo real", realSpend], ["meta", target === planSpend ? "Meta = plano" : "Meta", target], ["plan", "Plano", planSpend]]
    .filter(([k, , sp], i, all) => all.findIndex((x) => x[2] === sp) === i);
  if (!scns.some((x) => x[0] === scenario)) scenario = scns[0][0];
  const y0 = Number(v.today.slice(0, 4)) + 1, y1 = y0 + 1;
  const start = v.mine.total;
  const run = (spend, untilYear = y1) => project(p, { start, today: v.today, spend, untilYear });
  const max = Math.max(MIN + 100, Math.ceil(Math.max(realSpend, target) / 100) * 100);
  if (chosen === null || chosen > max) chosen = Math.min(max, Math.max(MIN, target));
  const perK = run(chosen).byYear[y0] - run(chosen + STEP).byYear[y0];
  const levels = nextLevels(start);
  const hits = scns.map(([k, label, sp]) => [k, label, milestones(run(sp, y0 + 3).path, levels)]);
  const when = (m) => (m ? `${MES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}` : `após ${y0 + 3}`);

  el.innerHTML = `${header(ctx, "Projeção")}
    <div class="sub mb10">Patrimônio ${v.mine.banks.map((b) => b.name).join(" + ")}${v.wealth.banks.some((b) => b.joint) ? " · sem a conta conjunta (as premissas são suas)" : ""}</div>
    <div class="card">
      <div class="label">Fim de ${y0}</div>
      <div class="hero-row"><span class="big" data-o="hv"></span><span class="strong sm" data-o="hg"></span></div>
      <div class="muted sm" data-o="hs"></div>
      <div class="scn">${scns.map(([k, label, sp]) => `<button data-s="${k}" class="${k === scenario ? "on" : ""}"><b>${label}</b><small>${mil(sp)}/mês</small></button>`).join("")}</div>
      <svg data-o="chart" viewBox="0 0 340 170" class="mt10" role="img" aria-label="Patrimônio projetado por cenário até dezembro de ${y1}"></svg>
      <div class="lg"><span><i style="background:var(--brand)"></i>cenário escolhido</span><span><i style="background:var(--ink-3)"></i>outros</span><span><i class="pt"></i>real</span></div>
    </div>
    <div class="card">
      <div class="label">Marcos</div>
      <table class="ms"><tr><th></th>${levels.map((l) => `<th>${l / 1000} mil</th>`).join("")}</tr>
        ${hits.map(([k, label, h]) => `<tr data-row="${k}"><td>${label}</td>${h.map((x) => `<td>${when(x.month)}</td>`).join("")}</tr>`).join("")}</table>
    </div>
    <div data-o="real"></div>
    <div class="card">
      <div class="label">E se eu gastar por mês</div>
      <div class="kpi" data-o="spend"></div>
      <input type="range" data-i="spend" min="${MIN}" max="${max}" step="100" value="${chosen}" aria-label="Gasto mensal">
      <div class="row muted sm"><span>${mil(MIN)}</span><span>ritmo real ${mil(realSpend)}</span></div>
      <div class="split">
        <div class="tile"><span class="muted">Fim de ${y0}</span><b data-o="y0"></b></div>
        <div class="tile"><span class="muted">Fim de ${y1}</span><b data-o="y1"></b></div>
      </div>
      <div class="muted mt10">Cada <b class="ink">${brl(STEP)} a menos</b> por mês = <b class="ok">+${mil(perK)}</b> no fim de ${y0}.</div>
    </div>
    ${assumptionsCard(v, p, target)}
    <div class="muted sm">${assumptions(p)} · parte de ${brl(start)} hoje</div>`;

  const out = (k) => el.querySelector(`[data-o="${k}"]`);
  const series = (() => { const m = new Map(); for (const w of ctx.data.rules?.wealth || []) m.set(w.d, w); for (const w of ctx.data.wealthLog || []) m.set(w.d, w); return [...m.values()]; })();
  const paint = () => {
    const [, label, sp] = scns.find((x) => x[0] === scenario);
    const r = run(sp).byYear[y0];
    el.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === scenario));
    el.querySelectorAll("[data-row]").forEach((t) => t.classList.toggle("on", t.dataset.row === scenario));
    out("hv").textContent = mil(r);
    const gap = r - run(planSpend).byYear[y0];
    out("hg").innerHTML = sp === planSpend ? '<span class="muted">o plano do arquivo</span>' : `<span class="${gap >= 0 ? "ok" : "bad"}">${gap >= 0 ? "+" : "−"}${mil(Math.abs(gap)).replace("−", "")} vs. plano</span>`;
    out("hs").textContent = `Gastando ${brl(sp)}/mês a partir do próximo mês · hoje ${mil(start)}`;
    const rr = reality(p, series, { spend: sp, from: p.from, today: v.today });
    out("chart").innerHTML = chart(scns, scenario, run, start, v.today, y1, rr);
    out("real").innerHTML = realityCard(rr, label);
  };
  const slide = () => {
    const r = run(chosen).byYear;
    out("spend").textContent = brl(chosen);
    out("y0").textContent = mil(r[y0]);
    out("y1").textContent = mil(r[y1]);
  };
  el.querySelector('[data-i="spend"]').addEventListener("input", (e) => { chosen = Number(e.target.value); slide(); });
  el.onclick = (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
    const b = e.target.closest("[data-s]");
    if (b) { scenario = b.dataset.s; paint(); }
  };
  paint();
  slide();
}

// Every scenario to December of `y1`, the chosen one in brand; the real points (since the projection's start) first.
function chart(scns, chosen, run, start, today, y1, rr) {
  const W = 340, H = 170, m = { l: 4, r: 40, t: 20, b: 22 };
  const ms = (d) => Date.parse(d + "T12:00:00Z");
  const from = rr?.from && rr.from < today ? rr.from : today, to = `${y1}-12-31`;
  const end = (mo) => { const [y, mm] = mo.split("-").map(Number); return `${mo}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`; };
  const lines = scns.map(([k, label, sp]) => [k, label, [{ d: today, v: start }, ...run(sp).path.map((q) => ({ d: end(q.month), v: q.worth }))]]);
  const vals = [...lines.flatMap((l) => l[2].map((q) => q.v)), ...(rr?.actual || []).map((a) => a.real)];
  const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals);
  const x = (d) => m.l + ((ms(d) - ms(from)) / (ms(to) - ms(from))) * (W - m.l - m.r);
  const y = (val) => m.t + (1 - (val - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  let g = "";
  for (const k of nextLevels(lo, 6).filter((k) => k <= hi)) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(k)}" y2="${y(k)}" stroke="var(--line)"/><text x="${W - m.r + 4}" y="${y(k) + 3}" font-size="9.5" fill="var(--ink-3)">${k / 1000}k</text>`;
  for (const [k, label, pts] of [...lines].sort((a, b) => (a[0] === chosen) - (b[0] === chosen))) {
    const on = k === chosen, last = pts.at(-1);
    g += `<polyline points="${pts.map((q) => `${x(q.d)},${y(q.v)}`).join(" ")}" fill="none" stroke="var(${on ? "--brand" : "--ink-3"})" stroke-width="${on ? 3 : 1.5}" opacity="${on ? 1 : 0.55}" stroke-linejoin="round"/>
      <text x="${x(last.d) - 2}" y="${y(last.v) - 5}" text-anchor="end" font-size="9.5" font-weight="${on ? 700 : 400}" fill="var(${on ? "--brand" : "--ink-3"})">${label}</text>`;
  }
  for (const a of rr?.actual || []) g += `<circle cx="${x(a.d)}" cy="${y(a.real)}" r="3" fill="var(--c-travel)"><title>${ddmm(a.d)} · ${brl(a.real)}</title></circle>`;
  const t = (d, lab, anchor) => `<text x="${x(d)}" y="${H - 6}" text-anchor="${anchor}" font-size="10" fill="var(--ink-3)">${lab}</text>`;
  g += t(from, `${MES[Number(from.slice(5, 7)) - 1]}/${from.slice(2, 4)}`, "start") + t(`${y1 - 1}-12-31`, `dez/${String(y1 - 1).slice(2)}`, "middle") + t(to, `dez/${String(y1).slice(2)}`, "end");
  return g;
}

// Real × projetado: the chosen scenario from the projection's start date against what happened, same banks.
function realityCard(r, label) {
  if (!r || r.actual.length < 2) return `<div class="card"><div class="label">Real × projetado</div><div class="muted mt6">Começa a comparar a partir da próxima atualização.</div></div>`;
  const g = r.gap;
  return `<div class="card">
      <div class="row"><div class="label">Real × projetado</div><span class="muted sm">desde ${ddmm(r.from)}</span></div>
      <div class="split">
        <div class="tile"><span class="muted">Real hoje</span><b>${mil(r.today.real)}</b><span class="muted sm">${r.today.real >= r.start ? "+" : "−"}${brl(Math.abs(r.today.real - r.start))} desde ${ddmm(r.from)}</span></div>
        <div class="tile"><span class="muted">No cenário</span><b>${mil(r.today.projected)}</b><span class="muted sm">${label.toLowerCase()}</span></div>
      </div>
      <div class="mt8 ${g >= 0 ? "ok" : "bad"} strong">${g >= 0 ? "À frente" : "Atrás"} em ${brl(Math.abs(g))}</div>
      <div class="muted sm mt6">Mesmos bancos de ${ddmm(r.from)} (${r.banks.map(bankName).join(" + ")})${r.extra.length ? `; ${r.extra.map(bankName).join(" e ")} ${r.extra.length > 1 ? "entraram depois e ficam" : "entrou depois e fica"} fora` : ""}. O mês em curso só rende na projeção: salário e fatura dele contam no fechamento, então a diferença oscila até lá.</div>
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
  </div>`;
}
