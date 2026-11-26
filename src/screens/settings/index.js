// Ajustes: Conexões · Contas · Metas · Segurança · App. Opens without data (it is where the data comes from), so there is no
// setup gate; the context only carries the spending trends the limit suggestions need and the recurring charges found in the
// statements, when there is data for them.
import { tabbedScreen } from "../../ui/tabbed.js";
import { esc } from "../../lib/format.js";
import * as connections from "./connections.js";
import * as goals from "./goals.js";
import * as bills from "./bills.js";
import * as security from "./security.js";
import * as about from "./about.js";

export const screen = {
  tab: "settings",
  title: "Ajustes",
  subs: [connections, bills, goals, security, about],
  gate: false,
  head: (ctx) => `<div class="top"><div><h1>Ajustes</h1><div class="sub">Tudo fica neste aparelho · v${esc(ctx.version)}</div></div></div>`,
  context(ctx) {
    const d = ctx.data || {};
    let trends = null, recurring = [];
    try { if (d.rules && d.snapshot) ({ trends, recurring } = ctx.view()); } catch { trends = null; recurring = []; }
    return { trends, recurring };
  },
};

export const { render } = tabbedScreen(screen);
