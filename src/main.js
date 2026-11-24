import { createVault, idbStorage, validPin } from "./lib/vault.js";
import { createBio } from "./lib/bio.js";
import { createPluggy } from "./lib/pluggy.js";
import { compileRules } from "./lib/categorize.js";
import { spendRows, incomeRows, leftover, salaryForecast, monthView, byMonth, sum, monthRange, cardCycles, BANK_CODES, DEFAULT_TARGET, clusterTrends, suggestGoals } from "./lib/spend.js";
import { slim, holdings, cards, timeline, maturities as maturityLadder, fgc, primaryEntity, bankName, alerts, shouldAutoRefresh, installmentsAhead } from "./lib/model.js";
import { localToday, daysBetween } from "./lib/format.js";
import * as home from "./screens/home.js";
import * as spend from "./screens/spend.js";
import * as maturities from "./screens/maturities.js";
import * as projection from "./screens/projection.js";
import * as settings from "./screens/settings.js";

export const APP_VERSION = "0.13.0";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SCREENS = { home, spend, maturities, projection, settings };

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const vault = createVault(idbStorage());
const bio = createBio(idbStorage("cofre", "vault", "bio"), {
  credentials: navigator.credentials, rpId: location.hostname,
  isAvailable: () => window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false,
});
const state = { data: null, current: "home", view: null, progress: "", busy: false, bio: { available: false, enrolled: false } };

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
  get bio() { return state.bio; },
  enrollBio,
  async disableBio() { await bio.clear(); state.bio.enrolled = false; go("settings"); },
};

// Everything the screens show, derived once per data change.
export function buildView(data, today) {
  const rules = data.rules;
  const compiled = compileRules(rules, data.userOverrides || {});
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
  const income = incomeRows(snap, { rules, compiled, entity: me, today, cycles });
  const key = cycles ? "cyc" : "m";
  // Months with income data only: before Pluggy's first month there is none (the bill history has spending only).
  const firstIncome = income.reduce((a, r) => (r[key] && r[key] < a ? r[key] : a), "9999");
  const pastLeft = leftover(income, rows, last12.filter((k) => k > firstIncome), key);
  const avg = (f) => pastLeft.reduce((a, r) => a + r[f], 0) / (pastLeft.length || 1);
  const salaryFrom = [...new Set(income.filter((r) => r.kind === "salary").map((r) => BANK_CODES[r.from] || `banco ${r.from}`))];
  const left = { now: leftover(income, rows, [month.month], key)[0], n: pastLeft.length, avg: { left: avg("regular"), salary: avg("salary"), other: avg("other"), spent: avg("spent"), oneOff: pastLeft.reduce((a, r) => a + r.oneOff, 0) }, history: pastLeft, salaryFrom };
  const trends = clusterTrends(m, last12);
  const goals = suggestGoals({ income: pastLeft.length ? left.avg.left + left.avg.spent : 0, trends });
  // Wealth, maturities and the FGC check cover every connected account, the joint one (Itaú) included. Spending,
  // income and Projeção stay on the owner's accounts: the joint account's flows are the household's, not his.
  const wealth = holdings(snap, rules, null);
  const v = {
    today, rows, mine, wealth, month, avg12, avgN, avg3, left, trends, goals,
    cards: cards(snap, rules, me, today),
    mat: maturityLadder(wealth, today),
    guarantee: fgc(wealth),
    daysTo: (iso) => daysBetween(today, iso),
  };
  v.installments = installmentsAhead(snap, rules, me, today);
  v.alerts = alerts(v, { idleCash: s.idleCash ?? 5000, cdbMin: s.cdbMin ?? 110 });
  v.timeline = timeline({ cards: v.cards, mat: v.mat, salary: salaryForecast(income, { today }), today });
  return v;
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
    // A failed bank keeps its previous data instead of disappearing from the totals.
    next.items = next.items.map((it) => (it.error && prev?.items.find((o) => o.label === it.label && !o.error)) ? { ...prev.items.find((o) => o.label === it.label && !o.error), stale: true } : it);
    // One wealth point per day (the last refresh of the day wins), per bank, for Projeção's reality check.
    const me = primaryEntity(state.data.rules);
    const h = me ? holdings(next, state.data.rules, me) : null;
    const log = (state.data.wealthLog || []).filter((w) => w.d !== localToday());
    if (h) log.push({ d: localToday(), banks: Object.fromEntries(h.banks.map((b) => [b.label, Math.round(b.total * 100) / 100])) });
    await ctx.save({ ...state.data, snapshot: next, wealthLog: log });
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
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) go(b.dataset.s);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
state.bio = { available: await bio.available(), enrolled: await bio.enrolled() };
(await vault.exists()) ? unlockScreen() : onboarding();
