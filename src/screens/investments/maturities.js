// Investimentos › Vencimentos: the maturity ladder, how to reinvest what matures, and the list (90 days · 12 months · all).
import { brl, mil, pct, MES, esc } from "../../lib/format.js";
import { bankName } from "../../lib/model.js";
import { maturitiesIcs } from "../../lib/ics.js";
import { calendarEvents, syncCalendar, SCOPE } from "../../lib/gcal.js";
import { requestToken } from "../../lib/gauth.js";
import { localToday } from "../../lib/format.js";
import { download } from "../../ui/shell.js";
import { earnTiles } from "../../ui/earn.js";

export const id = "maturities";
export const label = "Vencimentos";

let filter = "365";

export function render(t) {
  const { mat, lad, reserve } = t;
  const sub = mat.total ? `${[...new Set(mat.rows.map((r) => bankName(r.bank) + (r.joint ? " (conjunta)" : "")))].join(" + ")} · ${mil(mat.total)}` : "";
  return `    <div class="row mb10"><div class="sub">${esc(sub)}</div><span class="row"><button class="lnk" data-a="gcal">${CAL_ICON} Google Agenda</button><button class="lnk muted" data-a="ics">.ics</button></span></div>
    <div class="muted sm mb10" data-gstat role="status"></div>
    <div class="card muted sm" data-icshint hidden>${ICS_HINT}</div>
    ${lad.total ? ladderCard(lad, reserve) + planCard(lad) + aheadCard(lad) : ""}
    <div class="seg">${[["90", "90 dias"], ["365", "12 meses"], ["all", "Todos"]].map(([f, l]) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card" data-list></div>
`;
}

export function bind(pane, t, ctx) {
  const { mat } = t;
  const list = pane.querySelector("[data-list]");
  const paint = () => {
    const rows = mat.rows.filter((r) => r.days >= 0 && (filter === "all" || r.days <= +filter));
    const liquid = mat.liquid.map((p) => `<div class="mat"><div class="date soon"><b>D+0</b><small>diária</small></div><div><b>${esc(p.bankName)} · Cofrinho${p.joint ? " · conjunta" : ""}</b><div class="muted">${esc(p.rate)}</div><div class="mt4"><span class="chip">liquidez diária</span></div></div><b>${brl(p.balance)}</b></div>`);
    list.innerHTML = rows.map((r) => {
      const tag = (r.tag === "brb" ? '<span class="chip bad">não renovar</span>' : r.tag === "conc" ? '<span class="chip warn">concentração</span>' : "")
        + (r.joint ? `<span class="chip joint">conjunta · ${esc(bankName(r.bank))}</span>` : "");
      return `<div class="mat"><div class="date${r.days <= 90 ? " soon" : ""}"><b>${Number(r.due.slice(8, 10))}</b><small>${MES[Number(r.due.slice(5, 7)) - 1]} ${r.due.slice(2, 4)}</small></div>
        <div><b>${esc(r.issuer)}${r.n > 1 ? ` ×${r.n}` : ""}</b><div class="muted">${esc(r.rates.length > 2 ? `${r.n} títulos` : r.rates.join(" / "))} · em ${r.days} dias</div>${tag ? `<div class="mt4">${tag}</div>` : ""}</div><b>${brl(r.balance)}</b>${earnTiles(r.earn)}</div>`;
    }).concat(liquid).join("") || '<div class="muted">Nada neste período.</div>';
  };

  const gstat = pane.querySelector("[data-gstat]");
  let syncing = false;
  const gcal = async () => {
    const g = ctx.data.gcal;
    if (!g?.clientId) { ctx.go("settings", "connections"); return; }
    if (syncing) return;
    syncing = true; gstat.className = "muted sm mb10"; gstat.textContent = "Entrando no Google…";
    try {
      const token = await requestToken({ clientId: g.clientId, scope: SCOPE });
      gstat.textContent = "Enviando para a agenda…";
      const today = localToday(), money = (n) => brl(n, 2);
      const want = await calendarEvents({ mat: mat.rows, cards: t.cards, renewals: ctx.data.rules?.renewals || [], monthly: ctx.data.rules?.monthly || [], snapshot: ctx.data.snapshot, today, bankName, money });
      const r = await syncCalendar(want, { token, calId: g.calId, today });
      await ctx.update((d) => ({ ...d, gcal: { ...(d.gcal || {}), calId: r.calId, last: { at: new Date().toISOString(), total: want.length } } }));
      const kinds = { maturity: 0, bill: 0, renewal: 0 };
      for (const e of want) if (e.extendedProperties.private.kind in kinds) kinds[e.extendedProperties.private.kind]++;
      const what = [kinds.maturity && `${kinds.maturity} vencimentos`, kinds.bill && `${kinds.bill} faturas`, kinds.renewal && `${kinds.renewal} renovações`].filter(Boolean).join(", ");
      const bits = [r.added && `${r.added} novos`, r.updated && `${r.updated} atualizados`, r.removed && `${r.removed} removidos`].filter(Boolean);
      gstat.className = "ok sm mb10";
      gstat.textContent = `Agenda Cofre em dia: ${what || "nada pela frente"}${bits.length ? ` (${bits.join(", ")})` : ", nada mudou"}.`;
    } catch (e) {
      gstat.className = "bad sm mb10";
      gstat.textContent = e.status === 403 ? "O Google recusou: confira se a Google Calendar API está ativa e o escopo calendar.app.created foi adicionado." : e.message;
    } finally { syncing = false; }
  };
  pane.onclick = (e) => {
    if (e.target.closest('[data-a="gcal"]')) { gcal(); return; }
    const f = e.target.closest("[data-f]")?.dataset.f;
    if (f) { filter = f; pane.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.f === f)); paint(); }
    if (e.target.closest('[data-a="ics"]')) download("cofre-vencimentos.ics", new Blob([maturitiesIcs(mat.rows.filter((r) => r.days >= 0), { bankName, money: (n) => brl(n, 2) })], { type: "text/calendar" })), pane.querySelector("[data-icshint]").hidden = false;
  };
  paint();
}

// Google Calendar drops colors from imported files, so the color comes from the calendar the events go into.
const ICS_HINT = `<b>Na cor Tangerina, no Google Agenda:</b> no computador, em calendar.google.com, crie uma agenda <b>Cofre</b> e mude a cor dela para <b>Tangerina</b> (uma vez só). Depois: Configurações › Importar e exportar › escolha o arquivo e a agenda Cofre. Importar de novo atualiza os eventos, sem duplicar.`;
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
