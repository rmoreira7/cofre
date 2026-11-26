// The contas do mês and the renewals, owned by the phone once edited there (Ajustes › Contas). Until then they come
// from the rules file. The phone's copy travels to the watcher inside phone.enc, so neither the laptop file nor an
// Actions secret has to change when a bill does.
import { validMonthly, validRenewals } from "./decisions.js";

// → { monthly, renewals, own } (own = edited on the phone).
export function listsOf(data) {
  const l = data?.lists;
  if (l) return { monthly: l.monthly || [], renewals: l.renewals || [], own: true };
  return { monthly: data?.rules?.monthly || [], renewals: data?.rules?.renewals || [], own: false };
}

// One list replaced (kind "monthly" | "renewals"), the other kept as it is now. Throws on an invalid list.
export function withList(data, kind, list, ts = Date.now()) {
  const cur = listsOf(data);
  const next = { monthly: cur.monthly, renewals: cur.renewals, [kind]: list, ts };
  if (!validMonthly(next.monthly)) throw new Error("Conta do mês inválida.");
  if (!validRenewals(next.renewals)) throw new Error("Renovação inválida.");
  return { ...data, lists: next };
}

// The form → an entry. Empty optional fields are left out; amounts in pt-BR ("69,50") accepted.
const num = (s) => { const t = String(s ?? "").trim().replace(/\./g, "").replace(",", "."); return t === "" ? null : Number(t); };
export function monthlyFrom(f) {
  const m = { name: String(f.name || "").trim() };
  if (f.mode === "every") m.every = Number(f.every); else m.day = Number(f.day);
  const amount = num(f.amount); if (amount != null) m.amount = amount;
  const match = String(f.match || "").split(";").map((x) => x.trim()).filter(Boolean); if (match.length) m.match = match;
  if (f.card) m.card = true;
  const note = String(f.note || "").trim(); if (note) m.note = note;
  return m;
}
export function renewalFrom(f) {
  const r = { name: String(f.name || "").trim(), date: String(f.date || "") };
  const amount = num(f.amount); if (amount != null) r.amount = amount;
  if (f.every === "month" || f.every === "year") r.every = f.every;
  const note = String(f.note || "").trim(); if (note) r.note = note;
  return r;
}
