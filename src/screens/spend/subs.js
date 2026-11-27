// Gastos › Assinaturas: what keeps costing every month or year, in one list, with what it adds up to in a year.
// Found in the statements (a charge that repeats monthly) or in Ajustes › Contas (a conta or renewal with a price).
// One tap hides what is not really a subscription (kept on this device, `hiddenSubs`); it can be brought back.
import { brl, ddmm, ddmmyyyy, esc } from "../../lib/format.js";
import { CLUSTERS } from "../../lib/spend.js";

export const id = "subs";
export const label = "Assinaturas";

const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));
const SOON = 60; // days: a renewal this close gets a chip
let showHidden = false;
const where = (s) => (s.src === "card" ? "cartão" : s.src === "account" ? "conta" : "Ajustes › Contas");

export function render(t) {
  const s = t.subscriptions;
  if (!s || (!s.monthly.length && !s.yearly.length && !s.hidden?.length)) return '<div class="card empty"><b>Nenhuma assinatura</b>Nenhuma cobrança se repete todo mês nos últimos meses.</div>';
  return `<div class="card">
      <div class="row"><div class="label">Assinaturas e mensalidades</div><span class="muted sm">${s.monthly.length + s.yearly.length} itens</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(s.perMonth)}</span><span class="muted">por mês</span></div></div>
      <div class="muted mt6"><b class="ink">${brl(s.perYear)}</b> em 12 meses</div>
    </div>
    ${list("Todo mês", s.monthly)}
    ${list("Todo ano", s.yearly)}
    ${hiddenCard(s.hidden || [])}
    <div class="muted xs mt6">Encontradas: cobranças que se repetem todo mês (±20%) no cartão ou na conta. As de Ajustes › Contas entram com o valor de lá. Parcelas não entram. Ocultar tira do total.</div>`;
}

function list(title, items) {
  if (!items.length) return "";
  const rows = items.map((s) => {
    const sub = [where(s), s.day ? `dia ${s.day}` : "", s.cluster && GROUP[s.cluster] ? GROUP[s.cluster] : "", s.renews ? `renova ${ddmmyyyy(s.renews)}` : ""].filter(Boolean).join(" · ");
    const up = s.raise ? ` <span class="chip warn">▲ +${brl(s.raise.to - s.raise.from, 2)} desde ${ddmm(s.raise.since)}</span>` : "";
    const chip = up + (s.days != null && s.days <= SOON ? ` <span class="chip bad">${s.days === 0 ? "renova hoje" : `em ${s.days} d`}</span>` : "");
    const year = s.per === "year" ? `<small>${brl(s.amount / 12)}/mês</small>` : `<small>${brl(s.amount * 12)}/ano</small>`;
    return `<div><span class="l"><span><span class="find" data-find="${esc(s.name)}">${esc(s.name)}</span>${chip}</span><small>${sub}</small></span><span class="nw sub-amt"><b>${brl(s.amount, 2)}</b>${year}<button class="lnk muted xs" data-hide="${esc(s.key)}">ocultar</button></span></div>`;
  }).join("");
  return `<div class="sec">${title}</div><div class="card"><div class="list">${rows}</div></div>`;
}

function hiddenCard(items) {
  if (!items.length) return "";
  const rows = showHidden ? `<div class="list mt6">${items.map((s) => `<div><span class="l">${esc(s.name)}<small>${brl(s.amount, 2)}${s.per === "year" ? "/ano" : "/mês"}</small></span><button class="lnk" data-show="${esc(s.key)}">mostrar</button></div>`).join("")}</div>` : "";
  return `<div class="card"><button class="lnk" data-a="hidden">${showHidden ? "▾" : "▸"} Ocultas (${items.length})</button>${rows}</div>`;
}

export function bind(pane, t, ctx, { repaint, rerender }) {
  pane.onclick = (e) => {
    if (e.target.closest('[data-a="hidden"]')) { showHidden = !showHidden; repaint(); return; }
    const hide = e.target.closest("[data-hide]")?.dataset.hide, show = e.target.closest("[data-show]")?.dataset.show;
    if (!hide && !show) return;
    const cur = ctx.data.hiddenSubs || [];
    const next = hide ? [...new Set([...cur, hide])] : cur.filter((k) => k !== show);
    ctx.save({ ...ctx.data, hiddenSubs: next }).then(rerender);
  };
}
