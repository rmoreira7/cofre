import { brl, MES, MESES, ddmm, esc } from "../lib/format.js";
import { CLUSTERS } from "../lib/spend.js";
import { key } from "../lib/categorize.js";
import { header, needsSetup } from "./home.js";

let openGroup = null;
let showAll = false;
const FIRST = 15;

const COLOR = { travel: "--c-travel", food: "--c-food", shop: "--c-shop", serv: "--c-serv", pix: "--c-pix", trans: "--c-trans", bills: "--c-bills", health: "--c-health", leis: "--c-leis", tobacco: "--c-cash", cash: "--c-cash", other: "--ink-3" };

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Gastos")) return;
  const { month: v, avg12, avgN, rows, installments } = ctx.view();
  const inPeriod = rows.filter((r) => (r.cyc ?? r.m) === v.month);
  const user = ctx.data.userOverrides || {};
  const C = 2 * Math.PI * 56;
  const share = Math.min(1, v.spent / v.target);
  const m = Number(v.month.slice(5, 7));
  const elapsed = (v.length - v.daysLeft + 0.5) / v.length;
  const pace = v.over ? ["bad", "acima da meta"] : v.spent / v.target > elapsed + 0.05 ? ["warn", "acima do ritmo"] : ["", "no ritmo da meta"];

  el.innerHTML = `${header(ctx, "Gastos")}
    <div class="sub mb10">${MESES[m - 1]}${v.cycle ? ` · ciclo ${ddmm(v.start)}–${ddmm(v.end)}` : ""} · ${v.daysLeft} ${v.daysLeft === 1 ? "dia restante" : "dias restantes"}</div>
    <div class="card">
      <div class="row">
        <div class="ring"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="56" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
          <circle cx="66" cy="66" r="56" fill="none" stroke="var(${v.over ? "--bad" : "--brand"})" stroke-width="12" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${C * share} ${C}"/></svg>
          <div class="c"><b>${brl(v.spent)}</b><span class="muted">de ${brl(v.target)}</span></div></div>
        <div class="grow">
          <div class="label">Pode gastar por dia</div><div class="kpi${v.over ? " bad" : ""}">${brl(v.perDay)}</div>
          <div class="muted mt6">${v.left >= 0 ? `Restam <b class="ink">${brl(v.left)}</b> até ${ddmm(v.end)}` : `Passou <b class="bad">${brl(-v.left)}</b> da meta`}</div>
          <span class="chip ${pace[0]} mt10">${pace[1]}</span>
        </div>
      </div>
    </div>
    <div class="card"><div class="row"><div class="label">Por grupo</div><span class="muted">gasto / limite</span></div>
      ${v.clusters.map((c) => {
        const p = c.limit ? Math.min(100, (c.spent / c.limit) * 100) : c.spent > 0 ? 100 : 0;
        const open = openGroup === c.id;
        return `<button class="bar tap${c.over ? " over" : ""}${open ? " open" : ""}" data-g="${c.id}" aria-expanded="${open}"><div class="t"><span>${c.label} <i class="caret">›</i></span><span>${brl(c.spent)}${c.limit !== null ? ` / ${brl(c.limit)}` : ""}</span></div>
        <div class="track"><div class="fill" style="width:${p}%;background:var(${c.over ? "--bad" : COLOR[c.id]})"></div></div></button>
        ${open ? purchases(inPeriod.filter((r) => r.cluster === c.id), rows, user) : ""}`;
      }).join("")}
    </div>
    ${installmentsCard(installments)}
    <div class="card">
      <div class="label">Últimos meses</div>
      ${chart(v.history, v.target)}
      <div class="muted">Média ${avgN} meses: ${brl(avg12)} · meta ${brl(v.target)}</div>
    </div>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (e.target.closest('[data-a="all"]')) { showAll = true; render(el, ctx); return; }
    if (g) { openGroup = openGroup === g ? null : g; showAll = false; render(el, ctx); el.querySelector(`[data-g="${g}"]`)?.scrollIntoView({ block: "nearest" }); }
  });
  el.querySelectorAll("select[data-k]").forEach((sel) => sel.addEventListener("change", async () => {
    await ctx.setOverride(sel.dataset.k, sel.value || null);
    render(el, ctx);
  }));
}

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

function installmentsCard(inst) {
  if (!inst?.months.length) return "";
  const W = 340, H = 110, max = Math.max(...inst.months.map((m) => m.amount)), bw = W / inst.months.length;
  const bars = inst.months.map((m, i) => {
    const h = (m.amount / max) * (H - 38), x = i * bw + 4, y = H - 20 - h;
    return `<rect x="${x}" y="${y}" width="${bw - 8}" height="${h}" rx="4" fill="var(--c-shop)" opacity="${i === 0 ? 1 : 0.6}"/>
      <text x="${x + (bw - 8) / 2}" y="${y - 4}" text-anchor="middle" font-size="9.5" fill="var(--ink-2)">${m.amount >= 1000 ? (m.amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k" : Math.round(m.amount)}</text>
      <text x="${x + (bw - 8) / 2}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${MES[Number(m.month.slice(5)) - 1]}</text>`;
  }).join("");
  return `<div class="card">
    <div class="row"><div class="label">Parcelas nas próximas faturas</div><b>${brl(inst.total)}</b></div>
    <svg viewBox="0 0 ${W} ${H}" class="mt10" role="img" aria-label="Parcelas já comprometidas por fatura">${bars}</svg>
    <div class="list">${inst.plans.slice(0, 6).map((p) => `<div><span class="l">${esc(p.name)}<small>${p.left}× ${brl(p.per, 2)} · até ${MES[Number(p.last.slice(5)) - 1]}/${p.last.slice(2, 4)}</small></span><b>${brl(p.amount)}</b></div>`).join("")}</div>
    ${inst.plans.length > 6 ? `<div class="muted mt6">+ ${inst.plans.length - 6} outras compras parceladas</div>` : ""}
  </div>`;
}

function chart(history, target) {
  const W = 340, H = 120, max = Math.max(target * 1.2, ...history.map((h) => h.spent)) || 1, bw = W / history.length;
  const y = (v) => H - 20 - (v / max) * (H - 30);
  let g = "";
  history.forEach((h, i) => {
    const x = i * bw + 5, top = y(h.spent);
    g += `<rect x="${x}" y="${top}" width="${bw - 10}" height="${H - 20 - top}" rx="4" fill="var(${h.spent > target ? "--ink-3" : "--brand"})" opacity="${i === history.length - 1 ? 1 : 0.55}"/>
      <text x="${x + (bw - 10) / 2}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${MES[Number(h.month.slice(5)) - 1]}</text>`;
  });
  g += `<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--brand)" stroke-dasharray="4 4"/><text x="${W}" y="${y(target) - 4}" text-anchor="end" font-size="10" fill="var(--brand)">meta ${target >= 1000 ? (target / 1000).toLocaleString("pt-BR") + "k" : target}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="mt10" role="img" aria-label="Gasto por mês, últimos 12 meses">${g}</svg>`;
}

