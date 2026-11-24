// Investimentos › Carteira: wealth by bank (the joint account included, tagged); tap a bank for its positions.
import { brl, mil, pct, ddmm, esc } from "../../lib/format.js";
import { BANKS } from "../../lib/model.js";

export const id = "wallet";
export const label = "Carteira";

let openBank = null;
const money2 = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function render(t) {
  const b = t.wealth.banks.find((x) => x.label === openBank);
  return `${wealthCard(t.wealth, openBank)}${b ? positionsCard(b) : ""}`;
}

export function bind(pane, t, ctx, { repaint }) {
  pane.onclick = (e) => {
    const b = e.target.closest("[data-bank]")?.dataset.bank;
    if (b) { openBank = openBank === b ? null : b; repaint(); if (openBank) pane.querySelector("[data-positions]")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  };
}

// Wealth (the joint account included, tagged): total, the split by bank, the big banks as tiles, the small ones (and foreign money) as lines.
function wealthCard(mine, open) {
  const big = mine.banks.filter((b) => b.invested > 0 && b.count > 0);
  const small = mine.banks.filter((b) => !big.includes(b) && b.total);
  const stack = mine.banks.filter((b) => b.total > 0).map((b) => `<div style="width:${(b.total / mine.total) * 100}%;background:${BANKS[b.label]?.color || "var(--ink-3)"}"></div>`).join("");
  const sub = (b) => [
    ...(b.foreign || []).map((f) => `${f.currency} ${money2(f.amount)}${f.brl ? "" : " · sem cotação"}`),
    ...b.reserved.map((r) => `Cofrinho ${brl(r.balance)}`),
  ].join(" · ");
  return `<div class="card">
      <div class="label">Patrimônio</div>
      <div class="big">${brl(mine.total)}</div>
      <div class="stack">${stack}</div>
      <div class="split">${big.map((b) => `<button class="tile tap${open === b.label ? " on" : ""}" data-bank="${b.label}" aria-expanded="${open === b.label}"><span class="muted"><i class="bankdot" style="background:${BANKS[b.label]?.color}"></i>${esc(b.name)}${b.joint ? ' <span class="chip joint chip-s">conjunta</span>' : ""}</span><b>${mil(b.total)}</b><span class="muted">${b.cdiAvg ? `~${pct(b.cdiAvg, 0)} CDI · ` : ""}${b.count} ${b.count === 1 ? "título" : "títulos"}</span></button>`).join("")}</div>
      ${small.length ? `<div class="list mt6">${small.map((b) => `<div><span class="l"><span><i class="bankdot" style="background:${BANKS[b.label]?.color || "var(--ink-3)"}"></i>${esc(b.name)}${b.joint ? ' <span class="chip joint chip-s">conjunta</span>' : ""}</span>${sub(b) ? `<small>${esc(sub(b))}</small>` : ""}</span><span class="muted">${brl(b.total, 2)}</span></div>`).join("")}</div>` : ""}
    </div>`;
}

// One bank's positions, the next to mature first; daily-liquidity money (no due date) at the end.
function positionsCard(b) {
  const list = [...b.positions].sort((x, y) => (x.due || "9999").localeCompare(y.due || "9999") || y.balance - x.balance);
  return `<div class="card" data-positions>
      <div class="row"><div class="label">${esc(b.name)} · ${list.length} ${list.length === 1 ? "posição" : "posições"}</div><b>${mil(b.invested)}</b></div>
      <div class="list mt6">${list.map((p) => `<div><span class="l">${esc(p.issuer)}<small>${esc(p.subtype || "")}${p.rate && p.rate !== "–" ? ` · ${esc(p.rate)}` : ""}${p.due ? ` · vence ${ddmm(p.due)}/${p.due.slice(2, 4)}` : " · liquidez diária"}</small></span><b>${brl(p.balance)}</b></div>`).join("")}</div>
    </div>`;
}
