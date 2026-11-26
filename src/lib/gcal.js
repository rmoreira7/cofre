// The Cofre calendar in Google Agenda, straight from the phone. Scope calendar.app.created: the app can only see the
// calendar it creates ("Cofre") and its events, nothing else in the account. Every event carries a private `cofre`
// tag and an id derived from a stable UID, so a re-sync updates instead of duplicating. Maturities are Tangerina,
// card bills Tomate, renewals Uva; the 31/12 reminder (open the app so the year-end balances are kept) Grafite.
import { maturityEvent } from "./ics.js";
import { upcomingRenewals, nextMonthly } from "./decisions.js";

export const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const COLORS = { maturity: "6", bill: "11", renewal: "3", yearend: "8" };
export const TANGERINA_ID = COLORS.maturity;
const API = "https://www.googleapis.com/calendar/v3";
// All-day events start at 00:00: days × 1440 − 540 minutes before = 09:00, that many days earlier.
export const remindAt = (days) => days * 1440 - 9 * 60;
const next = (iso) => new Date(Date.parse(iso + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Google event ids allow [a-v0-9]; a SHA-256 in hex fits and is stable per UID.
export async function eventId(uid) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gEvent({ uid, date, summary, description = "", kind, days }) {
  return {
    id: await eventId(uid),
    summary,
    description,
    start: { date },
    end: { date: next(date) },
    colorId: COLORS[kind],
    transparency: "transparent",
    status: "confirmed",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: remindAt(days) }] },
    extendedProperties: { private: { cofre: "1", kind } },
  };
}

export async function toGoogle(r, opts) {
  const e = maturityEvent(r, opts);
  return gEvent({ uid: e.uid, date: e.date, summary: e.summary, description: e.description, kind: "maturity", days: 7 });
}

// Everything the calendar should hold from today on: maturities (7 days' notice), the open card bills (3 days, like the
// watcher), monthly bills (5 days, when they are usually paid), renewals within a year (7 days) and this year's 31/12
// (the day before).
export async function calendarEvents({ mat = [], cards = [], renewals = [], monthly = [], today, bankName = (b) => b, money = (n) => n.toFixed(2) }) {
  const out = [];
  for (const r of mat) if (r.due >= today) out.push(await toGoogle(r, { bankName, money }));
  for (const c of cards) {
    if (!c.due || c.due < today || !(c.bill > 0)) continue;
    out.push(await gEvent({ uid: `cofre-bill-${slug(c.bank)}-${c.due.slice(0, 7)}@cofre`, date: c.due, kind: "bill", days: 3,
      summary: `Fatura ${c.name}`, description: `${money(c.bill)}${c.exact ? "" : " (fatura aberta, pode mudar)"}` }));
  }
  for (const r of upcomingRenewals(renewals, today, 365)) {
    out.push(await gEvent({ uid: `cofre-ren-${slug(r.name)}-${r.date}@cofre`, date: r.date, kind: "renewal", days: 7,
      summary: `Renova: ${r.name}`, description: [r.amount != null && money(r.amount), r.note].filter(Boolean).join(" · ") }));
  }
  for (const m of nextMonthly(monthly, today)) {
    if (m.due < today) continue;
    out.push(await gEvent({ uid: `cofre-mon-${slug(m.name)}-${m.due.slice(0, 7)}@cofre`, date: m.due, kind: "bill", days: 5,
      summary: `Pagar ${m.name}`, description: [m.amount != null && `~${money(m.amount)}`, m.note].filter(Boolean).join(" · ") }));
  }
  const ye = `${today.slice(0, 4)}-12-31`;
  out.push(await gEvent({ uid: `cofre-yearend-${ye.slice(0, 4)}@cofre`, date: ye, kind: "yearend", days: 1,
    summary: "Cofre: atualizar para guardar os saldos do ano",
    description: `Abra o Cofre e toque em atualizar: os saldos de 31/12 ficam guardados para o IR ${Number(ye.slice(0, 4)) + 1}.` }));
  return out;
}

const same = (a, b) => a.summary === b.summary && (a.description || "") === b.description && a.start?.date === b.start.date
  && a.colorId === b.colorId && a.status !== "cancelled" && a.reminders?.overrides?.[0]?.minutes === b.reminders.overrides[0].minutes;

function client(token, fetchFn) {
  return async (method, path, body) => {
    const res = await fetchFn(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Google Agenda: HTTP ${res.status}`), { status: res.status });
    return json;
  };
}

// want = calendarEvents(…). Returns the counts and the calendar id to keep for next time.
export async function syncCalendar(want, { token, calId = null, today, fetchFn = fetch, name = "Cofre" }) {
  const api = client(token, fetchFn);
  let created = false;
  if (calId) {
    try { await api("GET", `/calendars/${encodeURIComponent(calId)}`); } catch (e) { if (e.status === 404 || e.status === 403) calId = null; else throw e; }
  }
  if (!calId) {
    calId = (await api("POST", "/calendars", { summary: name, description: "Vencimentos, faturas e renovações do Cofre", timeZone: "America/Sao_Paulo" })).id;
    created = true;
  }
  if (created) {
    // Best effort: the calendar's own color in the sidebar; each event carries its own color either way.
    await api("PATCH", `/users/me/calendarList/${encodeURIComponent(calId)}?colorRgbFormat=true`, { backgroundColor: "#F4511E", foregroundColor: "#ffffff" }).catch(() => {});
  }
  const cal = `/calendars/${encodeURIComponent(calId)}/events`;
  const have = new Map();
  let page = "";
  do {
    const r = await api("GET", `${cal}?privateExtendedProperty=${encodeURIComponent("cofre=1")}&maxResults=2500&showDeleted=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    for (const e of r.items || []) have.set(e.id, e);
    page = r.nextPageToken || "";
  } while (page);

  const n = { added: 0, updated: 0, kept: 0, removed: 0 };
  for (const ev of want) {
    const old = have.get(ev.id);
    if (!old) {
      try { await api("POST", cal, ev); n.added++; } catch (e) { if (e.status !== 409) throw e; await api("PUT", `${cal}/${ev.id}`, ev); n.updated++; }
    } else if (same(old, ev)) n.kept++;
    else { await api("PUT", `${cal}/${ev.id}`, ev); n.updated++; }
  }
  // Gone (redeemed, renewed into another date, bill paid and closed, renewal dropped): drop the future ones; past
  // events stay as history.
  const ids = new Set(want.map((e) => e.id));
  for (const [id, e] of have) {
    if (ids.has(id) || e.status === "cancelled" || (e.start?.date || "") < today) continue;
    await api("DELETE", `${cal}/${id}`); n.removed++;
  }
  return { calId, ...n };
}
