import test from "node:test";
import assert from "node:assert/strict";
import { decide, message } from "../watch/decide.mjs";

const today = "2026-11-24"; // a Tuesday
const mat = (due, balance, extra = {}) => ({ due, bank: "xp", issuer: "Emissor A", n: 1, balance, rates: ["110% CDI"], joint: false, tag: null, ...extra });
const base = (alerts, rows = []) => ({ alerts, mat: { rows }, status: [{ name: "XP", ok: true, consent: "2027-11-06" }] });

test("a maturity speaks only on D-7/3/1/0", () => {
  for (const [days, speaks] of [[7, true], [6, false], [3, true], [1, true], [0, true], [12, false]]) {
    const due = new Date(Date.parse(today + "T12:00:00Z") + days * 864e5).toISOString().slice(0, 10);
    const d = decide(base([{ kind: "maturity", issuer: "Emissor A", n: 1, due, days, amount: 20000, cdbMin: 110, scope: "mine" }], [mat(due, 20000)]), { today });
    assert.equal(d.urgent.length, speaks ? 1 : 0, `D-${days}`);
  }
});

test("the maturity carries the ladder's split and the BRB rule", () => {
  const due = "2026-12-01";
  const d = decide(base([{ kind: "maturity", issuer: "BRB", n: 1, due, days: 7, amount: 28000, brb: true, cdbMin: 110, scope: "joint" }], [mat(due, 28000, { issuer: "BRB", tag: "brb" }), mat("2028-06-01", 50000)]), { today });
  assert.match(d.urgent[0], /BRB: não renovar/);
  assert.match(d.urgent[0], /Sugestão da escada: /);
  assert.match(d.urgent[0], /conta conjunta/);
});

test("bills speak on D-3 and D-1 only", () => {
  const d3 = decide(base([{ kind: "bill", bank: "Nubank", due: "2026-11-27", days: 3, amount: 6968 }]), { today });
  const d2 = decide(base([{ kind: "bill", bank: "Nubank", due: "2026-11-26", days: 2, amount: 6968 }]), { today });
  assert.equal(d3.urgent.length, 1);
  assert.equal(d2.urgent.length, 0);
});

test("standing conditions wait for Monday; a quiet Tuesday sends nothing", () => {
  const v = base([{ kind: "idle", bank: "Itaú", amount: 82000, scope: "joint" }]);
  const tue = decide(v, { today });
  assert.equal(tue.weekly.length, 0);
  assert.equal(message(tue, today), null);
  const mon = decide(v, { today: "2026-11-23" });
  assert.equal(mon.weekly.length, 1);
  assert.match(message(mon, "2026-11-23"), /parado na conta · conta conjunta/);
});

test("Monday says so when nothing is pending, and flags broken banks and expiring consents", () => {
  assert.match(message(decide(base([]), { today: "2026-11-23" }), "2026-11-23"), /Semana sem pendências/);
  const v = { alerts: [], mat: { rows: [] }, status: [{ name: "Nubank", ok: false, error: "LOGIN_ERROR" }, { name: "Wise", ok: true, consent: "2026-12-10" }] };
  const w = decide(v, { today: "2026-11-23" }).weekly.join("\n");
  assert.match(w, /Nubank: sincronização falhou \(LOGIN_ERROR\)/);
  assert.match(w, /Wise: consentimento expira 10\/12/);
});

test("names are HTML-escaped for Telegram", () => {
  const d = decide(base([{ kind: "bill", bank: "A&B <x>", due: "2026-11-27", days: 3, amount: 1 }]), { today });
  assert.match(d.urgent[0], /A&amp;B &lt;x&gt;/);
});
