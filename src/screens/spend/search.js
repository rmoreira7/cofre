// Gastos › Buscar: type a merchant, a category or a group ("ifood", "uber", "farmácia") and see what it cost per
// cycle, this year and in the last 12 cycles, with every charge. The results redraw as you type; the field stays put.
import { brl, ddmm, esc, MES } from "../../lib/format.js";
import { CLUSTERS } from "../../lib/spend.js";
import { search, merchantText } from "../../lib/search.js";

export const id = "search";
export const label = "Buscar";

const FIRST = 30;
let q = "", all = false;
const GROUP = Object.fromEntries(CLUSTERS.map((c) => [c.id, c.label]));
const k = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : String(Math.round(n)));

export function render(t) {
  return `<div class="card">
      <label class="in"><span class="label">Buscar gastos</span><input type="search" data-q value="${esc(q)}" placeholder="ifood, uber, farmácia…" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
      <div class="muted xs">Procura no nome da loja, na categoria e no grupo. Todas as palavras precisam aparecer.</div>
    </div>
    <div data-results>${results(t)}</div>`;
}

export function results(t) {
  if (!q.trim()) return "";
  const key = t.month.cycle ? "cyc" : "m";
  const periods = [...(t.month.long || t.month.history || []).map((h) => h.month)].sort();
  const s = search(t.rows, q, { key, today: t.today, periods });
  if (!s || !s.rows.length) return `<div class="card empty"><b>Nada encontrado</b>Nenhum gasto com “${esc(q.trim())}”.</div>`;
  const max = Math.max(1, ...s.periods.map((p) => s.byPeriod[p] || 0));
  const bars = `<div class="bill-bars">${s.periods.map((p) => {
    const v = s.byPeriod[p] || 0;
    return `<button tabindex="-1" class="${v > 0 ? "under" : "dim"}" aria-label="${MES[Number(p.slice(5)) - 1]}: ${brl(v)}"><b>${v > 0 ? k(v) : ""}</b><i style="height:${Math.max(2, (Math.max(0, v) / max) * 72)}px"></i><span>${MES[Number(p.slice(5)) - 1]}</span></button>`;
  }).join("")}</div>`;
  const rows = all ? s.rows : s.rows.slice(0, FIRST);
  return `<div class="card">
      <div class="row"><div class="label">${t.month.cycle ? "Últimos 12 ciclos" : "Últimos 12 meses"}</div><span class="muted sm">${s.n} ${s.n === 1 ? "compra" : "compras"}</span></div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(s.last12)}</span><span class="muted">≈ ${brl(s.last12 / 12)}/mês</span></div></div>
      <div class="muted sm">em ${t.today.slice(0, 4)}: <b class="ink">${brl(s.year)}</b>${s.total !== s.last12 ? ` · todo o histórico: ${brl(s.total)}` : ""}</div>
      ${bars}
    </div>
    <div class="card"><div class="list">${rows.map((r) => `<div><span class="l">${esc(merchantText(r.desc) || "—")}<small>${ddmm(r.d)}/${r.d.slice(2, 4)} · ${esc(GROUP[r.cluster] || "Outros")}${r.src === "account" ? " · conta" : ""}${r.inst ? " · parcela" : ""}</small></span><b class="nw${r.amt < 0 ? " ok" : ""}">${r.amt < 0 ? "−" : ""}${brl(Math.abs(r.amt), 2)}</b></div>`).join("")}</div>
      ${s.rows.length > rows.length ? `<button class="lnk mt6" data-a="all-hits">mostrar todos (${s.rows.length}) ›</button>` : ""}
    </div>`;
}

export function bind(pane, t) {
  const out = pane.querySelector("[data-results]");
  pane.oninput = (e) => {
    if (!e.target.matches("[data-q]")) return;
    q = e.target.value; all = false;
    out.innerHTML = results(t);
  };
  pane.onclick = (e) => {
    if (e.target.closest('[data-a="all-hits"]')) { all = true; out.innerHTML = results(t); }
  };
}
