// Gastos › Viagens: each trip from the rules file's `projects` (src/lib/projects.js), whole: what is already billed,
// on the open bill, the installments still to come, what is paid outside the card, and every purchase. It counts in
// the cycle target like any other spending; this shows it in one place. Início keeps one row per trip.
import { brl, ddmm, esc, MES } from "../../lib/format.js";
import { niceName } from "../../lib/recurring.js";

export const id = "trips";
export const label = "Viagens";

const days = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
export function tripChip(p, today) {
  if (!p.start) return "";
  const d = days(today, p.start);
  return d > 0 ? `faltam ${d} dias` : p.end && today <= p.end ? "em viagem" : "terminou";
}
const mon = (ym) => `${MES[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;
const fx = (e) => (e.currency === "BRL" ? brl(e.amount, 2) : `${e.currency === "USD" ? "US$" : e.currency} ${e.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function render(t) {
  const list = t.projects || [];
  if (!list.length) return '<div class="card empty"><b>Nenhuma viagem</b>Uma viagem entra pelo arquivo de regras (<code>projects</code>): as compras dela no cartão, pelo nome e dia, e o que é pago fora.</div>';
  return list.map((p) => card(p, t.today)).join("");
}

function card(p, today) {
  const chip = tripChip(p, today);
  const when = p.start ? `${ddmm(p.start)}${p.end ? ` → ${ddmm(p.end)}/${p.end.slice(2, 4)}` : ""}` : "";
  const parts = [["Já faturado", p.billed], ["Na fatura aberta (este ciclo)", p.open], [`Parcelas por vir${p.lastAhead ? ` · até ${mon(p.lastAhead)}` : ""}`, p.ahead]].filter(([, v]) => v > 0);
  const extras = p.extras.map((e) => `<div><span class="l">${esc(e.name)}<small>${e.due ? `paga em ${ddmm(e.due)}` : "fora do cartão"}</small></span><span class="nw">${fx(e)}${e.currency !== "BRL" ? `<small class="muted"> ${e.brl ? `≈ ${brl(e.brl)}` : "sem cotação"}</small>` : ""}</span></div>`).join("");
  const buys = p.buys.map((b) => `<div><span class="l"><span class="find" data-find="${esc(niceName(b.name))}">${esc(niceName(b.name))}</span><small>${ddmm(b.bought)}${b.n > 1 ? ` · ${b.n}x` : " · à vista"}</small></span><b class="nw">${brl(b.amount, 2)}</b></div>`).join("");
  return `<div class="card">
      <div class="row"><div class="label">${esc(p.name)}${when ? ` · ${when}` : ""}</div>${chip ? `<span class="chip">${chip}</span>` : ""}</div>
      <div class="row mt6"><div class="hero-row"><span class="kpi">${brl(p.total)}</span><span class="muted">no total</span></div></div>
      <div class="muted sm">${brl(p.card)} no cartão${p.outside ? ` · ${brl(p.outside)} fora` : ""}</div>
      <div class="dlist mt8">${parts.map(([l, v]) => `<div><span>${l}</span><span>${brl(v)}</span></div>`).join("")}</div>
    </div>
    ${extras ? `<div class="sec">Pago fora do cartão</div><div class="card"><div class="list">${extras}</div></div>` : ""}
    ${buys ? `<div class="sec">Compras no cartão · ${p.buys.length}</div><div class="card"><div class="list">${buys}</div></div>` : ""}`;
}
