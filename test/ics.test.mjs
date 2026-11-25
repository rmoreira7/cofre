import { test } from "node:test";
import assert from "node:assert/strict";
import { maturitiesIcs } from "../src/lib/ics.js";

test("one all-day event per maturity, 7-day reminder, stable UID, folded CRLF lines", () => {
  const rows = [
    { due: "2027-02-10", bank: "xp", issuer: "Banco Ação; Teste, S.A.", n: 2, balance: 1234.5, rates: ["110% CDI"], tag: null },
    { due: "2027-03-03", bank: "bank2", issuer: "BRB", n: 1, balance: 10, rates: ["120% CDI"], tag: "brb", joint: true },
  ];
  const a = maturitiesIcs(rows, { bankName: (b) => b.toUpperCase(), now: new Date("2026-11-23T12:00:00Z") });
  const b = maturitiesIcs(rows, { bankName: (b) => b.toUpperCase(), now: new Date("2026-12-01T12:00:00Z") });
  assert.ok(a.startsWith("BEGIN:VCALENDAR\r\n") && a.endsWith("END:VCALENDAR\r\n"));
  assert.equal(a.match(/BEGIN:VEVENT/g).length, 2);
  assert.ok(a.includes("DTSTART;VALUE=DATE:20270210\r\nDTEND;VALUE=DATE:20270211"));
  assert.equal(a.match(/TRIGGER:-P7D/g).length, 2);
  assert.ok(a.replace(/\r\n /g, "").includes(String.raw`Banco Ação\; Teste\, S.A. ×2`));
  assert.ok(a.replace(/\r\n /g, "").includes("BANK2 (conta conjunta)"));
  assert.ok(a.replace(/\r\n /g, "").includes("Não renovar no BRB."));
  const uids = (s) => s.match(/UID:[^\r]+/g);
  assert.deepEqual(uids(a), uids(b));
  assert.equal(a.match(/COLOR:orangered/g).length, 3);
  assert.ok(a.includes("X-APPLE-CALENDAR-COLOR:#F4511E"));
  for (const line of a.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});
