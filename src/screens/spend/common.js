// Shared by the Gastos sub-tabs.
import { brl } from "../../lib/format.js";

export const COLOR = { travel: "--c-travel", food: "--c-food", shop: "--c-shop", serv: "--c-serv", pix: "--c-pix", trans: "--c-trans", bills: "--c-bills", health: "--c-health", leis: "--c-leis", tobacco: "--c-cash", cash: "--c-cash", other: "--ink-3" };

export const kBRL = (n) => (Math.abs(n) >= 1000 ? `R$ ${(n / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil` : brl(n));
