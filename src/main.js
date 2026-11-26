import { createVault, idbStorage, validPin, sealBackup, openBackup } from "./lib/vault.js";
import { createBio } from "./lib/bio.js";
import { createPluggy } from "./lib/pluggy.js";
import { DEFAULT_TARGET } from "./lib/spend.js";
import { slim, holdings, primaryEntity, bankName, shouldAutoRefresh } from "./lib/model.js";
import { localToday } from "./lib/format.js";
import { logPositions } from "./lib/income.js";
import { keepYearEnd } from "./lib/yearend.js";
import { buildView } from "./lib/view.js";
import { merge, same, canon } from "./lib/sync.js";
import { pullWatcher, pushPhone } from "./lib/remote.js";
import * as home from "./screens/home/index.js";
import { syncText } from "./screens/home/decisions.js";
import * as spend from "./screens/spend/index.js";
import * as investments from "./screens/investments/index.js";
import * as projection from "./screens/projection/index.js";
import * as settings from "./screens/settings/index.js";

export const APP_VERSION = "0.22.0";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SCREENS = { home, spend, investments, projection, settings };

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const vault = createVault(idbStorage());
const bio = createBio(idbStorage("cofre", "vault", "bio"), {
  credentials: navigator.credentials, rpId: location.hostname,
  isAvailable: () => window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false,
});
const state = { data: null, current: "home", view: null, progress: "", busy: false, bio: { available: false, enrolled: false }, sub: loadSubs(), sync: null };

// The last sub-tab of each tab: a per-device convenience, so it lives in localStorage (and works without it).
function loadSubs() { try { return JSON.parse(localStorage.getItem("cofre.sub") || "{}"); } catch { return {}; } }
function saveSubs() { try { localStorage.setItem("cofre.sub", JSON.stringify(state.sub)); } catch { /* private mode */ } }

const ctx = {
  version: APP_VERSION,
  get data() { return state.data; },
  get progress() { return state.progress; },
  get busy() { return state.busy; },
  save: (data) => update(() => data),
  update,
  syncNow: () => syncDecisions({ force: true }),
  get sync() { return state.sync; },
  view: () => (state.view ||= buildView(state.data, localToday())),
  refresh,
  async setOverride(k, category) {
    const u = { ...(state.data.userOverrides || {}) };
    if (category) u[k] = category; else delete u[k];
    await ctx.save({ ...state.data, userOverrides: u });
  },
  lock,
  backup: (pass) => saving.then(() => sealBackup(state.data, pass)),
  async wipe() { await bio.clear(); await vault.wipe(); location.reload(); },
  go,
  // The open sub-tab of `tab`, or the first of `ids` when none was opened yet (or it no longer exists).
  sub(tab, ids) { const s = state.sub[tab]; return ids.includes(s) ? s : ids[0]; },
  get bio() { return state.bio; },
  enrollBio,
  async disableBio() { await bio.clear(); state.bio.enrolled = false; go("settings"); },
};

// Vault writes run one at a time; update(fn) builds the new data from the latest saved one, so a background sync
// never writes back data from before a tap made meanwhile.
let saving = Promise.resolve();
function update(fn) {
  const run = saving.then(async () => {
    const data = fn(state.data);
    if (data === state.data) return;
    await vault.save(data);
    state.data = data; state.view = null;
  });
  saving = run.catch(() => {});
  return run;
}

