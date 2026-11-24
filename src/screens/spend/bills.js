// Gastos › Faturas: each card's open bill, the bills ahead month by month (what is already committed in installments),
// and the lines on the month tapped. Rebuilt from the snapshot on every refresh.
import { brl, pct, ddmm, esc, MES } from "../../lib/format.js";
import { bankName } from "../../lib/model.js";

export const id = "bills";
export const label = "Faturas";

const FIRST = 12;
let picked = null; // "YYYY-MM"; null = the open bill
let showAll = false;

const mon = (ym) => `${MES[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;
const k = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : String(Math.round(n)));

export function render(t) {
  const months = t.bills || [];
  const sel = months.find((m) => m.month === picked) || months[0] || null;
  return `${openCard(t.cards, months)}${monthsCard(months, sel)}${sel ? linesCard(sel) : ""}`;
}

export function bind(pane, t, ctx, { repaint }) {
  pane.onclick = (e) => {
    const m = e.target.closest("[data-bm]")?.dataset.bm;
    if (m) { picked = m; showAll = false; repaint(); pane.querySelector("[data-lines]")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    if (e.target.closest('[data-a="all-lines"]')) { showAll = true; repaint(); }
  };
}

// Each card's bill now: for a card that tags its charges (Nubank), the charges minus what was paid early.
function openCard(cards, months) {
  const live = cards.filter((c) => c.bill > 0 || c.used > 0);
  if (!live.length) return "";
  const open = months.find((m) => m.open);
  const lines = (bank) => open?.rows.filter((r) => r.bank === bank).length || 0;
  return `<div class="card"><div class="label">Faturas abertas</div><div class="list mt6">
      ${live.map((c) => {
        const how = c.exact ? `${brl(c.charges)} em ${lines(c.bank)} lançamentos${c.early ? ` − ${brl(c.early)} pagos adiantado` : ""}` : "saldo do cartão";
        const lim = c.limit ? ` · ${pct((c.used / c.limit) * 100, 0)} do limite` : "";
        return `<div><span class="l"><b>${esc(c.name)} · ${brl(c.bill)}</b><small>${how}${lim}</small></span>${c.due ? `<span class="chip">${ddmm(c.due)}</span>` : ""}</div>`;
      }).join("")}
    </div></div>`;
}

// One bar per bill, the open one first; tap a bar to list its lines.
function monthsCard(months, sel) {
  if (!months.length) return "";
  const ahead = months.filter((m) => !m.open).reduce((a, m) => a + m.amount, 0);
  const max = Math.max(...months.map((m) => m.amount), 1);
  return `<div class="card">
      <div class="row"><div class="label">Próximas faturas</div>${ahead ? `<b>${brl(ahead)}</b>` : ""}</div>
      <div class="muted sm">${ahead ? "já comprometido em parcelas · " : ""}toque num mês</div>
      <div class="bill-bars" role="tablist">${months.map((m) => `<button role="tab" data-bm="${m.month}" class="${m === sel ? "sel" : ""}${m.open ? " open" : ""}" aria-selected="${m === sel}" aria-label="Fatura de ${mon(m.month)}: ${brl(m.amount)}">
          <b>${k(m.amount)}</b><i style="height:${Math.max(3, (m.amount / max) * 72)}px"></i><span>${MES[Number(m.month.slice(5)) - 1]}</span></button>`).join("")}</div>
      ${months[0]?.open ? '<div class="muted xs">A primeira barra é a fatura aberta; as outras, só as parcelas já lançadas.</div>' : ""}
    </div>`;
}

function linesCard(m) {
  const rows = showAll ? m.rows : m.rows.slice(0, FIRST);
  const banks = [...new Set(m.rows.map((r) => r.bank))];
  const sub = m.open
    ? `${m.rows.length} lançamentos · ${brl(m.charges)}${m.early ? ` − ${brl(m.early)} pagos adiantado` : ""}${m.due ? ` · vence ${ddmm(m.due)}` : ""}`
    : `${m.rows.length} ${m.rows.length === 1 ? "parcela já lançada" : "parcelas já lançadas"} · compras novas entram a cada atualização`;
  return `<div class="card" data-lines>
      <div class="row"><div class="label">Fatura de ${mon(m.month)}${banks.length === 1 ? ` · ${esc(bankName(banks[0]))}` : ""}</div><b>${brl(m.amount)}</b></div>
      <div class="muted sm">${sub}</div>
      <div class="list mt6">${rows.map((r) => {
        const last = r.n && r.of && r.n === r.of;
        const when = r.date ? `compra ${ddmm(r.date)}` : "";
        return `<div><span class="l">${esc(r.name)}<small>${when}${last ? " · última" : r.of ? "" : " · à vista"}</small></span><span class="nw">${r.of ? `<span class="pl">${r.n}/${r.of}</span> ` : ""}<b>${brl(r.amount, 2)}</b></span></div>`;
      }).join("")}</div>
      ${m.rows.length > rows.length ? `<button class="lnk mt6" data-a="all-lines">mostrar todas (${m.rows.length}) ›</button>` : ""}
    </div>`;
}
