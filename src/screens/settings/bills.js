// Ajustes › Contas: the contas do mês and the renewals, edited here. The first edit copies the lists from the rules
// file; from then on the phone's lists win and travel to the watcher with the decisions (phone.enc).
import { brl, esc, ddmmyyyy } from "../../lib/format.js";
import { listsOf, withList, monthlyFrom, renewalFrom } from "../../lib/lists.js";

export const id = "bills";
export const label = "Contas";

let editing = null; // { kind, i, draft? } (i = -1: new; draft: prefilled from a recurring charge)

export function render(t, ctx) {
  const l = listsOf(ctx.data);
  const src = l.own ? "Editadas neste aparelho · vão para o Telegram com as decisões." : "Vêm do arquivo de regras. Ao editar aqui, passam a ser deste aparelho.";
  return `<div class="muted sm">${src}${l.own && !ctx.data.rules?.sync?.gist ? " <b>Sem sincronização com o Telegram</b> (o arquivo de regras não tem o gist)." : ""}</div>
    ${foundCard(t.recurring || [])}
    <div class="sec">Contas do mês</div>${listCard("monthly", l.monthly, monthlyLine)}
    <div class="sec">Renovações</div>${listCard("renewals", l.renewals, renewalLine)}`;
}

// Charges that come back every month and are in no list yet: one tap prefills the form, or hides them for good.
function foundCard(found) {
  if (!found.length) return "";
  const rows = found.map((r, i) => `<div class="row bl"><span class="l"><b>${esc(r.name)}</b><small>${brl(r.amount, 2)} · ${r.day ? `todo dia ${r.day}` : `a cada ~${r.every} dias`} · ${r.card ? "no cartão" : "na conta"} · ${r.n} meses seguidos</small></span><span class="nw"><button class="lnk" data-r="add:${i}">Adicionar</button> <button class="lnk muted" data-r="ignore:${i}">Ignorar</button></span></div>`).join("");
  return `<div class="sec">Encontradas no extrato</div><div class="card"><div class="muted sm">Cobranças que se repetem todo mês e ainda não estão nas contas nem nas renovações.</div>${rows}</div>`;
}

function listCard(kind, list, line) {
  const rows = list.map((x, i) => editing?.kind === kind && editing.i === i ? form(kind, x) : `<div class="row bl"><span class="l">${line(x)}</span><span class="nw"><button class="lnk" data-e="${kind}:${i}">Editar</button></span></div>`).join("");
  const adding = editing?.kind === kind && editing.i === -1;
  return `<div class="card">${rows || '<div class="muted">Nenhuma.</div>'}${adding ? form(kind, editing.draft || {}) : `<button class="lnk mt10" data-e="${kind}:-1">+ Adicionar</button>`}</div>`;
}

const monthlyLine = (m) => `<b>${esc(m.name)}</b><small>${m.every ? `a cada ${m.every} dias depois do último pagamento (sexta a domingo → segunda)` : `todo dia ${m.day}`}${m.amount != null ? ` · ~${brl(m.amount, 2)}` : ""}${m.card ? " · no cartão" : ""}${m.match?.length ? ` · fecha com "${esc(m.match.join('" ou "'))}"` : ""}${m.note ? ` · ${esc(m.note)}` : ""}</small>`;
const renewalLine = (r) => `<b>${esc(r.name)}</b><small>renova ${ddmmyyyy(r.date)}${r.amount != null ? ` · ${brl(r.amount, 2)}${r.every === "month" ? "/mês" : r.every === "year" ? "/ano" : ""}` : ""}${r.note ? ` · ${esc(r.note)}` : ""}</small>`;
const val = (v) => esc(v ?? "");
const amt = (n) => (n == null ? "" : String(n).replace(".", ","));

