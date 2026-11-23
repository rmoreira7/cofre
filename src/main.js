import { createVault, idbStorage, validPin } from "./lib/vault.js";
import { createPluggy } from "./lib/pluggy.js";
import { compileRules } from "./lib/categorize.js";
import { spendRows, monthView, byMonth, sum, monthRange, cardCycles, DEFAULT_TARGET } from "./lib/spend.js";
import { slim, holdings, cards, maturities as maturityLadder, primaryEntity, bankName } from "./lib/model.js";
import { localToday, daysBetween, ddmmyyyy } from "./lib/format.js";
import * as home from "./screens/home.js";
import * as spend from "./screens/spend.js";
import * as maturities from "./screens/maturities.js";
import * as projection from "./screens/projection.js";
import * as settings from "./screens/settings.js";

export const APP_VERSION = "0.3.2";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SCREENS = { home, spend, maturities, projection, settings };

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const vault = createVault(idbStorage());
const state = { data: null, current: "home", view: null, progress: "", busy: false };

const ctx = {
  version: APP_VERSION,
  get data() { return state.data; },
  get progress() { return state.progress; },
  async save(data) { await vault.save(data); state.data = data; state.view = null; },
  view: () => (state.view ||= buildView(state.data, localToday())),
  refresh,
  lock,
  async wipe() { await vault.wipe(); location.reload(); },
  go,
};

// Everything the screens show, derived once per data change.
export function buildView(data, today) {
  const rules = data.rules;
  const compiled = compileRules(rules);
  const snap = data.snapshot;
  const s = data.settings || {};
  const me = primaryEntity(rules);
  const cycles = s.monthMode === "calendar" ? null : cardCycles(snap, { rules, entity: me });
  const rows = spendRows(snap, { rules, compiled, entity: me, today, cycles });
  const mine = holdings(snap, rules, me);
  const month = monthView(rows, { today, target: s.target ?? DEFAULT_TARGET, limits: s.limits || {}, cycles });
  const m = byMonth(rows, "cluster", null, cycles ? "cyc" : "m");
  const last12 = monthRange(month.history[0].month, month.history.at(-2).month);
  const last3 = last12.slice(-3);
  const avg3 = last3.reduce((a, k) => a + sum(m[k]), 0) / (last3.length || 1);
  const avgN = last12.length;
  const avg12 = last12.reduce((a, k) => a + sum(m[k]), 0) / (avgN || 1);
  const joint = Object.keys(rules.entities).filter((e) => e !== me).map((e) => {
    const h = holdings(snap, rules, e);
    const pos = h.banks.flatMap((b) => b.positions).sort((a, b) => b.balance - a.balance).slice(0, 3);
    return {
      title: `Conta conjunta · ${h.banks.map((b) => b.name).join(" + ")}`,
      total: h.total,
      lines: [
        ...pos.map((p) => ({ name: `${p.subtype === "LCA" || p.subtype === "LCI" ? p.subtype : p.subtype === "CDB" ? "CDB" : "Fundo"} ${p.issuer}`, meta: `${p.rate}${p.due ? " · vence " + ddmmyyyy(p.due) : ""}`, amount: p.balance })),
        { name: "Conta corrente", meta: h.banks.map((b) => bankName(b.label)).join(" + "), amount: h.banks.reduce((a, b) => a + b.checking, 0) },
      ],
    };
  });
  return {
    today, rows, mine, month, avg12, avgN, avg3, joint,
    cards: cards(snap, rules, me, today),
    mat: maturityLadder(mine, today),
    daysTo: (iso) => daysBetween(today, iso),
  };
}

