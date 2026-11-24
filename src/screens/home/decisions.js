// Início › Decisões: what is open (with its deadline, the suggestion and what waiting costs), what you decided and
// whether the bank data confirms it, what is snoozed, and what opens next.
import { brl, ddmm, esc, pct } from "../../lib/format.js";
import { bankName } from "../../lib/model.js";
import { decide, undo } from "../../lib/decisions.js";
import { forget } from "../../lib/sync.js";

export const id = "decisions";
export const label = (t) => (t.board.open.length ? `Decisões · ${t.board.open.length}` : "Decisões");

const KIND = { bill: "Fatura", maturity: "Vencimento", idle: "Dinheiro parado", fgc: "FGC", renewal: "Renovação" };
const money = (n) => brl(n, Math.abs(n) < 100 ? 2 : 0);
const dmy = (iso) => `${ddmm(iso)}/${iso.slice(2, 4)}`;
const left = (d) => (d.days < 0 ? `venceu há ${-d.days} ${d.days === -1 ? "dia" : "dias"}` : d.days === 0 ? "hoje" : d.days === 1 ? "amanhã" : `em ${d.days} dias`);

export function render(t, ctx) {
  const { open, snoozed, decided } = t.board;
  return `${openCard(open)}${upcomingCard(t.upcoming)}${decidedCard(decided, t.today)}${snoozedCard(snoozed)}${syncLine(ctx)}`;
}

// Where these decisions come from: this phone only, or merged with the Telegram buttons (rules.sync). main.js
// refreshes this line in place when a sync ends without changing anything.
export function syncText(s) {
  const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (!s) return "Sincronizando com o Telegram…";
  if (s.err) return `Telegram: não sincronizou às ${hm(s.at)} (${s.err})`;
  return s.write ? `Sincronizado com o Telegram às ${hm(s.at)}` : `Lendo o Telegram às ${hm(s.at)} · o app ainda não envia (falta o token do gist)`;
}
const syncLine = (ctx) => (ctx?.data?.rules?.sync ? `<div class="muted sm mt6" data-syncline>${esc(syncText(ctx.sync))}</div>` : "");

export function bind(pane, t, ctx, { rerender }) {
  pane.onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const { act, d: id } = b.dataset;
    let apply;
    if (act === "undo") apply = (data) => ({ ...data, decisions: undo(data.decisions, id), undone: forget(data.undone, id) });
    else {
      const d = t.board.open.find((x) => x.id === id);
      if (!d) return;
      let note = null;
      if (act === "other") {
        note = prompt("O que você fez em vez da sugestão?", "")?.trim();
        if (!note) return;
      }
      apply = (data) => ({ ...data, decisions: decide(data.decisions, d, act, { today: t.today, note, by: "app" }) });
    }
    await ctx.update(apply);
    rerender();
    ctx.syncNow?.();
  };
}

function why(d) {
  if (d.kind === "bill") return d.detail?.early ? `${brl(d.detail.charges)} em lançamentos − ${brl(d.detail.early)} pagos adiantado` : "";
  if (d.kind === "idle") return `${brl(d.detail.balance)} na conta · reserva de ${brl(d.detail.reserve)} (Ajustes › Metas)`;
  if (d.kind === "fgc") return `${brl(d.detail.total)} neste emissor · o FGC cobre até R$ 250 mil`;
  if (d.kind === "renewal") return d.detail ? esc(d.detail) : "";
  return "";
}

function openCard(open) {
  if (!open.length) return `<div class="card empty"><b>Nada em aberto</b>Nenhuma fatura, vencimento ou dinheiro parado pedindo decisão agora.</div>`;
  return `<div class="card"><div class="row"><div class="label">Em aberto</div><span class="muted sm">pelo prazo</span></div>
    ${open.map((d) => {
      const amount = d.kind === "idle" ? `Investir ${brl(d.amount)} do ${esc(bankName(d.bank))}` : `${esc(d.title)}${d.amount != null ? ` · ${brl(d.amount)}` : ""}`;
      const due = d.kind === "idle" ? `<span class="due bad">${d.cost ? `custa ~${money(d.cost)}/dia útil` : "parado"}</span>`
        : d.kind === "fgc" ? `<span class="due bad">acima do FGC</span>` : `<span class="due${d.days <= 3 ? " warn" : ""}">${left(d)} · ${ddmm(d.due)}</span>`;
      const sug = d.kind === "maturity" ? `<div class="sug">${d.brb ? "<b>Não renovar no BRB.</b> " : ""}${d.suggestion ? `<b>Sugestão:</b> ${d.suggestion.map((s) => `${brl(s.amount)} em ${s.term}${s.rung ? ` (faixa ${s.rung})` : ""}`).join(" · ")} · ` : ""}${esc(d.rule)}${d.cost ? ` · cada dia útil sem aplicar custa ${money(d.cost)}` : ""}</div>` : "";
      const yes = d.kind === "bill" ? "Paga" : "Feito";
      return `<div class="dec">
          <span class="kind">${KIND[d.kind]}${d.joint ? " · conta conjunta" : ""}</span>
          <div class="h"><b>${amount}</b>${due}</div>
          ${why(d) ? `<div class="why">${why(d)}</div>` : ""}${sug}
          ${d.failed ? `<div class="failed">Marcada em ${ddmm(d.failed)}, mas os dados ainda não mostram: voltou para cá.</div>` : ""}
          <div class="act"><button class="pri" data-act="done" data-d="${esc(d.id)}">${yes}</button>${d.kind === "maturity" || d.kind === "idle" ? `<button data-act="other" data-d="${esc(d.id)}">Outra escolha</button>` : ""}<button data-act="snoozed" data-d="${esc(d.id)}">Adiar</button></div>
        </div>`;
    }).join("")}
  </div>`;
}

