import { brl, MES, MESES, ddmm, esc } from "../lib/format.js";
import { CLUSTERS } from "../lib/spend.js";
import { key } from "../lib/categorize.js";
import { header, needsSetup } from "./home.js";

let openGroup = null;
let showAll = false;
let mode = "now";
const FIRST = 15;

const COLOR = { travel: "--c-travel", food: "--c-food", shop: "--c-shop", serv: "--c-serv", pix: "--c-pix", trans: "--c-trans", bills: "--c-bills", health: "--c-health", leis: "--c-leis", tobacco: "--c-cash", cash: "--c-cash", other: "--ink-3" };

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Gastos")) return;
  const { month: v, avg12, avgN, rows, installments, trends, goals, left: lo } = ctx.view();
  const income = lo?.n ? lo.avg.left + lo.avg.spent : null;
  const inPeriod = rows.filter((r) => (r.cyc ?? r.m) === v.month);
  const user = ctx.data.userOverrides || {};
  const C = 2 * Math.PI * 56;
  const share = Math.min(1, v.spent / v.target);
  const m = Number(v.month.slice(5, 7));
  const elapsed = (v.length - v.daysLeft + 0.5) / v.length;
  const projected = v.spent / elapsed;
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
          ${v.daysLeft > 1 && v.spent > 0 ? `<div class="muted sm mt6">No ritmo, fecha em ~<b class="ink">${kBRL(projected)}</b></div>` : ""}
          <span class="chip ${pace[0]} mt10">${pace[1]}</span>
        </div>
      </div>
    </div>
    ${goalsCard(goals, v.target, avg12, avgN)}
    <div class="card"><div class="row"><div class="label">Por grupo</div><div class="seg mini-seg" role="group" aria-label="Mostrar"><button data-m="now" class="${mode === "now" ? "on" : ""}">Ciclo</button><button data-m="avg" class="${mode === "avg" ? "on" : ""}">Média</button></div></div>
      <div class="row muted sm"><span>${mode === "now" ? "gasto no ciclo" : `média de ${avgN} ${v.cycle ? "ciclos" : "meses"}`} / limite</span><span>últimos ${avgN} · 3 vs ${avgN}</span></div>
      ${[...v.clusters].sort((a, b) => (trends?.[b.id]?.avg || 0) - (trends?.[a.id]?.avg || 0)).map((c) => groupRow(c, trends?.[c.id], c.id === "travel" ? wiseHint(rows, v.cycle, avgN) : "", inPeriod, rows, user)).join("")}
    </div>
    ${installmentsCard(installments)}
    <div class="card">
      <div class="label">Últimos meses</div>
      ${chart(v.long || v.history, v.target, income)}
      <div class="muted">Média ${avgN} ${v.cycle ? "ciclos" : "meses"}: ${brl(avg12)}${income ? ` · entra ${kBRL(income)}` : ""} · meta ${brl(v.target)}</div>
      ${v.long ? '<div class="muted mt6">Barras claras: só o cartão (extratos de fatura), sem as contas. Ficam fora da média.</div>' : ""}
      ${v.yearAgo ? `<div class="field mt6"><span>Cartão neste ciclo · mesmo ciclo em ${MES[Number(v.yearAgo.month.slice(5)) - 1]}/${v.yearAgo.month.slice(2, 4)}</span><span>${brl(v.yearAgo.cardNow)} · ${brl(v.yearAgo.card)}</span></div>` : ""}
    </div>`;
  // onclick, not addEventListener: render() runs again on every tap and would stack one more listener each time.
  el.onclick = (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
    const md = e.target.closest("[data-m]")?.dataset.m;
    if (md) { mode = md; render(el, ctx); return; }
    if (e.target.closest('[data-a="goals"]') && goals) {
      ctx.save({ ...ctx.data, settings: { ...(ctx.data.settings || {}), target: goals.target, limits: { ...(ctx.data.settings?.limits || {}), ...goals.limits } } }).then(() => render(el, ctx));
      return;
    }
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (e.target.closest('[data-a="all"]')) { showAll = true; render(el, ctx); return; }
    if (g) { openGroup = openGroup === g ? null : g; showAll = false; render(el, ctx); el.querySelector(`[data-g="${g}"]`)?.scrollIntoView({ block: "nearest" }); }
  };
  el.querySelectorAll("select[data-k]").forEach((sel) => sel.addEventListener("change", async () => {
    await ctx.setOverride(sel.dataset.k, sel.value || null);
    render(el, ctx);
  }));
}

const kBRL = (n) => (Math.abs(n) >= 1000 ? `R$ ${(n / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil` : brl(n));

// Shown while the target sits more than 10% under the average spend: a target that is always blown stops warning.
function goalsCard(g, target, avg, n) {
  if (!g || target >= avg * 0.9 || g.target <= target) return "";
  const lo = Math.min(target, g.target), hi = Math.max(avg, g.income), at = (x) => ((x - lo) / (hi - lo || 1)) * 96 + 2;
  return `<div class="card">
    <div class="row"><div class="label">Meta realista</div><span class="chip bad">meta atual: ${kBRL(target)}</span></div>
    <div class="muted mt6">Sua média é <b class="ink">${kBRL(avg)}</b> por ciclo e entram <b class="ink">${kBRL(g.income)}</b>. Uma meta sempre estourada deixa de avisar.</div>
    <div class="scale" aria-hidden="true"><div class="ln"></div>
      <div class="m" style="left:${at(target)}%"><i></i>atual</div>
      <div class="m sug" style="left:${at(g.target)}%"><i></i>${kBRL(g.target).replace("R$ ", "")}</div>
      <div class="m inc up" style="left:${at(g.income)}%"><i></i>entra</div>
      <div class="m avg" style="left:${at(avg)}%"><i></i>média</div></div>
    <div class="split">
      <div class="tile"><span class="label">Sugerida</span><b>${brl(g.target)}</b><span class="muted sm">90% do que entra</span></div>
      <div class="tile"><span class="label">Sobra prevista</span><b class="${g.left >= 0 ? "ok" : "bad"}">${g.left >= 0 ? "+" : "−"}${brl(Math.abs(g.left))}</b><span class="muted sm">por ciclo</span></div>
    </div>
    <button class="btn" data-a="goals">Usar ${kBRL(g.target)} e os limites sugeridos</button>
    <div class="muted sm mt6">Limites = a média de ${n} ciclos de cada grupo, na proporção da meta. Dá para editar um a um em Ajustes.</div>
  </div>`;
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

function chart(history, target, income) {
  const n = history.length, W = 340, H = 120, max = Math.max(target * 1.2, (income || 0) * 1.1, ...history.map((h) => Math.max(0, h.spent))) || 1, bw = W / n;
  const y = (v) => H - 20 - (Math.max(0, v) / max) * (H - 30);
  const w = n > 12 ? bw * 0.7 : bw - 10, pad = (bw - w) / 2;
  let g = "";
  history.forEach((h, i) => {
    const x = i * bw + pad, top = y(h.spent);
    const label = n <= 12 || (n - 1 - i) % 3 === 0;
    const mes = MES[Number(h.month.slice(5)) - 1];
    g += `<rect x="${x}" y="${top}" width="${w}" height="${H - 20 - top}" rx="${n > 12 ? 2 : 4}" fill="var(${h.spent > (income || target) ? "--ink-3" : "--brand"})" opacity="${i === n - 1 ? 1 : h.cardOnly ? 0.25 : 0.55}"><title>${mes}/${h.month.slice(2, 4)} · ${brl(h.spent)}${h.cardOnly ? " · só cartão" : ""}</title></rect>
      ${label ? `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${n > 12 && h.month.endsWith("-01") ? h.month.slice(2, 4) : mes}</text>` : ""}`;
  });
  const kk = (x) => (x >= 1000 ? (x / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k" : Math.round(x));
  const halo = 'paint-order="stroke" stroke="var(--surface)" stroke-width="3"';
  g += `<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--brand)" stroke-dasharray="4 4"/>`;
  if (income) g += `<line x1="0" x2="${W}" y1="${y(income)}" y2="${y(income)}" stroke="var(--ok)" stroke-width="1.5"/><text x="${W}" y="${y(income) - 4}" text-anchor="end" font-size="10" fill="var(--ok)" ${halo}>entra ${kk(income)}</text>`;
  g += `<text x="2" y="${Math.min(y(target), income ? y(income) : Infinity) - 4}" font-size="10" fill="var(--brand)" ${halo}>meta ${kk(target)} ┄</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="mt10" role="img" aria-label="Gasto por mês, últimos ${n} meses">${g}</svg>`;
}

