import { createVault, idbStorage, validPin } from "./lib/vault.js";
import { createBio } from "./lib/bio.js";
import { createPluggy } from "./lib/pluggy.js";
import { DEFAULT_TARGET } from "./lib/spend.js";
import { slim, holdings, primaryEntity, bankName, shouldAutoRefresh } from "./lib/model.js";
import { localToday } from "./lib/format.js";
import { logPositions } from "./lib/income.js";
import { buildView } from "./lib/view.js";
import * as home from "./screens/home/index.js";
import * as spend from "./screens/spend/index.js";
import * as investments from "./screens/investments/index.js";
import * as projection from "./screens/projection/index.js";
import * as settings from "./screens/settings/index.js";

export const APP_VERSION = "0.17.0";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SCREENS = { home, spend, investments, projection, settings };

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const vault = createVault(idbStorage());
const bio = createBio(idbStorage("cofre", "vault", "bio"), {
  credentials: navigator.credentials, rpId: location.hostname,
  isAvailable: () => window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false,
});
const state = { data: null, current: "home", view: null, progress: "", busy: false, bio: { available: false, enrolled: false }, sub: loadSubs() };

// The last sub-tab of each tab: a per-device convenience, so it lives in localStorage (and works without it).
function loadSubs() { try { return JSON.parse(localStorage.getItem("cofre.sub") || "{}"); } catch { return {}; } }
function saveSubs() { try { localStorage.setItem("cofre.sub", JSON.stringify(state.sub)); } catch { /* private mode */ } }

const ctx = {
  version: APP_VERSION,
  get data() { return state.data; },
  get progress() { return state.progress; },
  get busy() { return state.busy; },
  async save(data) { await vault.save(data); state.data = data; state.view = null; },
  view: () => (state.view ||= buildView(state.data, localToday())),
  refresh,
  async setOverride(k, category) {
    const u = { ...(state.data.userOverrides || {}) };
    if (category) u[k] = category; else delete u[k];
    await ctx.save({ ...state.data, userOverrides: u });
  },
  lock,
  async wipe() { await bio.clear(); await vault.wipe(); location.reload(); },
  go,
  // The open sub-tab of `tab`, or the first of `ids` when none was opened yet (or it no longer exists).
  sub(tab, ids) { const s = state.sub[tab]; return ids.includes(s) ? s : ids[0]; },
  get bio() { return state.bio; },
  enrollBio,
  async disableBio() { await bio.clear(); state.bio.enrolled = false; go("settings"); },
};


