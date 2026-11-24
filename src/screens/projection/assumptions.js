// Projeção › Premissas: what the projection assumes against what the data shows.
import { brl, pct } from "../../lib/format.js";
import { assumptions, salaryAt } from "../../lib/projection.js";

export const id = "assumptions";
export const label = "Premissas";

export const render = (t) => `${assumptionsCard(t.v, t.p, t.target)}
    <div class="muted sm">${assumptions(t.p)} · parte de ${brl(t.start)} hoje</div>`;

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
