// Início: Resumo · Agenda · Decisões. Context = the view, plus the decision board: what is open, decided (checked against the
// bank data) and snoozed, and what opens next. The ladder simulation (it sizes each maturity's suggestion) is cached per
// snapshot, so a tap on a decision does not run it again.
import { tabbedScreen } from "../../ui/tabbed.js";
import { ladder } from "../../lib/ladder.js";
import { candidates, upcoming, board } from "../../lib/decisions.js";
import { listsOf } from "../../lib/lists.js";
import * as summary from "./summary.js";
import * as agenda from "./agenda.js";
import * as decisions from "./decisions.js";

let cache = { at: null, lad: null };

export const screen = {
  tab: "home",
  title: "Cofre",
  subs: [summary, agenda, decisions],
  context(ctx) {
    const v = ctx.view(), d = ctx.data, s = d.settings || {};
    if (cache.at !== d.snapshot.at) cache = { at: d.snapshot.at, lad: ladder(v.mat.rows, { today: v.today }) };
    const opts = { today: v.today, idleCash: s.idleCash ?? 5000, cdbMin: s.cdbMin ?? 110, cdiDaily: d.snapshot.cdi?.daily ?? null, ...listsOf(d), snapshot: d.snapshot };
    const cands = candidates(v, { ...opts, lad: cache.lad });
    return { v, today: v.today, board: board(cands, d.decisions, d.snapshot, opts), upcoming: upcoming(v, opts) };
  },
};

export const { render } = tabbedScreen(screen);
