// Investimentos: Carteira · Rendimentos · Vencimentos · Regras. Context = the app's view, plus the ladder simulation
// (a few hundred ms) computed once per data change and the daily-liquidity reserve the ladder stands on.
import { tabbedScreen } from "../../ui/tabbed.js";
import { ladder } from "../../lib/ladder.js";
import { RESERVE_BANKS } from "../../lib/agenda.js";
import * as wallet from "./wallet.js";
import * as income from "./income.js";
import * as maturities from "./maturities.js";
import * as rules from "./rules.js";


export const screen = {
  tab: "investments",
  title: "Investimentos",
  subs: [wallet, income, maturities, rules],
  context(ctx) {
    const v = ctx.view();
    v.ladder ||= ladder(v.mat.rows, { today: v.today });
    // The part set apart for the card bill (Ajustes › Metas) is not liquidity for anything else.
    const kept = v.cash?.earmark || 0;
    const reserve = v.wealth.banks.filter((b) => RESERVE_BANKS.includes(b.label)).reduce((a, b) => a + b.invested, 0) - kept;
    return { ...v, lad: v.ladder, reserve, kept };
  },
};

export const { render } = tabbedScreen(screen);