// BRL rates for the foreign-currency balances (Wise). Only currency codes leave the device. On failure the previous
// rates stay (marked with their own date); with none, those balances count as 0 until a rate is fetched.
async function rates(snapshot, prev) {
  const cur = [...new Set(snapshot.items.flatMap((it) => (it.accounts || []).map((a) => a.currencyCode)).filter((c) => c && c !== "BRL"))];
  if (!cur.length) return prev || null;
  try {
    const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${cur.map((c) => `${c}-BRL`).join(",")}`);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const out = { at: new Date().toISOString() };
    for (const c of cur) { const v = Number(j[`${c}BRL`]?.bid); if (v > 0) out[c] = v; }
    return Object.keys(out).length > 1 ? out : prev || null;
  } catch {
    return prev || null;
  }
}

// Today's CDI in % per business day (Central Bank, SGS series 12), for Rendimentos. Nothing personal leaves the device.
// On failure the previous value stays.
async function cdi(prev) {
  try {
    const r = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json");
    if (!r.ok) throw new Error(r.status);
    const [last] = await r.json();
    const daily = Number(String(last.valor).replace(",", "."));
    if (!(daily > 0 && daily < 1)) throw new Error("bad value");
    const [d, m, y] = last.data.split("/");
    return { daily, date: `${y}-${m}-${d}` };
  } catch {
    return prev || null;
  }
}

async function refresh() {
  const c = state.data?.credentials;
  if (!c || state.busy) return;
  state.busy = true;
  const done = [];
  const say = (t) => {
    state.progress = t;
    const p = document.querySelector("[data-p]");
    if (p) p.textContent = t;
    const sub = document.querySelector(".top .sub");
    if (sub && state.busy) sub.textContent = "Atualizando…";
    document.body.classList.toggle("busy", state.busy);
  };
  say("Atualizando…");
  try {
    const p = createPluggy({ clientId: c.clientId, clientSecret: c.clientSecret });
    const pulled = await p.pullAll(c.items, { onProgress: (e) => { done.push(e); say(`Atualizando… ${done.length}/${c.items.length}`); } });
    const failed = pulled.items.filter((i) => i.error);
    const prev = state.data.snapshot;
    const next = slim(pulled);
    next.fx = await rates(next, prev?.fx);
    next.cdi = await cdi(prev?.cdi);
    // A failed bank keeps its previous data instead of disappearing from the totals.
    next.items = next.items.map((it) => (it.error && prev?.items.find((o) => o.label === it.label && !o.error)) ? { ...prev.items.find((o) => o.label === it.label && !o.error), stale: true } : it);
    // One wealth point per day (the last refresh of the day wins), per bank, for Projeção's reality check.
    const me = primaryEntity(state.data.rules);
    const h = me ? holdings(next, state.data.rules, me) : null;
    const log = (state.data.wealthLog || []).filter((w) => w.d !== localToday());
    if (h) log.push({ d: localToday(), banks: Object.fromEntries(h.banks.map((b) => [b.label, Math.round(b.total * 100) / 100])) });
    await ctx.save({ ...state.data, snapshot: next, wealthLog: log, invLog: logPositions(state.data.invLog, next, localToday()) });
    state.busy = false;
    say(failed.length ? `Falhou: ${failed.map((f) => bankName(f.label)).join(", ")} (mantidos os dados anteriores)` : "");
  } catch (e) {
    state.busy = false;
    say(e.status === 401 || e.status === 403 ? "Credenciais recusadas pelo Pluggy." : `Erro ao atualizar: ${e.message}`);
  }
  go(state.current);
}

function go(name, sub) {
  if (sub) { state.sub[name] = sub; saveSubs(); }
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

function pinPad({ title, subtitle, onDone, extra = "" }) {
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
      ${extra}
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
      await bio.clear();
      await vault.create(pin, { v: 1, settings: { target: DEFAULT_TARGET }, credentials: null, rules: null, snapshot: null });
      state.data = await vault.unlock(pin);
      enter();
    },
  });
}

async function unlockWith(pin, ui) {
  try {
    state.data = await vault.unlock(pin);
    enter();
  } catch (e) {
    if (e.wiped) { await bio.clear(); ui.error("Muitas tentativas. Os dados deste aparelho foram apagados."); setTimeout(() => location.reload(), 2500); return; }
    ui.error(`PIN incorreto. Restam ${e.left} tentativas.`);
    throw e;
  }
}

function unlockScreen() {
  const withBio = state.bio.available && state.bio.enrolled;
  const ui = pinPad({
    title: "Cofre",
    subtitle: withBio ? "Use a digital ou digite seu PIN" : "Digite seu PIN",
    extra: withBio ? '<button class="btn ghost bio" data-a="bio">Usar digital</button>' : "",
    async onDone(pin, ui) { await unlockWith(pin, ui).catch(() => {}); },
  });
  if (!withBio) return;
  const tryBio = async () => {
    let pin;
    try { pin = await bio.pin(); } catch (e) { if (e.unsupported) ui.error(e.message); return; }
    // A sealed PIN that no longer opens the vault (the PIN changed, the vault was recreated) is useless: drop it.
    await unlockWith(pin, ui).catch(async (e) => { if (!e.wiped) { await bio.clear(); state.bio.enrolled = false; ui.error("A digital foi desativada: entre com o PIN e ative de novo em Ajustes."); } });
  };
  app.querySelector('[data-a="bio"]').addEventListener("click", tryBio);
  tryBio();
}

// Ajustes › Segurança: confirm the PIN, then create the passkey. The PIN check is a real unlock (counts attempts).
function enrollBio() {
  pinPad({
    title: "Ativar digital",
    subtitle: "Confirme seu PIN. Depois o celular pede a digital.",
    extra: '<button class="btn ghost" data-a="cancel">Cancelar</button>',
    async onDone(pin, ui) {
      try { await vault.unlock(pin); } catch (e) {
        if (e.wiped) { await bio.clear(); location.reload(); return; }
        ui.error(`PIN incorreto. Restam ${e.left} tentativas.`); return;
      }
      try {
        await bio.enroll(pin);
        state.bio.enrolled = true;
        enter(); go("settings");
      } catch (e) {
        ui.error(e.unsupported ? e.message : e.name === "NotAllowedError" ? "Cancelado. Tente de novo." : `Não foi possível ativar: ${e.message}`);
      }
    },
  });
  app.querySelector('[data-a="cancel"]').addEventListener("click", () => { enter(); go("settings"); });
}

function enter() {
  tabs.hidden = false;
  go(state.current);
  maybeRefresh();
}

// At most one automatic attempt per 15 min, so a failing bank or no signal doesn't retry on every app switch.
let lastAuto = 0;
function maybeRefresh() {
  if (!state.data?.credentials || !state.data?.rules || state.busy || Date.now() - lastAuto < 15 * 6e4) return;
  if (!shouldAutoRefresh(state.data.snapshot)) return;
  lastAuto = Date.now();
  refresh();
}

let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (vault.unlocked && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
  else if (vault.unlocked) maybeRefresh();
});
// Sub-tabs switch in place (every pane is already rendered, only one shown); a [data-go="tab:sub"] link opens another tab.
app.addEventListener("click", (e) => {
  const st = e.target.closest("[data-sub]");
  if (st) {
    const sec = st.closest("section"), id = st.dataset.sub;
    state.sub[state.current] = id; saveSubs();
    sec.querySelectorAll("[data-sub]").forEach((b) => { b.classList.toggle("on", b.dataset.sub === id); b.setAttribute("aria-selected", b.dataset.sub === id); });
    sec.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== id; });
    window.scrollTo(0, 0);
    return;
  }
  const g = e.target.closest("[data-go]")?.dataset.go;
  if (g) { const [tab, sub] = g.split(":"); go(tab, sub); }
});

tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) go(b.dataset.s);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
state.bio = { available: await bio.available(), enrolled: await bio.enrolled() };
(await vault.exists()) ? unlockScreen() : onboarding();
