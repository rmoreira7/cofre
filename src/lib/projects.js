// Projects (a trip): its card purchases, picked by merchant text and purchase day, from the rules file's `projects`:
// [{ id, name, start?, end?, items: [{ match, on: "YYYY-MM-DD" }], extras?: [{ name, amount, currency?, due? }] }].
// The full cost, in the bills it falls on: already billed (closed bills), on the open bill (this cycle), and the
// installments still to come; plus what is paid outside the card (at the hotel). It counts inside the cycle target
// like any other spending; this only shows it whole.
import { entityOf } from "./categorize.js";

const ymd = /^\d{4}-\d{2}-\d{2}$/;
export function validProjects(list) {
  return Array.isArray(list) && list.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim()
    && (p.start == null || ymd.test(p.start)) && (p.end == null || ymd.test(p.end))
    && Array.isArray(p.items) && p.items.length > 0 && p.items.every((i) => typeof i?.match === "string" && i.match.trim() && ymd.test(i.on || ""))
    && (p.extras == null || (Array.isArray(p.extras) && p.extras.every((e) => typeof e?.name === "string" && Number.isFinite(e.amount) && (e.currency == null || /^[A-Z]{3}$/.test(e.currency)) && (e.due == null || ymd.test(e.due))))));
}

export const SHOW_AFTER_END = 30; // days the card stays after the trip ends

// cards: cards() (each card's open bill month = its due month). fx: { USD: 5.5, … }.
export function projectsView(snapshot, rules, entity, cards, today, fx = {}) {
  const out = [];
  for (const p of rules?.projects || []) {
    if (p.end && addDays(p.end, SHOW_AFTER_END) < today) continue;
    const items = p.items.map((i) => ({ match: i.match.toLowerCase(), on: i.on }));
    let billed = 0, open = 0, ahead = 0, lastAhead = null;
    const buys = new Map();
    for (const it of snapshot.items) {
      if (it.error || entityOf(it.label, rules) !== entity) continue;
      const openMonth = cards.find((c) => c.bank === it.label)?.due?.slice(0, 7) || today.slice(0, 7);
      for (const a of it.accounts) {
        if (a.type !== "CREDIT") continue;
        for (const t of a.transactions || []) {
          if (!(t.amount > 0)) continue;
          const bought = (t.card?.purchaseDate || t.date).slice(0, 10), desc = String(t.description || "").toLowerCase();
          if (!items.some((i) => i.on === bought && desc.includes(i.match))) continue;
          const f = (t.card?.billForecastDate || t.date).slice(0, 7);
          if (f < openMonth) billed += t.amount;
          else if (f === openMonth) open += t.amount;
          else { ahead += t.amount; if (!lastAhead || f > lastAhead) lastAhead = f; }
          const k = `${desc.split("|").at(-1).replace(/\s*\d+\/\d+\s*$/, "").replace(/\s*-\s*nupay\s*$/, "").trim()}|${bought}`;
          const b = buys.get(k) || { name: String(t.description).split("|").at(-1).replace(/\s*\d+\/\d+\s*$/, "").replace(/\s*-\s*NuPay\s*$/i, "").trim(), bought, amount: 0, n: t.card?.totalInstallments || 1 };
          b.amount += t.amount; buys.set(k, b);
        }
      }
    }
    const extras = (p.extras || []).map((e) => {
      const cur = e.currency || "BRL";
      return { ...e, currency: cur, brl: cur === "BRL" ? e.amount : fx[cur] ? e.amount * fx[cur] : null };
    });
    const card = billed + open + ahead;
    const outside = extras.reduce((s, e) => s + (e.brl || 0), 0);
    out.push({
      id: p.id, name: p.name, start: p.start || null, end: p.end || null,
      card, billed, open, ahead, lastAhead, extras, outside, total: card + outside,
      buys: [...buys.values()].sort((x, y) => y.amount - x.amount),
    });
  }
  return out;
}

const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
