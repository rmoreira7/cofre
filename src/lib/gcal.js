// Maturities → Google Calendar, straight from the phone. Scope calendar.app.created: the app can only see the
// calendar it creates ("Cofre") and its events, nothing else in the account. Each event carries colorId 6
// (Tangerina) and a private `cofre` tag; ids derive from the .ics UID, so a re-sync updates instead of duplicating.
import { maturityEvent } from "./ics.js";

export const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const TANGERINA_ID = "6";
const API = "https://www.googleapis.com/calendar/v3";
// All-day events start at 00:00: 9540 min before = 09:00, seven days earlier.
const REMIND_MIN = 7 * 1440 - 9 * 60;

// Google event ids allow [a-v0-9]; a SHA-256 in hex fits and is stable per UID.
export async function eventId(uid) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function toGoogle(r, opts) {
  const e = maturityEvent(r, opts);
  return {
    id: await eventId(e.uid),
    summary: e.summary,
    description: e.description,
    start: { date: e.date },
    end: { date: e.end },
    colorId: TANGERINA_ID,
    transparency: "transparent",
    status: "confirmed",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: REMIND_MIN }] },
    extendedProperties: { private: { cofre: "1" } },
  };
}

const same = (a, b) => a.summary === b.summary && a.description === b.description && a.start?.date === b.start.date
  && a.colorId === b.colorId && a.status !== "cancelled" && a.reminders?.overrides?.[0]?.minutes === REMIND_MIN;

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

// rows = the maturity groups (days >= 0). Returns the counts and the calendar id to keep for next time.
export async function syncMaturities(rows, { token, calId = null, today, bankName, money, fetchFn = fetch, name = "Cofre" }) {
  const api = client(token, fetchFn);
  let created = false;
  if (calId) {
    try { await api("GET", `/calendars/${encodeURIComponent(calId)}`); } catch (e) { if (e.status === 404 || e.status === 403) calId = null; else throw e; }
  }
  if (!calId) {
    calId = (await api("POST", "/calendars", { summary: name, description: "Vencimentos do Cofre", timeZone: "America/Sao_Paulo" })).id;
    created = true;
  }
  if (created) {
    // Best effort: the calendar's own color in the sidebar; the events are Tangerina either way.
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

  const want = await Promise.all(rows.map((r) => toGoogle(r, { bankName, money })));
  const n = { added: 0, updated: 0, kept: 0, removed: 0 };
  for (const ev of want) {
    const old = have.get(ev.id);
    if (!old) {
      try { await api("POST", cal, ev); n.added++; } catch (e) { if (e.status !== 409) throw e; await api("PUT", `${cal}/${ev.id}`, ev); n.updated++; }
    } else if (same(old, ev)) n.kept++;
    else { await api("PUT", `${cal}/${ev.id}`, ev); n.updated++; }
  }
  // Gone from the ladder (redeemed, renewed into another date): drop the future ones; past events stay as history.
  const ids = new Set(want.map((e) => e.id));
  for (const [id, e] of have) {
    if (ids.has(id) || e.status === "cancelled" || (e.start?.date || "") < today) continue;
    await api("DELETE", `${cal}/${id}`); n.removed++;
  }
  return { calId, ...n };
}
