// Gastos: Ciclo · Grupos · Fatura · Parcelas · Assinaturas · Histórico · Buscar. The sub-tabs share the app's derived view as their context.
import { tabbedScreen } from "../../ui/tabbed.js";
import * as cycle from "./cycle.js";
import * as groups from "./groups.js";
import * as bills from "./bills.js";
import * as history from "./history.js";
import * as subs from "./subs.js";
import * as search from "./search.js";

export const screen = {
  tab: "spend",
  title: "Gastos",
  subs: [cycle, groups, bills, bills.installments, subs, history, search],
  context: (ctx) => ctx.view(),
};

export const { render } = tabbedScreen(screen);
