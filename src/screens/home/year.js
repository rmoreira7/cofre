// Início › Seu ano: the year so far in one page. Spending (the open cycle included, marked), by group, what came in and
// was left in the closed cycles, the cycles over the target, the largest purchases and stores, and the investments.
import { brl, mil, ddmm, esc, MES, MESES } from "../../lib/format.js";
import { yearView } from "../../lib/year.js";

export const id = "year";
export const label = (t) => `Seu ${t.today.slice(0, 4)}`;

const mon = (id) => `${MES[Number(id.slice(5)) - 1]}/${id.slice(2, 4)}`;

export function render(t) {
  const y = yearView(t.v);
  if (!y) return '<div class="card empty"><b>Ano novo</b>Nenhum ciclo deste ano ainda.</div>';
  const unit = y.cycle ? "ciclo" : "mês", units = y.cycle ? "ciclos" : "meses";
  const top = y.groups[0]?.spent || 1;
  const groups = y.groups.map((g) => `<div class="yr-g"><span>${esc(g.label)}</span><i style="width:${Math.max(2, (g.spent / top) * 100)}%"></i><b>${brl(g.spent)}</b></div>`).join("");
  const buys = y.buys.map((r) => `<div><span class="l"><span class="find" data-find="${esc(String(r.desc || "").split("|").at(-1).trim())}">${esc(String(r.desc || "").split("|").at(-1).trim() || "—")}</span><small>${ddmm(r.d)}${r.inst ? " · parcela" : ""}</small></span><b class="nw">${brl(r.amt, 2)}</b></div>`).join("");
  const stores = y.stores.map((s, i) => `<div><span class="l"><span class="find" data-find="${esc(s.name)}">${i + 1}. ${esc(s.name)}</span><small>${s.n} ${s.n === 1 ? "compra" : "compras"}</small></span><b class="nw">${brl(s.total)}</b></div>`).join("");
  return `<div class="card">
      <div class="label">Gastos em ${y.year}</div>
      <div class="hero-row mt6"><span class="big">${brl(y.spent)}</span></div>
      <div class="muted sm">${y.n} ${y.n === 1 ? unit : units} ${y.n === 1 ? "fechado" : "fechados"}${y.n ? ` · média ${brl(y.avg)}/${unit}` : ""}${y.open ? ` · + ${brl(y.open.spent)} do ${unit} em curso (faltam ${y.open.daysLeft} dias)` : ""}</div>
      ${y.n ? `<div class="split">
        <div class="tile"><span class="muted sm">Entrou</span><b>${brl(y.income)}</b><span class="muted sm">nos ${units} fechados</span></div>
        <div class="tile"><span class="muted sm">${y.left >= 0 ? "Sobrou" : "Faltou"}</span><b class="${y.left >= 0 ? "ok" : "bad"}">${brl(Math.abs(y.left))}</b><span class="muted sm">${y.income ? `${Math.round((y.left / y.income) * 100)}% do que entrou` : ""}</span></div>
      </div>
      <div class="dlist mt8">
        <div><span>Acima da meta</span><span>${y.over} de ${y.n} ${units}</span></div>
        ${y.high && y.n > 1 ? `<div><span>Mais caro</span><span>${mon(y.high.id)} · ${brl(y.high.spent)}</span></div><div><span>Mais barato</span><span>${mon(y.low.id)} · ${brl(y.low.spent)}</span></div>` : ""}
      </div>` : ""}
    </div>
    <div class="card"><div class="label">Por grupo</div><div class="yr-groups mt8">${groups}</div></div>
    ${stores ? `<div class="card"><div class="label">Onde mais gastou</div><div class="list mt6">${stores}</div></div>` : ""}
    ${buys ? `<div class="card"><div class="label">Maiores compras</div><div class="list mt6">${buys}</div></div>` : ""}
    ${y.wealth != null ? `<div class="card"><div class="label">Investimentos</div>
      <div class="hero-row mt6"><span class="kpi">${mil(y.wealth)}</span><span class="muted">patrimônio hoje</span></div>
      ${y.earned ? `<div class="muted sm">renderam <b class="ok">${brl(y.earned.amount)}</b> líquidos desde ${ddmm(y.earned.from)}, quando o Cofre começou a medir</div>` : ""}
    </div>` : ""}
    <div class="muted xs mt6">${y.cycle ? `Um ciclo conta no ano do mês em que fecha (o de ${MESES[0].toLowerCase()} começa em dezembro). ` : ""}Toque numa loja para ver cada compra.</div>`;
}
