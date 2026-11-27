// Gastos › Assinaturas: what keeps costing every month or year, in one list, with what it adds up to in a year.
// Found in the statements (a charge that repeats monthly) or in Ajustes › Contas (a conta or renewal with a price).
import { brl, ddmmyyyy, esc } from "../../lib/format.js";
import { CLUSTERS } from "../../lib/spend.js";

export const id = "subs";
export const label = "Assinaturas";

const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));
const SOON = 60; // days: a renewal this close gets a chip
const where = (s) => (s.src === "card" ? "cartão" : s.src === "account" ? "conta" : "Ajustes › Contas");

export function render(t) {
  const s = t.subscriptions;
  if (!s || (!s.monthly.length && !s.yearly.length)) return '<div class="card empty"><b>Nenhuma assinatura</b>Nenhuma cobrança se repete todo mês nos últimos meses.</div>';
  return `<div class="card">
      <div class="row"><div class="label">Assinaturas e mensalidades</div><span class="muted sm">${s.monthly.length + s.yearly.length} itens</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(s.perMonth)}</span><span class="muted">por mês</span></div></div>
      <div class="muted mt6"><b class="ink">${brl(s.perYear)}</b> em 12 meses</div>
    </div>
    ${list("Todo mês", s.monthly)}
    ${list("Todo ano", s.yearly)}
    <div class="muted xs mt6">Encontradas: cobranças que se repetem todo mês (±20%) no cartão ou na conta. As de Ajustes › Contas entram com o valor de lá. Parcelas não entram.</div>`;
}

function list(title, items) {
  if (!items.length) return "";
  const rows = items.map((s) => {
    const sub = [where(s), s.day ? `dia ${s.day}` : "", s.cluster && GROUP[s.cluster] ? GROUP[s.cluster] : "", s.renews ? `renova ${ddmmyyyy(s.renews)}` : ""].filter(Boolean).join(" · ");
    const chip = s.days != null && s.days <= SOON ? ` <span class="chip bad">${s.days === 0 ? "renova hoje" : `em ${s.days} d`}</span>` : "";
    const year = s.per === "year" ? `<small>${brl(s.amount / 12)}/mês</small>` : `<small>${brl(s.amount * 12)}/ano</small>`;
    return `<div><span class="l">${esc(s.name)}${chip}<small>${sub}</small></span><span class="nw sub-amt"><b>${brl(s.amount, 2)}</b>${year}</span></div>`;
  }).join("");
  return `<div class="sec">${title}</div><div class="card"><div class="list">${rows}</div></div>`;
}
