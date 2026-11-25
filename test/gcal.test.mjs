import { test } from "node:test";
import assert from "node:assert/strict";
import { syncMaturities, eventId, toGoogle, TANGERINA_ID } from "../src/lib/gcal.js";

const rows = [
  { due: "2027-02-10", bank: "xp", issuer: "Banco Teste", n: 2, balance: 1000, rates: ["110% CDI"] },
  { due: "2027-04-05", bank: "bank2", issuer: "Outro Banco", n: 1, balance: 500, rates: ["116% CDI"], joint: true },
];

// A fake Calendar API: one calendar store, records every call.
function fakeGoogle({ calendars = {}, conflictIds = [] } = {}) {
  const calls = [];
  let seq = 0;
  const json = (status, body) => ({ status, ok: status < 400, json: async () => body });
  const fetchFn = async (url, { method, body, headers }) => {
    assert.equal(headers.Authorization, "Bearer tok");
    const u = new URL(url), p = decodeURIComponent(u.pathname.replace("/calendar/v3", ""));
    const b = body ? JSON.parse(body) : null;
    calls.push(`${method} ${p}`);
    let m;
    if (method === "POST" && p === "/calendars") { const id = `cal${++seq}`; calendars[id] = {}; return json(200, { id }); }
    if (method === "PATCH" && p.startsWith("/users/me/calendarList/")) return json(200, {});
    if ((m = p.match(/^\/calendars\/([^/]+)$/))) return calendars[m[1]] ? json(200, { id: m[1] }) : json(404, { error: { message: "Not Found" } });
    if ((m = p.match(/^\/calendars\/([^/]+)\/events$/))) {
      const evs = calendars[m[1]];
      if (method === "GET") { assert.equal(u.searchParams.get("privateExtendedProperty"), "cofre=1"); return json(200, { items: Object.values(evs) }); }
      if (conflictIds.includes(b.id)) return json(409, { error: { message: "duplicate" } });
      evs[b.id] = b; return json(200, b);
    }
    if ((m = p.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      if (method === "PUT") { calendars[m[1]][m[2]] = JSON.parse(body); return json(200, {}); }
      if (method === "DELETE") { delete calendars[m[1]][m[2]]; return { status: 204, ok: true, json: async () => null }; }
    }
    throw new Error("unexpected " + method + " " + p);
  };
  return { fetchFn, calls, calendars };
}

const base = { token: "tok", today: "2026-11-25", bankName: (b) => b.toUpperCase(), money: (n) => `R$ ${n}` };

test("first sync creates the Cofre calendar and Tangerina all-day events with a 09:00 reminder a week before", async () => {
  const g = fakeGoogle();
  const r = await syncMaturities(rows, { ...base, fetchFn: g.fetchFn });
  assert.deepEqual({ ...r, calId: undefined }, { calId: undefined, added: 2, updated: 0, kept: 0, removed: 0 });
  const evs = Object.values(g.calendars[r.calId]);
  assert.equal(evs.length, 2);
  for (const e of evs) {
    assert.equal(e.colorId, TANGERINA_ID);
    assert.equal(e.reminders.overrides[0].minutes, 7 * 1440 - 540);
    assert.match(e.id, /^[0-9a-f]{64}$/);
  }
  const a = evs.find((e) => e.start.date === "2027-02-10");
  assert.equal(a.end.date, "2027-02-11");
  assert.equal(a.summary, "Vence: Banco Teste ×2 · XP");
  assert.ok(evs.some((e) => e.summary.includes("(conta conjunta)")));
});

test("a re-sync keeps unchanged events, updates changed ones, drops future ones that left, keeps the past", async () => {
  const g = fakeGoogle();
  const { calId } = await syncMaturities(rows, { ...base, fetchFn: g.fetchFn });
  const past = { ...(await toGoogle({ due: "2026-10-01", bank: "xp", issuer: "Velho", n: 1, balance: 1, rates: [] }, base)) };
  g.calendars[calId][past.id] = past;
  const changed = [{ ...rows[0], balance: 2000 }];
  const r = await syncMaturities(changed, { ...base, calId, fetchFn: g.fetchFn });
  assert.deepEqual({ added: r.added, updated: r.updated, kept: r.kept, removed: r.removed }, { added: 0, updated: 1, kept: 0, removed: 1 });
  assert.ok(g.calendars[calId][past.id], "past event stays");
  const again = await syncMaturities(changed, { ...base, calId, fetchFn: g.fetchFn });
  assert.equal(again.kept, 1);
  assert.ok(!g.calls.slice(-3).some((c) => c.startsWith("POST /calendars ")), "no new calendar");
});

test("a deleted calendar is recreated; an id taken by a cancelled event is updated instead", async () => {
  const id0 = await eventId((await import("../src/lib/ics.js")).maturityEvent(rows[0]).uid);
  const g = fakeGoogle({ conflictIds: [id0] });
  const r = await syncMaturities(rows, { ...base, calId: "gone", fetchFn: g.fetchFn });
  assert.notEqual(r.calId, "gone");
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
});
