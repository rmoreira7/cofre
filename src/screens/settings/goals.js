// Ajustes › Metas: the spending target and month mode, each group's limit, and the investment parameters (CDI,
// CDB floor, idle-cash alert, the part of the Nubank reserve set apart for the card bill). Every field saves when it loses focus.
import { CLUSTERS, DEFAULT_TARGET, limitsFor } from "../../lib/spend.js";
import { brl, esc } from "../../lib/format.js";
import { saveSettings } from "./common.js";

export const id = "goals";
export const label = "Metas";

const LIMITED = CLUSTERS.filter((c) => c.limit !== null);

export function render(t, ctx) {
  const s = ctx.data.settings || {};
  return `<div class="sec">Gastos</div>${spendCard(s, t.trends)}
    <div class="sec">Investimentos</div>${investCard(s)}`;
}

export function bind(pane, t, ctx, { repaint }) {
  const save = (patch, note) => saveSettings(ctx, pane, patch, note);
  paintSum(pane);
  pane.oninput = (e) => { if (e.target.matches("[data-l], [name=target]")) paintSum(pane); };
  pane.onchange = (e) => {
    const f = e.target;
    if (f.name === "target") return save({ target: Math.max(0, Number(f.value) || 0) }, "spend");
    if (f.dataset.l) return save({ limits: { ...(ctx.data.settings?.limits || {}), [f.dataset.l]: Math.max(0, Number(f.value) || 0) } }, "spend");
    if (f.name === "cdi") return save({ cdi: Number(f.value) || 13.65 }, "inv");
    if (f.name === "cdbMin") return save({ cdbMin: Number(f.value) || 110 }, "inv");
    if (f.name === "idleCash") return save({ idleCash: Math.max(0, Number(f.value) || 0) }, "inv");
    if (f.name === "billReserve") return save({ billReserve: Math.max(0, Number(f.value) || 0) }, "inv");
  };
  pane.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mm) { await save({ monthMode: b.dataset.mm }); repaint(); return; }
    if (b.dataset.a === "median") {
      const target = ctx.data.settings?.target ?? DEFAULT_TARGET, limits = limitsFor(target, t.trends);
      if (limits) { await save({ limits: { ...(ctx.data.settings?.limits || {}), ...limits } }); repaint(); }
    }
  };
}

function spendCard(s, trends) {
  const lim = (c) => s.limits?.[c.id] ?? c.limit;
  return `<div class="card">
    <label class="in row"><span>Meta por ${s.monthMode === "calendar" ? "mês" : "ciclo"} (R$)</span><input name="target" type="number" inputmode="numeric" min="0" step="100" value="${s.target ?? DEFAULT_TARGET}"></label>
    <div class="row field-row"><span>Mês de gastos</span><span class="seg mini-seg">${[["cycle", "Ciclo do cartão"], ["calendar", "Mês civil"]].map(([k, l]) => `<button data-mm="${k}" class="${(s.monthMode === "calendar" ? "calendar" : "cycle") === k ? "on" : ""}">${l}</button>`).join("")}</span></div>
    <div class="row mt10"><span class="label">Limites por grupo</span><span class="muted sm">${trends ? "mediana · " : ""}limite</span></div>
    ${LIMITED.map((c) => `<label class="limrow"><span>${esc(c.label)}</span><small>${trends ? brl(trends[c.id]?.median || 0) : ""}</small><input data-l="${c.id}" type="number" inputmode="numeric" min="0" step="10" value="${lim(c)}" aria-label="Limite ${esc(c.label)}"></label>`).join("")}
    <div class="sumbar" data-sum></div>
    <div class="row mt10">${trends ? '<button class="lnk" data-a="median">Recalcular pela mediana</button>' : "<span></span>"}<span class="muted sm" data-saved="spend">salva ao sair do campo</span></div>
  </div>`;
}

function paintSum(el) {
  const box = el.querySelector("[data-sum]");
  if (!box) return;
  const total = [...el.querySelectorAll("[data-l]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
  const target = Number(el.querySelector("[name=target]").value) || 0;
  box.classList.toggle("warn", total !== target);
  box.innerHTML = `<span>Soma dos limites ${brl(total)}</span><span>${total === target ? "= meta ✓" : `meta ${brl(target)} · ${total > target ? "+" : "−"}${brl(Math.abs(total - target))}`}</span>`;
}

function investCard(s) {
  const f = (name, label, help, value, step, unit) => `<label class="in row"><span>${label}<small class="block muted">${help}</small></span><span class="unit-in"><input name="${name}" type="number" inputmode="decimal" min="0" step="${step}" value="${value}"><i>${unit}</i></span></label>`;
  return `<div class="card">
    ${f("cdi", "CDI", "usado na Projeção e na comparação CDB × LCA", s.cdi ?? 13.65, "0.05", "% a.a.")}
    ${f("cdbMin", "CDB mínimo", "abaixo disso, o vencimento pede outro título", s.cdbMin ?? 110, "1", "% CDI")}
    ${f("idleCash", "Dinheiro parado", "alerta acima deste saldo em conta", s.idleCash ?? 5000, "500", "R$")}
    ${f("billReserve", "Reserva da fatura Nubank", "parte dos CDBs Nubank que paga o cartão; 0 = nenhuma", s.billReserve ?? 0, "500", "R$")}
    <div class="row"><span></span><span class="muted sm" data-saved="inv">salva ao sair do campo</span></div>
  </div>`;
}