// Decisions ↔ Telegram (rules.sync, from the laptop's rules file): read the watcher's state, merge (latest change wins),
// and write the result to the phone's gist when it changed and the file carries a gist token. On unlock, on return
// to the app (at most once a minute), and after each decision. state.sync: { at, err, write } for Decisões.
let syncing = null, lastSync = 0, again = false;
function syncDecisions({ force = false } = {}) {
  const cfg = state.data?.rules?.sync;
  if (!cfg?.key) return Promise.resolve();
  if (syncing) { again ||= force; return syncing; } // a decision made mid-sync is sent by a second pass
  if (!force && Date.now() - lastSync < 6e4) return Promise.resolve();
  lastSync = Date.now();
  syncing = (async () => {
    let m, changed = false;
    try {
      const w = await pullWatcher({ repo: cfg.repo, key: cfg.key });
      await update((d) => {
        const local = { decisions: d.decisions || {}, undone: d.undone || {} };
        m = merge([local, w]);
        changed = !same(local, m);
        return changed ? { ...d, ...m } : d;
      });
      const h = canon(m);
      if (cfg.gist && cfg.token && h !== state.data.syncPushed) {
        await pushPhone({ gist: cfg.gist, token: cfg.token, key: cfg.key, value: { v: 1, ...m } });
        await update((d) => ({ ...d, syncPushed: h }));
      }
      state.sync = { at: new Date(), err: null, write: Boolean(cfg.gist) };
    } catch (e) {
      state.sync = { at: new Date(), err: e.message, write: Boolean(cfg.gist) };
    } finally {
      syncing = null;
    }
    if (changed && state.current === "home") go("home");
    else { const l = document.querySelector("[data-syncline]"); if (l) l.textContent = syncText(state.sync); }
    if (again) { again = false; return syncDecisions({ force: true }); }
  })();
  return syncing;
}

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
    await update((d) => ({ ...d, snapshot: next, wealthLog: log, invLog: logPositions(d.invLog, next, localToday()), yearEnd: keepYearEnd(d.yearEnd, next, localToday()) }));
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

function onboarding(restored = null) {
  let first = null;
  pinPad({
    title: restored ? "Novo PIN" : "Criar PIN",
    subtitle: restored ? "Backup aberto. Crie o PIN deste aparelho (6 dígitos)." : "6 dígitos. Ele protege tudo que fica neste aparelho.",
    extra: restored ? "" : '<button class="btn ghost" data-a="restore">Restaurar backup</button>',
    async onDone(pin, ui) {
      if (!first) { first = pin; ui.reset("Confirmar PIN", "Digite o mesmo PIN de novo."); return; }
      if (pin !== first) { first = null; ui.reset("Criar PIN", "Os PINs não conferem. Comece de novo."); return; }
      await bio.clear();
      await vault.create(pin, restored || { v: 1, settings: { target: DEFAULT_TARGET }, credentials: null, rules: null, snapshot: null });
      state.data = await vault.unlock(pin);
      enter();
    },
  });
  app.querySelector('[data-a="restore"]')?.addEventListener("click", restoreScreen);
}

// A backup file from Ajustes › Segurança: pick it, type its password, then create this device's PIN.
function restoreScreen() {
  tabs.hidden = true;
  app.innerHTML = `
    <div class="lock">
      <h1>Restaurar backup</h1>
      <div class="muted">O arquivo cofre-backup-….json e a senha dele.</div>
      <form data-f="restore" autocomplete="off" style="width:100%;max-width:320px">
        <label class="in mt10"><span>Arquivo</span><input name="file" type="file" accept=".json,application/json" required></label>
        <label class="in mt6"><span>Senha do backup</span><input name="pass" type="password" autocomplete="current-password" required></label>
        <div class="err" role="alert"></div>
        <button class="btn">Abrir backup</button>
        <button class="btn ghost" type="button" data-a="back">Voltar</button>
      </form>
    </div>`;
  const f = app.querySelector("form"), err = f.querySelector(".err");
  f.querySelector('[data-a="back"]').addEventListener("click", () => onboarding());
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const btn = f.querySelector(".btn"); btn.disabled = true;
    try {
      let file;
      try { file = JSON.parse(await f.elements.file.files[0].text()); } catch { throw new Error("Este arquivo não é um backup do Cofre."); }
      onboarding(await openBackup(file, f.elements.pass.value));
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
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
  syncDecisions();
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
  else if (vault.unlocked) { maybeRefresh(); syncDecisions(); }
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
