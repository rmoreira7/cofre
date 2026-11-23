import { brl, mil, pct, MES, ddmmyyyy, esc } from "../lib/format.js";
import { HORIZONS, CDB_RATES, breakEven, curves } from "../lib/cdblca.js";
import { bankName } from "../lib/model.js";
import { header, needsSetup } from "./home.js";

const CCOL = ["--c-bills", "--c-trans", "--c-travel", "--c-shop", "--c-health", "--c-food"];
let filter = "365";
let calc = { cdb: 2, h: 2, lca: 84.5 };

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Vencimentos")) return;
  const { mat } = ctx.view();
  const s = ctx.data.settings || {};
  const cdi = (s.cdi ?? 13.65) / 100;
  const cdbMin = s.cdbMin ?? 110;
  const banks = [...new Set(mat.rows.map((r) => bankName(r.bank)))].join(" + ");

  el.innerHTML = `${header(ctx, "Vencimentos")}
    <div class="sub mb10">${esc(banks)} · ${mil(mat.total)}</div>
    <div class="seg">${[["90", "90 dias"], ["365", "12 meses"], ["all", "Todos"]].map(([f, l]) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card" data-list></div>
    <div class="card">
      <div class="label">Regras de reinvestimento</div>
      <div class="rule"><i class="r-ok">1</i><span><b>Liquidez primeiro</b> — dinheiro novo curto (≤ 12 meses) ou liquidez diária: entrada do financiamento.</span></div>
      <div class="rule"><i class="r-ok">2</i><span><b>CDB ≥ ${cdbMin}% CDI</b>, até R$ 250 mil por emissor (FGC).</span></div>
      ${mat.brbLast ? `<div class="rule"><i class="r-bad">✕</i><span><b>Sem BRB</b> — manter os atuais até ${ddmmyyyy(mat.brbLast)}.</span></div>` : ""}
      ${mat.conc.map((c) => `<div class="rule"><i class="r-warn">!</i><span><b>${esc(c.issuer)} = ${pct(c.share * 100, 0)}</b> da ${esc(bankName(c.bank))} — novos aportes em outros emissores.</span></div>`).join("")}
    </div>
    <div class="card">
      <div class="row"><div class="label">CDB × LCA</div><span class="muted">CDI ${pct(cdi * 100, 2)}</span></div>
      <div class="calc">
        <label>CDB<select data-c="cdb">${CDB_RATES.map((c, i) => `<option value="${i}" ${i === calc.cdb ? "selected" : ""}>${c}%</option>`).join("")}</select></label>
        <label>Prazo<select data-c="h">${HORIZONS.map((h, i) => `<option value="${i}" ${i === calc.h ? "selected" : ""}>${h.label}</option>`).join("")}</select></label>
        <label>LCA oferecida<input data-c="lca" type="number" inputmode="decimal" value="${calc.lca}" step="0.5" min="50" max="130"></label>
      </div>
      <div class="verdict" data-v></div>
      <svg data-chart viewBox="0 0 340 210" class="mt6" role="img" aria-label="LCA mínima para empatar com cada CDB"></svg>
      <div class="legend">${CDB_RATES.map((c, i) => `<span><i style="background:var(${CCOL[i]})"></i>${c}%</span>`).join("")}</div>
      <div class="muted mt8">A linha é a LCA mínima para empatar. Acima dela, a LCA ganha; abaixo, o CDB ganha. LCA tem carência mínima de 9 meses.</div>
    </div>`;

  const list = el.querySelector("[data-list]");
  const paint = () => {
    const rows = mat.rows.filter((r) => r.days >= 0 && (filter === "all" || r.days <= +filter));
    const liquid = mat.liquid.map((p) => `<div class="mat"><div class="date soon"><b>D+0</b><small>diária</small></div><div><b>${esc(p.bankName)} · Cofrinho</b><div class="muted">${esc(p.rate)}</div><div class="mt4"><span class="chip">liquidez diária</span></div></div><b>${brl(p.balance)}</b></div>`);
    list.innerHTML = rows.map((r) => {
          const tag = r.tag === "brb" ? '<span class="chip bad">não renovar</span>' : r.tag === "conc" ? '<span class="chip warn">concentração</span>' : "";
      return `<div class="mat"><div class="date${r.days <= 90 ? " soon" : ""}"><b>${Number(r.due.slice(8, 10))}</b><small>${MES[Number(r.due.slice(5, 7)) - 1]} ${r.due.slice(2, 4)}</small></div>
        <div><b>${esc(r.issuer)}${r.n > 1 ? ` ×${r.n}` : ""}</b><div class="muted">${esc(r.rates.length > 2 ? `${r.n} títulos` : r.rates.join(" / "))} · em ${r.days} dias</div>${tag ? `<div class="mt4">${tag}</div>` : ""}</div><b>${brl(r.balance)}</b></div>`;
    }).concat(liquid).join("") || '<div class="muted">Nada neste período.</div>';
  };

  const V = curves(cdi);
  const verdict = el.querySelector("[data-v]");
  const svg = el.querySelector("[data-chart]");
  const paintCalc = () => {
    const be = breakEven(cdi, CDB_RATES[calc.cdb], HORIZONS[calc.h]);
    const win = calc.lca > be;
    verdict.className = "verdict " + (win ? "lca" : "cdb");
    verdict.innerHTML = `Para empatar com CDB ${CDB_RATES[calc.cdb]}% em ${HORIZONS[calc.h].label}, a LCA precisa de <b>${pct(be)}</b>.<br>${win ? `<b>LCA ${pct(calc.lca)} ganha</b> (+${pct(calc.lca - be)} acima)` : `<b>CDB ganha</b> — LCA ${pct(calc.lca)} está ${pct(be - calc.lca)} abaixo`}${HORIZONS[calc.h].days < 270 ? " · ⚠️ LCA exige 9 meses" : ""}`;
    const W = 340, H = 210, m = { l: 30, r: 8, t: 10, b: 22 };
    const all = V.flat().concat(calc.lca);
    const lo = Math.floor(Math.min(...all) / 4) * 4 - 2, up = Math.ceil(Math.max(...all) / 4) * 4 + 2;
    const x = (i) => m.l + (i * (W - m.l - m.r)) / (HORIZONS.length - 1), y = (v) => m.t + (1 - (v - lo) / (up - lo)) * (H - m.t - m.b);
    let g = "";
    for (let t = Math.ceil(lo / 8) * 8; t <= up; t += 8) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${m.l - 5}" y="${y(t) + 3.5}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${t}</text>`;
    HORIZONS.forEach((h, i) => (g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${h.id}</text>`));
    V.forEach((r, k) => {
      const on = k === calc.cdb;
      g += `<polyline points="${r.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="var(${CCOL[k]})" stroke-width="${on ? 3 : 1.5}" opacity="${on ? 1 : 0.45}" stroke-linejoin="round"/>`;
    });
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(calc.lca)}" y2="${y(calc.lca)}" stroke="var(--ink-2)" stroke-dasharray="4 4"/><text x="${W - m.r}" y="${y(calc.lca) - 4}" text-anchor="end" font-size="10" font-weight="600" fill="var(--ink-2)">LCA ${pct(calc.lca)}</text>`;
    g += `<circle cx="${x(calc.h)}" cy="${y(be)}" r="5.5" fill="var(${CCOL[calc.cdb]})" stroke="var(--surface)" stroke-width="2.5"/>`;
    svg.innerHTML = g;
  };

  el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]")?.dataset.f;
    if (f) { filter = f; el.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.f === f)); paint(); }
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
  });
  el.querySelectorAll("[data-c]").forEach((inp) => inp.addEventListener("input", () => {
    calc = { ...calc, [inp.dataset.c]: inp.dataset.c === "lca" ? Number(inp.value) || 0 : Number(inp.value) };
    paintCalc();
  }));
  paint();
  paintCalc();
}
