import { brl, mil, pct, ddmm, when, esc } from "../lib/format.js";
import { BANKS, freshness } from "../lib/model.js";

const REFRESH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

export function header(ctx, title) {
  const snap = ctx.data?.snapshot;
  const f = snap ? freshness(snap) : null;
  const b = f?.bankAt ? when(f.bankAt) : null;
  const sub = ctx.busy ? "Atualizando…" : b ? `Dados dos bancos: ${b.text}` : snap ? `Atualizado ${when(snap.at).text}` : "Sem dados";
  return `<div class="top"><div><h1>${title}</h1><div class="sub${b?.stale ? " stale" : ""}">${sub}</div></div>
    ${ctx.data?.credentials ? `<button class="icon-btn" data-a="refresh" aria-label="Atualizar">${REFRESH_ICON}</button>` : ""}</div>`;
}

export function needsSetup(el, ctx, title) {
  const missing = !ctx.data?.credentials ? "Conecte o Pluggy em Ajustes." : !ctx.data?.rules ? "Importe o arquivo de regras pessoais em Ajustes." : !ctx.data?.snapshot ? "Toque em atualizar para buscar os dados." : null;
  if (!missing) return false;
  el.innerHTML = `${header(ctx, title)}<div class="card empty"><b>Sem dados ainda</b>${missing}</div>`;
  return true;
}