async function refresh() {
  const c = state.data?.credentials;
  if (!c || state.busy) return;
  state.busy = true;
  const done = [];
  const say = (t) => { state.progress = t; const p = document.querySelector("[data-p]"); if (p) p.textContent = t; document.body.classList.toggle("busy", state.busy); };
  say("Atualizando…");
  try {
    const p = createPluggy({ clientId: c.clientId, clientSecret: c.clientSecret });
    const pulled = await p.pullAll(c.items, { onProgress: (e) => { done.push(e); say(`Atualizando… ${done.length}/${c.items.length}`); } });
    const failed = pulled.items.filter((i) => i.error);
    const prev = state.data.snapshot;
    const next = slim(pulled);
    // A failed bank keeps its previous data instead of disappearing from the totals.
    next.items = next.items.map((it) => (it.error && prev?.items.find((o) => o.label === it.label && !o.error)) ? { ...prev.items.find((o) => o.label === it.label && !o.error), stale: true } : it);
    await ctx.save({ ...state.data, snapshot: next });
    state.busy = false;
    say(failed.length ? `Falhou: ${failed.map((f) => bankName(f.label)).join(", ")} (mantidos os dados anteriores)` : "");
  } catch (e) {
    state.busy = false;
    say(e.status === 401 || e.status === 403 ? "Credenciais recusadas pelo Pluggy." : `Erro ao atualizar: ${e.message}`);
  }
  go(state.current);
}

function go(name) {
  state.current = name;
  tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.s === name));
  app.innerHTML = "";
  const section = document.createElement("section");
  section.className = "screen on";
  app.append(section);
  SCREENS[name].render(section, ctx);
  window.scrollTo(0, 0);
}

function lock() {
  vault.lock();
  state.data = null;
  location.reload();
}

function pinPad({ title, subtitle, onDone }) {
  tabs.hidden = true;
  app.innerHTML = `
    <div class="lock">
      <h1>${title}</h1>
      <div class="muted">${subtitle}</div>
      <div class="pin">${"<i></i>".repeat(6)}</div>
      <div class="err" role="alert"></div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
        <button class="ghost" data-k="clear">Limpar</button><button data-k="0">0</button><button class="ghost" data-k="back">⌫</button>
      </div>
    </div>`;
  const dots = [...app.querySelectorAll(".pin i")];
  const err = app.querySelector(".err");
  let pin = "";
  let busy = false;
  const paint = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
  const api = {
    error(msg) { err.textContent = msg; pin = ""; paint(); busy = false; },
    reset(newTitle, newSub) {
      app.querySelector("h1").textContent = newTitle;
      app.querySelector(".muted").textContent = newSub;
      api.error("");
    },
  };
  app.querySelector(".keypad").addEventListener("click", async (e) => {
    const k = e.target.closest("button")?.dataset.k;
    if (!k || busy) return;
    if (k === "clear") pin = "";
    else if (k === "back") pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    err.textContent = "";
    paint();
    if (validPin(pin)) { busy = true; await onDone(pin, api); }
  });
  return api;
}

function onboarding() {
  let first = null;
  pinPad({
    title: "Criar PIN",
    subtitle: "6 dígitos. Ele protege tudo que fica neste aparelho.",
    async onDone(pin, ui) {
      if (!first) { first = pin; ui.reset("Confirmar PIN", "Digite o mesmo PIN de novo."); return; }
      if (pin !== first) { first = null; ui.reset("Criar PIN", "Os PINs não conferem. Comece de novo."); return; }
      await vault.create(pin, { v: 1, settings: { target: DEFAULT_TARGET }, credentials: null, rules: null, snapshot: null });
      state.data = await vault.unlock(pin);
      enter();
    },
  });
}

function unlockScreen() {
  pinPad({
    title: "Cofre",
    subtitle: "Digite seu PIN",
    async onDone(pin, ui) {
      try {
        state.data = await vault.unlock(pin);
        enter();
      } catch (e) {
        if (e.wiped) { ui.error("Muitas tentativas. Os dados deste aparelho foram apagados."); setTimeout(() => location.reload(), 2500); return; }
        ui.error(`PIN incorreto. Restam ${e.left} tentativas.`);
      }
    },
  });
}

function enter() {
  tabs.hidden = false;
  go(state.current);
}

let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (vault.unlocked && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
});
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) go(b.dataset.s);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
(await vault.exists()) ? unlockScreen() : onboarding();