function upcomingCard(list) {
  if (!list.length) return "";
  return `<div class="card"><div class="row"><div class="label">Próximas</div><span class="muted sm">abrem 30 dias antes</span></div>
    <div class="list mt6">${list.slice(0, 8).map((u) => `<div><span class="l">${esc(u.title)}${u.joint ? " · conjunta" : ""}<small>${u.amount ? `${brl(u.amount)} · ` : ""}${u.detail ? `${esc(u.detail)} · ` : ""}abre em ${dmy(u.opens)}</small></span><span class="chip">${dmy(u.due)}</span></div>`).join("")}</div>
  </div>`;
}

const ICON = { ok: "✓", wait: "…", no: "✕", manual: "•" };
function outcomeText(r, today) {
  const o = r.outcome, d = r.d;
  if (r.status === "other") return `Outra escolha: ${esc(r.note)}`;
  if (d.kind === "renewal") return "marcado por você";
  if (d.kind === "maturity") {
    if (o.state === "ok") return `confirmado: ${brl(o.total)} em ${o.n} ${o.n === 1 ? "aplicação nova" : "aplicações novas"}${o.cdi ? ` · ${pct(o.cdi, 0)} CDI` : ""}`;
    if (o.state === "no") return `nenhuma aplicação nova no ${esc(bankName(d.bank))} até 10 dias depois do vencimento`;
    return today < d.due ? `aguardando o vencimento (${ddmm(d.due)})` : "esperando a aplicação aparecer nos dados (cerca de 1 dia)";
  }
  if (d.kind === "idle") return o.state === "ok" ? `confirmado: conta em ${brl(o.balance)}` : o.state === "no" ? `ainda ${brl(o.balance)} na conta` : `conta em ${brl(o.balance)} · confere por 7 dias`;
  if (d.kind === "bill") return o.state === "ok" ? `confirmado: pagamento de ${brl(o.paid)}` : o.state === "no" ? "o pagamento não apareceu até 3 dias depois do vencimento" : "esperando o pagamento aparecer nos dados (cerca de 1 dia)";
  return "";
}

function decidedCard(list, today) {
  if (!list.length) return "";
  const n = (s) => list.filter((r) => r.outcome.state === s).length;
  return `<div class="card"><div class="row"><div class="label">Decididas</div><span class="muted sm">os dados confirmam?</span></div>
    <div class="kpis"><div><span class="muted sm">Confirmadas</span><b class="ok">${n("ok")}</b></div><div><span class="muted sm">Aguardando</span><b class="warn">${n("wait")}</b></div><div><span class="muted sm">Não achadas</span><b>${n("no")}</b></div></div>
    <div class="mt6">${list.slice(0, 12).map((r) => `<div class="out"><i class="${r.outcome.state}">${ICON[r.outcome.state]}</i><div class="t">${esc(r.d.title)}${r.d.amount != null ? ` · ${brl(r.d.amount)}` : ""}<small>${r.status === "other" ? "Decidido" : r.d.kind === "bill" ? "Paga" : "Feito"} em ${ddmm(r.at)}${r.by === "telegram" ? " pelo Telegram" : ""} · ${outcomeText(r, today)}</small></div><button class="lnk muted" data-act="undo" data-d="${esc(r.id)}">Desfazer</button></div>`).join("")}</div>
  </div>`;
}

function snoozedCard(list) {
  if (!list.length) return "";
  return `<div class="card"><div class="label">Adiadas</div>
    <div class="list mt6">${list.map((d) => `<div><span class="l">${esc(d.title)}${d.amount != null ? ` · ${brl(d.amount)}` : ""}<small>volta em ${ddmm(d.until)}</small></span><button class="lnk" data-act="undo" data-d="${esc(d.id)}">Reabrir</button></div>`).join("")}</div>
  </div>`;
}
