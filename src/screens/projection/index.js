// Projeção: Cenários · Real × plano · Premissas. Context = the three spending scenarios, the projection runner and the
// real-vs-projected comparison for the chosen scenario, computed once per render.
import { tabbedScreen } from "../../ui/tabbed.js";
import { project, validParams, reality, milestones, nextLevels } from "../../lib/projection.js";
import { ui, MIN } from "./state.js";
import * as scenarios from "./scenarios.js";
import * as realityTab from "./reality.js";
import * as assumptions from "./assumptions.js";

const PLAN_SPEND = 7000; // the spending the original simulation assumed (projection.spend in the rules file overrides it)

export const screen = {
  tab: "projection",
  title: "Projeção",
  subs: [scenarios, realityTab, assumptions],
  blocked: (ctx) => (validParams(ctx.data.rules?.projection) ? null
    : `<div class="card empty"><b>Sem premissas</b>O arquivo de regras não traz os parâmetros da projeção.<br>Gere de novo no notebook com <code>projection.json</code> e importe em Ajustes.</div>`),
  context(ctx) {
    const v = ctx.view();
    const p = ctx.data.rules.projection;
    const target = ctx.data.settings?.target ?? PLAN_SPEND;
    const realSpend = Math.round(v.avg12 / 100) * 100;
    // Ritmo real = the average of the closed cycles; Meta = the Gastos target; Plano = the original simulation's spending.
    const planSpend = p.spend ?? PLAN_SPEND;
    const scns = [["real", "Ritmo real", realSpend], ["meta", target === planSpend ? "Meta = plano" : "Meta", target], ["plan", "Plano", planSpend]]
      .filter(([, , sp], i, all) => all.findIndex((x) => x[2] === sp) === i);
    if (!scns.some((x) => x[0] === ui.scenario)) ui.scenario = scns[0][0];
    const y0 = Number(v.today.slice(0, 4)) + 1, y1 = y0 + 1;
    const start = v.mine.total;
    const run = (spend, untilYear = y1) => project(p, { start, today: v.today, spend, untilYear });
    const max = Math.max(MIN + 100, Math.ceil(Math.max(realSpend, target) / 100) * 100);
    if (ui.chosen === null || ui.chosen > max) ui.chosen = Math.min(max, Math.max(MIN, target));
    const levels = nextLevels(start);
    const hits = scns.map(([k, label, sp]) => [k, label, milestones(run(sp, y0 + 3).path, levels)]);
    const series = (() => { const m = new Map(); for (const w of ctx.data.rules?.wealth || []) m.set(w.d, w); for (const w of ctx.data.wealthLog || []) m.set(w.d, w); return [...m.values()]; })();
    const [, label, spend] = scns.find((x) => x[0] === ui.scenario);
    const rr = reality(p, series, { spend, from: p.from, today: v.today });
    return { v, p, target, realSpend, planSpend, scns, y0, y1, start, run, max, levels, hits, rr, label, spend };
  },
};

export const { render } = tabbedScreen(screen);
