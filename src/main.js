import { createVault, idbStorage, validPin } from "./lib/vault.js";
import * as home from "./screens/home.js";
import * as spend from "./screens/spend.js";
import * as maturities from "./screens/maturities.js";
import * as projection from "./screens/projection.js";
import * as settings from "./screens/settings.js";

export const APP_VERSION = "0.1.0";
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SCREENS = { home, spend, maturities, projection, settings };

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const vault = createVault(idbStorage());
const state = { data: null, current: "home" };

const ctx = {
  version: APP_VERSION,
  get data() { return state.data; },
  async save(data) { state.data = data; await vault.save(data); },
  lock,
  async wipe() { await vault.wipe(); location.reload(); },
  go,
};

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
      await vault.create(pin, { v: 1, settings: { target: 7000 }, credentials: null, rules: null, snapshot: null });
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
