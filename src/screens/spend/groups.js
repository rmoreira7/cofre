// Gastos › Grupos: spending per group against its limit; tap a group for its purchases and change their category.
import { brl, MES, ddmm, esc } from "../../lib/format.js";
import { CLUSTERS } from "../../lib/spend.js";
import { key } from "../../lib/categorize.js";
import { COLOR, kBRL } from "./common.js";

export const id = "groups";
export const label = "Grupos";

let openGroup = null;
let showAll = false;
let mode = "now";
const FIRST = 15;

export function render(t, ctx) {
  const { month: v, rows, trends, avgN } = t;
  const inPeriod = rows.filter((r) => (r.cyc ?? r.m) === v.month);
  const user = ctx.data.userOverrides || {};
  return `    <div class="card"><div class="row"><div class="label">Por grupo</div><div class="seg mini-seg" role="group" aria-label="Mostrar"><button data-m="now" class="${mode === "now" ? "on" : ""}">Ciclo</button><button data-m="avg" class="${mode === "avg" ? "on" : ""}">Média</button></div></div>
      <div class="row muted sm"><span>${mode === "now" ? "gasto no ciclo" : `média de ${avgN} ${v.cycle ? "ciclos" : "meses"}`} / limite</span><span>últimos ${avgN} · 3 vs ${avgN}</span></div>
      ${[...v.clusters].sort((a, b) => (trends?.[b.id]?.avg || 0) - (trends?.[a.id]?.avg || 0)).map((c) => groupRow(c, trends?.[c.id], c.id === "travel" ? wiseHint(rows, v.cycle, avgN) : "", inPeriod, rows, user)).join("")}
    </div>`;
}

export function bind(pane, t, ctx, { repaint, rerender }) {
  pane.onclick = (e) => {
    const md = e.target.closest("[data-m]")?.dataset.m;
    if (md) { mode = md; repaint(); return; }
    if (e.target.closest('[data-a="all"]')) { showAll = true; repaint(); return; }
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (g) { openGroup = openGroup === g ? null : g; showAll = false; repaint(); pane.querySelector(`[data-g="${g}"]`)?.scrollIntoView({ block: "nearest" }); }
  };
  // A category change moves money between groups and cycles: every Gastos pane is redrawn.
  pane.querySelectorAll("select[data-k]").forEach((sel) => sel.addEventListener("change", async () => {
    await ctx.setOverride(sel.dataset.k, sel.value || null);
    rerender();
  }));
}

function groupRow(c, t, hint, inPeriod, rows, user) {
  const val = mode === "now" || !t ? c.spent : t.avg;
  const over = c.limit !== null && val > c.limit;
  const scale = Math.max(c.limit || 0, val) || 1;
  const p = c.limit ? (val / scale) * 100 : val > 0 ? 100 : 0;
  const open = openGroup === c.id;
  const s = t ? [...t.series, c.spent] : [];
  const mx = Math.max(...s, 1);
  const d = t?.avg ? t.avg3 / t.avg - 1 : 0;
  const tr = !t || t.avg < 100 ? ["", ""] : Math.abs(d) < 0.08 ? ["", "→ estável"] : d > 0 ? ["bad", `↑ ${Math.round(d * 100)}%`] : ["ok", `↓ ${Math.round(-d * 100)}%`];
  return `<button class="bar tap g${over ? " over" : ""}${open ? " open" : ""}" data-g="${c.id}" aria-expanded="${open}">
      <div class="t"><span>${c.label} <i class="caret">›</i>${t ? ` <small class="muted">média ${kBRL(t.avg)}</small>` : ""}</span><span><b class="${over ? "bad" : "ink"}">${brl(val)}</b>${c.limit !== null ? ` / ${brl(c.limit)}` : ""}</span></div>
      <div class="gm"><div class="track"><div class="fill" style="width:${p}%;background:var(${over ? "--bad" : COLOR[c.id]})"></div>${over && c.limit ? `<span class="lim" style="left:${(c.limit / scale) * 100}%"></span>` : ""}</div>
        <div class="sp" aria-hidden="true">${s.map((x, i) => `<i style="height:${Math.max(2, (x / mx) * 20)}px${i === s.length - 1 ? `;opacity:1;background:var(${COLOR[c.id]})` : ""}"></i>`).join("")}</div>
        <span class="trend ${tr[0]}">${tr[1]}</span></div>
      ${hint ? `<div class="hint">${hint}</div>` : ""}</button>
    ${open ? purchases(inPeriod.filter((r) => r.cluster === c.id), rows, user) : ""}`;
}

// Pix to Wise count as travel on the day they are sent (the Wise card purchases never reach Pluggy).
function wiseHint(rows, cycle, n) {
  const w = rows.filter((r) => r.cat === "Sent abroad (Wise)");
  if (!w.length) return "";
  const per = w.reduce((a, r) => a + r.amt, 0) / n;
  return `Inclui envios para a Wise: ~${kBRL(per)} por ${cycle ? "ciclo" : "mês"}, contados no dia do Pix.`;
}

// The purchase's own text: no payment-method prefix, no NuPay suffix.
const name = (desc) => desc.split("|").at(-1).replace(/^(Pagamento de (boleto|Pix QR Code)|Pix enviado|Compra no débito|Compra débito)\s*/i, "").replace(/\s+-?\s*NuPay\s*/i, " ").trim();

function categoryOptions(rows, current) {
  const seen = new Set(rows.map((r) => r.cat));
  const groups = CLUSTERS.map((c) => [c.label, c.id === "other" ? [...seen].filter((x) => !CLUSTERS.some((k) => k.cats.includes(x))).sort() : c.cats]);
  return groups.filter(([, cats]) => cats.length).map(([label, cats]) => `<optgroup label="${esc(label)}">${cats.map((x) => `<option ${x === current ? "selected" : ""}>${esc(x)}</option>`).join("")}</optgroup>`).join("");
}

function purchases(list, all, user) {
  if (!list.length) return '<div class="muted sm-pad">Nenhuma compra neste período.</div>';
  const sorted = [...list].sort((a, b) => b.amt - a.amt);
  const shown = showAll ? sorted : sorted.slice(0, FIRST);
  return `<div class="buys">${shown.map((r) => {
    const k = key(r.desc);
    return `<div class="buy"><div class="l"><span>${esc(name(r.desc))}</span><small>${ddmm(r.d)} · ${r.src === "card" ? "cartão" : "conta"}${user[k] ? " · ajustado" : ""}</small></div>
      <div class="r"><b>${brl(r.amt, 2)}</b><select data-k="${esc(k)}" aria-label="Categoria">${categoryOptions(all, r.cat)}${user[k] ? '<option value="">↺ voltar ao automático</option>' : ""}</select></div></div>`;
  }).join("")}${sorted.length > shown.length ? `<button class="btn ghost" data-a="all">Mostrar todas (${sorted.length})</button>` : ""}</div>
  <div class="muted sm-pad">Mudar a categoria vale para todas as compras desse estabelecimento, só neste aparelho. Exporte em Ajustes para levar ao notebook.</div>`;
}