export function render(el, ctx) {
  if (needsSetup(el, ctx, "Cofre")) return;
  const v = ctx.view();
  const { mine, joint, cards, month, mat } = v;
  const big = mine.banks.filter((b) => b.invested > 0 && b.count > 0);
  const small = mine.banks.filter((b) => !big.includes(b));
  const smallTotal = small.reduce((a, b) => a + b.total, 0);
  const stack = mine.banks.filter((b) => b.total > 0).map((b) => `<div style="width:${(b.total / mine.total) * 100}%;background:${BANKS[b.label]?.color || "var(--ink-3)"}"></div>`).join("");
  // Maturities within 30 days are already in the alerts card.
  const nextMat = mat.rows.find((r) => r.days > 30);
  const monthPct = (month.spent / month.target) * 100;

  el.innerHTML = `${header(ctx, "Cofre")}
    ${alertsCard(v.alerts)}
    <div class="card">
      <div class="label">Meu patrimônio</div>
      <div class="big">${brl(mine.total)}</div>
      <div class="muted">${mine.banks.map((b) => b.name).join(" + ")}</div>
      <div class="stack">${stack}</div>
      <div class="split">${big.map((b) => `<div class="tile"><span class="muted"><i class="bankdot" style="background:${BANKS[b.label]?.color}"></i>${esc(b.name)}</span><b>${mil(b.total)}</b><span class="muted">${b.cdiAvg ? `~${pct(b.cdiAvg, 0)} CDI · ` : ""}${b.count} ${b.count === 1 ? "título" : "títulos"}</span></div>`).join("")}</div>
      ${small.length ? `<div class="others"><div class="row muted"><span>Outras contas</span><span class="ink">${brl(smallTotal, 2)}</span></div>
        ${small.flatMap((b) => [
          b.checking || !b.reserved.length ? `<div class="row muted sm"><span><i class="bankdot" style="background:${BANKS[b.label]?.color}"></i>${esc(b.name)}</span><span>${brl(b.checking, 2)}</span></div>` : "",
          ...b.reserved.map((r) => `<div class="row muted sm"><span><i class="bankdot" style="background:${BANKS[b.label]?.color}"></i>${esc(b.name)} · Cofrinho</span><span class="nowrap">${brl(r.balance, 2)}</span></div>`),
        ]).join("")}</div>` : ""}
    </div>
    ${cards.filter((c) => c.bill > 0 || c.used > 0).map((c) => {
      const used = c.limit ? (c.used / c.limit) * 100 : null;
      const soon = c.due && v.daysTo(c.due) <= 7;
      return `<div class="card">
      <div class="row"><div><div class="label">Fatura ${esc(c.name)}</div><div class="kpi">${brl(c.bill)}</div></div>${c.due ? `<span class="chip${soon ? " warn" : ""}">vence ${ddmm(c.due)}</span>` : ""}</div>
      ${used !== null ? `<div class="track mt10"><div class="fill" style="width:${Math.min(100, used)}%;background:var(${used > 80 ? "--bad" : used > 40 ? "--warn" : "--brand"})"></div></div>
      <div class="row muted mt6"><span>${pct(used, 0)} do limite · usado ${brl(c.used)}</span><span>limite ${brl(c.limit)}</span></div>` : ""}
      ${c.ahead > 0 || c.early > 0 ? `<div class="list mt6">
        ${c.ahead > 0 ? `<div><span class="l">Parcelado nas próximas faturas</span><b>${brl(c.ahead)}</b></div>` : ""}
        ${c.early > 0 ? `<div><span class="l">Já pago adiantado<small>abatido da fatura</small></span><b>${brl(c.early)}</b></div>` : ""}
      </div>` : ""}
    </div>`;
    }).join("")}
    <div class="card">
      <div class="row"><div class="label">Próximos eventos</div><span class="muted">30 dias</span></div>
      <div class="list mt6">
        <div><span class="l">Gasto do mês<small>${brl(month.spent)} de ${brl(month.target)}</small></span><span class="chip${month.over ? " bad" : monthPct > 80 ? " warn" : ""}">${pct(monthPct, 0)}</span></div>
        ${nextMat ? `<div><span class="l">${esc(nextMat.issuer)}${nextMat.n > 1 ? ` ×${nextMat.n}` : ""} vence<small>${ddmm(nextMat.due)}${nextMat.joint ? " · conta conjunta" : ""} · ${esc(nextMat.rates.join(" / "))}${nextMat.days > 30 ? ` · em ${nextMat.days} dias` : ""}</small></span><b>${brl(nextMat.balance)}</b></div>` : ""}
      </div>
    </div>
    ${joint.map((j) => `<div class="card joint-card">
      <div class="row"><div><div class="label joint">${esc(j.title)}</div><div class="kpi">${mil(j.total)}</div></div><span class="chip joint">fora do meu total</span></div>
      <div class="list mt6">
        ${j.lines.map((l) => `<div><span class="l">${esc(l.name)}<small>${esc(l.meta)}</small></span><b>${mil(l.amount)}</b></div>`).join("")}
      </div>
    </div>`).join("")}`;
  el.addEventListener("click", (e) => {
    if (e.target.closest('[data-a="refresh"]')) ctx.refresh();
  });
}


function alertsCard(list) {
  if (!list.length) return "";
  const row = (a) => {
    if (a.kind === "bill") return `<div><span class="l">Fatura ${esc(a.bank)} ${a.days === 0 ? "vence hoje" : `vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}`}<small>${ddmm(a.due)}</small></span><b>${brl(a.amount)}</b></div>`;
    if (a.kind === "maturity") return `<div><span class="l">${esc(a.issuer)}${a.n > 1 ? ` ×${a.n}` : ""} vence em ${a.days} ${a.days === 1 ? "dia" : "dias"}<small>${a.scope === "joint" ? "conta conjunta · " : ""}${a.brb ? "não renovar no BRB" : `reinvestir em CDB ≥ ${a.cdbMin}% CDI ou liquidez diária`}</small></span><b>${brl(a.amount)}</b></div>`;
    return `<div><span class="l">${brl(a.amount)} parados na conta<small>${esc(a.bank)}${a.scope === "joint" ? " · conta conjunta" : ""} · investir o que passar da reserva</small></span><span class="chip warn">parado</span></div>`;
  };
  return `<div class="card alert-card"><div class="label">Atenção</div><div class="list mt6">${list.map(row).join("")}</div></div>`;
}
