// A tab made of sub-tabs. Each sub-tab is a module exporting:
//   id, label           — the pill (label may be a function of the tab's context, e.g. a count)
//   render(t, ctx)      — its pane's HTML (t = the tab's shared context)
//   bind(pane, t, ctx, { repaint, rerender })   — optional: wire its own pane. repaint() redraws just this pane (UI
//                         state changed); rerender() redraws the whole tab (data changed, other panes may depend on it).
// Every pane is rendered and one is shown; main.js switches panes in place when a pill is tapped.
import { header, needsSetup } from "./shell.js";
import { esc } from "../lib/format.js";

export function subTabs(list, on, t) {
  const text = (label) => (typeof label === "function" ? label(t) : label);
  return `<div class="sub-tabs" role="tablist">${list.map(({ id, label }) => `<button role="tab" data-sub="${id}" class="${id === on ? "on" : ""}" aria-selected="${id === on}">${text(label)}</button>`).join("")}</div>`;
}

// def: { tab, title, subs, context?(ctx), blocked?(ctx) → html | null, head?(ctx, t), gate = true }
export function tabbedScreen({ tab, title, subs, context = () => ({}), blocked, head, gate = true }) {
  function render(el, ctx) {
    if (gate && needsSetup(el, ctx, title)) return;
    const stop = blocked?.(ctx);
    if (stop) { el.innerHTML = `${header(ctx, title)}${stop}`; return; }
    const t = context(ctx);
    const on = ctx.sub(tab, subs.map((s) => s.id));
    el.innerHTML = `${head ? head(ctx, t) : header(ctx, title)}${subTabs(subs, on, t)}${subs.map((s) => `<div data-pane="${s.id}"${s.id === on ? "" : " hidden"}></div>`).join("")}`;
    el.onclick = (e) => { if (e.target.closest('[data-a="refresh"]')) ctx.refresh(); };
    const rerender = () => render(el, ctx);
    for (const s of subs) paint(el.querySelector(`[data-pane="${s.id}"]`), s, t, ctx, rerender);
  }
  // A sub-tab that throws shows an error in its own pane; the others still paint.
  function paint(pane, s, t, ctx, rerender) {
    try {
      pane.innerHTML = s.render(t, ctx);
      s.bind?.(pane, t, ctx, { repaint: () => paint(pane, s, t, ctx, rerender), rerender });
    } catch (e) {
      console.error(`${tab}/${s.id}:`, e);
      pane.innerHTML = `<div class="card empty"><b>Erro nesta aba</b>${esc(e.message)}</div>`;
    }
  }
  return { render };
}
