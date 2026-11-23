import { brl, mil, pct, MES, ddmmyyyy, esc } from "../lib/format.js";
import { HORIZONS, CDB_RATES, breakEven, curves } from "../lib/cdblca.js";
import { bankName } from "../lib/model.js";
import { maturitiesIcs } from "../lib/ics.js";
import { ladder } from "../lib/ladder.js";
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
  const banks = (joint) => [...new Set(mat.rows.filter((r) => Boolean(r.joint) === joint).map((r) => bankName(r.bank)))].join(" + ");
  const sub = [mat.total ? `${banks(false)} · ${mil(mat.total)}` : "", mat.jointTotal ? `${banks(true)} (conjunta) · ${mil(mat.jointTotal)}` : ""].filter(Boolean).join(" · ");

  const v = ctx.view();
  // The ladder simulation takes a few hundred ms: computed once per data change, on first open of this tab.
  const lad = (v.ladder ||= ladder(mat.rows.filter((r) => !r.joint), { today: v.today }));
  const reserve = v.mine.banks.filter((b) => AUTO_RENEW_LABELS.includes(b.label)).reduce((a, b) => a + b.invested, 0);
  el.innerHTML = `${header(ctx, "Vencimentos", `<button class="icon-btn" data-a="ics" aria-label="Adicionar vencimentos à agenda">${CAL_ICON}</button>`)}
    <div class="sub mb10">${esc(sub)}</div>
    ${lad.total ? ladderCard(lad, reserve) + planCard(lad) + aheadCard(lad) : ""}
    <div class="seg">${[["90", "90 dias"], ["365", "12 meses"], ["all", "Todos"]].map(([f, l]) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card" data-list></div>

    <div class="card">
      <div class="label">Regras de reinvestimento</div>
      <div class="rule"><i class="r-ok">1</i><span><b>Liquidez primeiro</b> — dinheiro novo curto (≤ 12 meses) ou liquidez diária: entrada do financiamento.</span></div>
      <div class="rule"><i class="r-ok">2</i><span><b>CDB ≥ ${cdbMin}% CDI</b>, até R$ 250 mil por emissor (FGC).</span></div>
      ${mat.brbLast ? `<div class="rule"><i class="r-bad">✕</i><span><b>Sem BRB</b> — manter os atuais até ${ddmmyyyy(mat.brbLast)}.</span></div>` : ""}
      ${mat.conc.map((c) => `<div class="rule"><i class="r-warn">!</i><span><b>${esc(c.issuer)} = ${pct(c.share * 100, 0)}</b> da ${esc(bankName(c.bank))}${c.joint ? " (conjunta)" : ""} — novos aportes em outros emissores.</span></div>`).join("")}
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

  el.querySelector('[data-a="ics"]').addEventListener("click", () => {
    const ics = maturitiesIcs(mat.rows.filter((r) => r.days >= 0), { bankName, money: (n) => brl(n, 2) });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "cofre-vencimentos.ics" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  const list = el.querySelector("[data-list]");
  const paint = () => {
    const rows = mat.rows.filter((r) => r.days >= 0 && (filter === "all" || r.days <= +filter));
    const liquid = mat.liquid.map((p) => `<div class="mat"><div class="date soon"><b>D+0</b><small>diária</small></div><div><b>${esc(p.bankName)} · Cofrinho${p.joint ? " · conjunta" : ""}</b><div class="muted">${esc(p.rate)}</div><div class="mt4"><span class="chip">liquidez diária</span></div></div><b>${brl(p.balance)}</b></div>`);
    list.innerHTML = rows.map((r) => {
      const tag = (r.tag === "brb" ? '<span class="chip bad">não renovar</span>' : r.tag === "conc" ? '<span class="chip warn">concentração</span>' : "")
        + (r.joint ? `<span class="chip joint">conjunta · ${esc(bankName(r.bank))}</span>` : "");
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

const AUTO_RENEW_LABELS = ["nubank"];
const CAL_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>`;
const termTxt = (m) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? "ano" : "anos"}` : `${m} meses`);
const pc = (x) => pct(x * 100, 1);
const toneOf = (share, t) => (Math.abs(share - t) <= 0.03 ? "on" : share > t ? "over" : "under");

// 1 · the ladder today: one bar per rung against the equal share; the daily-liquidity reserve shown apart.
function ladderCard(l, reserve) {
  const t = 1 / l.now.length, scale = Math.max(t, ...l.now.map((r) => r.share)) * 1.08;
  return `<div class="card">
    <div class="row"><div class="label">Escada de vencimentos</div><span class="muted sm">meta ${pc(t)} cada</span></div>
    ${reserve ? `<div class="rung reserve"><span class="k">0–3m</span><div class="rb"></div><span class="v"><b>${brl(reserve)}</b><span class="muted">Nubank · reserva</span></span></div>` : ""}
    ${l.now.map((r) => {
      const tone = toneOf(r.share, t);
      return `<div class="rung"><span class="k">${r.label}</span><div class="rb"><i class="${tone}" style="width:${(r.share / scale) * 100}%"></i><span class="tg" style="left:${(t / scale) * 100}%"></span></div>
        <span class="v"><b>${pc(r.share)}</b><span class="${tone}">${tone === "on" ? "na meta" : `${r.gap > 0 ? "+" : "−"}${brl(Math.abs(r.gap)).replace("R$ ", "")}`}</span></span></div>`;
    }).join("")}
    <div class="muted sm mt6">Azul: falta · laranja: sobra · traço: meta. A reserva diária fica fora do %.</div>
  </div>`;
}

// 2 · how to reinvest each upcoming maturity.
function planCard(l) {
  if (!l.plan.length) return "";
  return `<div class="card"><div class="row"><div class="label">Como reinvestir</div><span class="muted sm">próximos vencimentos</span></div>
    ${l.plan.slice(0, 6).map((p) => `<div class="mat-row"><div class="row"><span><b>${Number(p.due.slice(8))} ${MES[Number(p.due.slice(5, 7)) - 1]} ${p.due.slice(2, 4)}</b> · ${esc(p.issuers.join(", "))}${p.brb ? ' <span class="chip bad">não renovar</span>' : ""}</span><b class="nowrap">${brl(p.amount)}</b></div>
      <div class="buys">${p.buys.map((b) => `<span class="lbuy">${brl(b.amount)} → ${termTxt(b.months)}</span>`).join("")}</div></div>`).join("")}
    <div class="muted sm mt6">Um CDB a cada ~R$ 7 mil. Recalculado a cada atualização, com o que de fato venceu e foi aplicado.</div>
  </div>`;
}

// 3 · where it lands at the end of the horizon, with and without the plan.
function aheadCard(l) {
  if (!l.plan.length) return "";
  const t = 1 / l.now.length;
  const bars = (arr) => `<div class="mini" style="--n:${arr.length}">${arr.map((x) => `<i class="${toneOf(x, t)}" style="height:${(x / Math.max(t, ...arr)) * 100}%"></i>`).join("")}</div>
    <div class="mini lbl" style="--n:${arr.length}">${arr.map((x, k) => `<span>${l.now[k].label}<br>${pct(x * 100, 0)}</span>`).join("")}</div>`;
  return `<div class="card"><div class="row"><div class="label">Em 12 meses</div><span class="muted sm">${MES[Number(l.end.slice(5, 7)) - 1]}/${l.end.slice(2, 4)}, % por degrau</span></div>
    <div class="row muted sm mt6"><span>Sem o plano</span><span>maior degrau ${pct(Math.max(...l.without) * 100, 0)}</span></div>${bars(l.without)}
    <div class="row muted sm mt8"><span>Seguindo o plano</span><span>maior degrau ${pct(Math.max(...l.with) * 100, 0)}</span></div>${bars(l.with)}
  </div>`;
}
