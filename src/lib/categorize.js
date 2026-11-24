// Transaction categorizer: a port of finance/pluggy/categories.py, generic rules only.
// Everything personal (payee rules, learned merchant map, overrides) arrives in the imported rules file.
import { validRenewals } from "./decisions.js";

export const RULES_FORMAT = "cofre-rules";
export const RULES_VERSION = 1;
export const GENERIC = new Set(["Transfers", "Transfer - PIX", "Transfer - Bank Slip", "Transfer - TED"]);
export const CASH = "Same person transfer - CASH";
const MAX_RULES_BYTES = 5 * 1024 * 1024;

export function key(desc) {
  let s = desc.split("|").at(-1);
  s = s.replace(/\s*\d+\/\d+\s*$/, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function keys(desc) {
  const full = key(desc);
  const out = [full];
  const head = full.split("*")[0].trim();
  if (head && head !== full) out.push(head + "*");
  const words = full.replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) out.push("~" + words.slice(0, 2).join(" "));
  return out;
}

export function lookup(desc, map) {
  for (const k of keys(desc)) if (Object.hasOwn(map, k)) return map[k];
  return null;
}

// items: iterable of [description, pluggyCategory]
export function learn(items) {
  const votes = new Map();
  for (const [desc, pluggy] of items) {
    if (!pluggy || GENERIC.has(pluggy) || pluggy === CASH) continue;
    for (const k of keys(desc)) {
      if (!votes.has(k)) votes.set(k, new Map());
      const c = votes.get(k);
      c.set(pluggy, (c.get(pluggy) || 0) + 1);
    }
  }
  const out = {};
  for (const [k, c] of votes) {
    let top = null, n = 0, total = 0;
    for (const [cat, v] of c) {
      total += v;
      if (v > n) { top = cat; n = v; }
    }
    if ((k === key(k) && !k.startsWith("~") && !k.endsWith("*")) || n / total >= 0.8) out[k] = top;
  }
  return out;
}

function genericRules(src, op, upper, pluggy) {
  if (upper.includes("NUVIAGENS")) return "Travel (NuViagens)";
  if (op === "SAQUE" || pluggy === CASH) return "Cash withdrawals";
  if (GENERIC.has(pluggy)) {
    if (op === "PIX" || op === "TED") return "PIX to people";
    if (src === "card") return "Payments (NuPay)";
    return op === "BOLETO" ? "Payments (boletos)" : "Transfers (other)";
  }
  return null;
}

// rules: output of compileRules(). src: "card" | "bank". entity: key of rules.entities.
// User overrides (set on the phone) win over every rule; they are keyed by key(desc), the merchant.
export function categorize({ src, op, desc, pluggy }, rules, learned, entity) {
  const user = rules?.user?.[key(desc)];
  if (user) return user;
  const upper = desc.toUpperCase();
  for (const r of rules?.entityRules[entity] || []) if (r.rx.test(upper)) return r.category;
  for (const r of rules?.descRules || []) if (r.rx.test(upper)) return r.category;
  return (
    genericRules(src, op, upper, pluggy) ||
    lookup(desc, rules?.overrides || {}) ||
    pluggy ||
    lookup(desc, learned || {}) ||
    (op === "PIX" || op === "TED" ? "PIX to people" : "Uncategorized")
  );
}

export function entityOf(bankLabel, rules) {
  for (const [name, e] of Object.entries(rules?.entities || {})) if (e.banks.includes(bankLabel)) return name;
  return null;
}

// Validates an imported file and returns the raw object to keep in the vault (regexes are rebuilt on load).
export function parseRulesFile(text) {
  if (text.length > MAX_RULES_BYTES) throw new Error("Arquivo grande demais para um arquivo de regras.");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Não é um JSON válido."); }
  if (raw?.format !== RULES_FORMAT) throw new Error("Este arquivo não é um export de regras do Cofre.");
  if (raw.v !== RULES_VERSION) throw new Error(`Versão ${raw.v} não suportada (esperado ${RULES_VERSION}).`);
  const isMap = (m) => m && typeof m === "object" && !Array.isArray(m) && Object.values(m).every((v) => typeof v === "string");
  if (!isMap(raw.learned) || !isMap(raw.overrides)) throw new Error("Mapa de categorias inválido.");
  if (raw.projection != null && (typeof raw.projection !== "object" || !Array.isArray(raw.projection.salary))) throw new Error("Premissas da projeção inválidas.");
  if (raw.wealth != null) {
    const ok = Array.isArray(raw.wealth) && raw.wealth.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w?.d) && w.banks && typeof w.banks === "object" && Object.values(w.banks).every(Number.isFinite));
    if (!ok) throw new Error("Histórico de patrimônio inválido.");
  }
  if (raw.renewals != null && !validRenewals(raw.renewals)) throw new Error("Lista de renovações inválida.");
  if (raw.invHistory != null) {
    const ok = Array.isArray(raw.invHistory) && raw.invHistory.every((e) => e?.v === 2 && /^\d{4}-\d{2}-\d{2}$/.test(e.d) && e.p && typeof e.p === "object"
      && Object.values(e.p).every((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && typeof x[3] === "string"));
    if (!ok) throw new Error("Histórico de investimentos inválido.");
  }
  if (raw.history != null) {
    const h = raw.history, ym = /^\d{4}-\d{2}$/, ymd = /^\d{4}-\d{2}-\d{2}$/;
    const ok = h && typeof h.bank === "string" && ym.test(h.until) && Array.isArray(h.rows)
      && h.rows.every((r) => Array.isArray(r) && ym.test(r[0]) && ymd.test(r[1]) && typeof r[2] === "string" && Number.isFinite(r[3]));
    if (!ok) throw new Error("Histórico de faturas inválido.");
  }
  compileRules(raw);
  return raw;
}

export function compileRules(raw, user = {}) {
  const one = (r) => {
    if (typeof r?.pattern !== "string" || typeof r?.category !== "string" || !/^i?$/.test(r.flags ?? "")) throw new Error("Regra inválida.");
    try { return { rx: new RegExp(r.pattern, r.flags || ""), category: r.category }; }
    catch { throw new Error(`Regra com padrão inválido: ${r.category}`); }
  };
  return {
    entities: raw.entities || {},
    entityRules: Object.fromEntries(Object.entries(raw.entity_rules || {}).map(([k, v]) => [k, v.map(one)])),
    descRules: (raw.desc_rules || []).map(one),
    overrides: raw.overrides,
    user: user || {},
    learned: raw.learned,
    exportedAt: raw.exported_at,
  };
}

export function rulesSummary(raw) {
  if (!raw) return null;
  const nRx = Object.values(raw.entity_rules || {}).reduce((a, v) => a + v.length, 0) + (raw.desc_rules || []).length;
  return { learned: Object.keys(raw.learned).length, overrides: Object.keys(raw.overrides).length, regex: nRx, exportedAt: raw.exported_at };
}

export const USER_FORMAT = "cofre-user-overrides";
export function exportUserOverrides(user) {
  return JSON.stringify({ format: USER_FORMAT, v: 1, exported_at: new Date().toISOString(), overrides: user || {} }, null, 1);
}