function form(kind, x) {
  const del = editing.i >= 0 ? `<button type="button" class="lnk bad" data-a="del">Apagar</button>` : "<span></span>";
  if (kind === "monthly") {
    const every = Boolean(x.every);
    return `<form data-f="monthly" class="edit" autocomplete="off">
      <label class="in">Nome<input name="name" required value="${val(x.name)}" placeholder="Internet, aula…"></label>
      <div class="seg mini-seg"><button type="button" data-mode="day" class="${every ? "" : "on"}">Dia fixo</button><button type="button" data-mode="every" class="${every ? "on" : ""}">A cada N dias</button></div>
      <input type="hidden" name="mode" value="${every ? "every" : "day"}">
      <label class="in" data-show="day"${every ? " hidden" : ""}>Vence todo dia<input name="day" type="number" inputmode="numeric" min="1" max="31" value="${val(x.day ?? 10)}"></label>
      <label class="in" data-show="every"${every ? "" : " hidden"}>Dias depois do último pagamento<input name="every" type="number" inputmode="numeric" min="7" max="62" value="${val(x.every ?? 30)}"></label>
      <label class="in">Valor de referência (R$)<input name="amount" inputmode="decimal" value="${amt(x.amount)}"></label>
      <label class="in">Texto da cobrança no extrato (fecha sozinha; separe por ;)<input name="match" spellcheck="false" value="${val((x.match || []).join("; "))}"></label>
      <label class="in row"><span>Pago no cartão de crédito</span><input name="card" type="checkbox"${x.card ? " checked" : ""}></label>
      <label class="in">Nota<input name="note" value="${val(x.note)}"></label>
      <div class="err" role="alert"></div>
      <div class="row">${del}<span class="nw"><button type="button" class="lnk muted" data-a="cancel">Cancelar</button> <button class="btn ghost inline">Salvar</button></span></div>
    </form>`;
  }
  return `<form data-f="renewals" class="edit" autocomplete="off">
      <label class="in">Nome<input name="name" required value="${val(x.name)}"></label>
      <label class="in">Renova em<input name="date" type="date" required value="${val(x.date)}"></label>
      <label class="in">Valor (R$)<input name="amount" inputmode="decimal" value="${amt(x.amount)}"></label>
      <div class="seg mini-seg">${[["", "—"], ["month", "por mês"], ["year", "por ano"]].map(([k, l]) => `<button type="button" data-every="${k}" class="${(x.every || "") === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <input type="hidden" name="every" value="${val(x.every)}">
      <label class="in">Nota (o que fazer antes)<input name="note" value="${val(x.note)}"></label>
      <div class="err" role="alert"></div>
      <div class="row">${del}<span class="nw"><button type="button" class="lnk muted" data-a="cancel">Cancelar</button> <button class="btn ghost inline">Salvar</button></span></div>
    </form>`;
}

export function bind(pane, t, ctx, { repaint }) {
  const save = async (kind, list) => {
    await ctx.save(withList(ctx.data, kind, list));
    editing = null; repaint(); ctx.syncNow?.();
  };
  pane.onclick = async (e) => {
    const rc = e.target.closest("[data-r]")?.dataset.r;
    if (rc) {
      const [act, i] = rc.split(":"), r = (t.recurring || [])[Number(i)];
      if (!r) return;
      if (act === "ignore") { await ctx.save({ ...ctx.data, ignoredRecurring: [...(ctx.data.ignoredRecurring || []), r.key] }); repaint(); return; }
      const { name, amount, match, card, day, every } = r;
      editing = { kind: "monthly", i: -1, draft: { name, amount, match, card, ...(day ? { day } : { every }) } };
      repaint(); pane.querySelector("form.edit input")?.focus(); return;
    }
    const ed = e.target.closest("[data-e]")?.dataset.e;
    if (ed) { const [kind, i] = ed.split(":"); editing = { kind, i: Number(i) }; repaint(); pane.querySelector("form.edit input")?.focus(); return; }
    const mode = e.target.closest("[data-mode]")?.dataset.mode;
    if (mode) {
      const f = e.target.closest("form"); f.elements.mode.value = mode;
      f.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
      f.querySelectorAll("[data-show]").forEach((x) => { x.hidden = x.dataset.show !== mode; });
      return;
    }
    const ev = e.target.closest("[data-every]");
    if (ev) { const f = ev.closest("form"); f.elements.every.value = ev.dataset.every; f.querySelectorAll("[data-every]").forEach((b) => b.classList.toggle("on", b === ev)); return; }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "cancel") { editing = null; repaint(); }
    if (a === "del" && confirm("Apagar este item?")) {
      const list = [...listsOf(ctx.data)[editing.kind]]; list.splice(editing.i, 1);
      await save(editing.kind, list);
    }
  };
  pane.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.f, err = f.querySelector(".err");
    const raw = Object.fromEntries(new FormData(f)); raw.card = f.elements.card?.checked;
    const item = kind === "monthly" ? monthlyFrom(raw) : renewalFrom(raw);
    const list = [...listsOf(ctx.data)[kind]];
    if (editing.i >= 0) list[editing.i] = item; else list.push(item);
    try { await save(kind, list); } catch (x) { err.textContent = x.message; }
  };
}
