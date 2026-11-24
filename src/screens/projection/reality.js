// Projeção › Real × plano: the real wealth since the projection's start against the chosen scenario.
import { brl, mil, ddmm } from "../../lib/format.js";
import { bankName } from "../../lib/model.js";

export const id = "reality";
export const label = "Real × plano";

export const render = (t) => realityCard(t.rr, t.label);

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
