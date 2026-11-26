import { test } from "node:test";
import assert from "node:assert/strict";
import { listsOf, withList, monthlyFrom, renewalFrom } from "../src/lib/lists.js";
import { agenda, agendaTotals, lowPoint, cashOf } from "../src/lib/agenda.js";

const rules = { monthly: [{ name: "Do arquivo", day: 5 }], renewals: [{ name: "R", date: "2027-01-01" }] };

test("the lists come from the rules file until edited on the phone; then the phone's win", () => {
  assert.deepEqual(listsOf({ rules }), { ...rules, own: false });
  const d = withList({ rules }, "monthly", [{ name: "Do app", every: 30, match: ["x"] }], 1);
  assert.deepEqual(listsOf(d), { monthly: [{ name: "Do app", every: 30, match: ["x"] }], renewals: rules.renewals, own: true });
  assert.throws(() => withList({ rules }, "monthly", [{ name: "", day: 5 }]), /inválida/);
  assert.throws(() => withList({ rules }, "renewals", [{ name: "X", date: "01/01/2027" }]), /inválida/);
});

test("form → entry: pt-BR amounts, matches split by ;, empty fields left out", () => {
  assert.deepEqual(monthlyFrom({ name: " Internet ", mode: "day", day: "10", amount: "1.202,50", match: "Pgt*A; Pgt*B ;", card: true, note: "" }),
    { name: "Internet", day: 10, amount: 1202.5, match: ["Pgt*A", "Pgt*B"], card: true });
  assert.deepEqual(monthlyFrom({ name: "Aula", mode: "every", every: "30", amount: "", match: "Prof" }), { name: "Aula", every: 30, match: ["Prof"] });
  assert.deepEqual(renewalFrom({ name: "Plano", date: "2027-08-24", amount: "259,90", every: "month", note: "trocar" }), { name: "Plano", date: "2027-08-24", amount: 259.9, every: "month", note: "trocar" });
});

test("expected balance: unpaid bills and contas from the account go out, salary comes in; card contas move nothing", () => {
  const today = "2026-11-26";
  const list = agenda({
    cards: [{ bank: "nubank", name: "Nubank", due: "2026-12-03", bill: 1500 }],
    mat: { rows: [] },
    salary: [{ date: "2026-12-05", amount: 3000 }],
    monthly: [{ name: "No cartão", day: 10, amount: 70, card: true }, { name: "Da conta", day: 12, amount: 200 }],
    cash: { checking: 1000, reserve: 9000 }, today, days: 30,
  });
  assert.deepEqual(list.filter((e) => e.balance != null).map((e) => [e.date, e.balance]), [["2026-12-03", -500], ["2026-12-05", 2500], ["2026-12-12", 2300]]);
  assert.deepEqual(lowPoint(list), { balance: -500, date: "2026-12-03" });
  assert.deepEqual(agendaTotals(list), { out: 1700, in: 3000 });
  assert.deepEqual(cashOf({ banks: [{ checking: 10, reserved: [{ balance: 5 }] }, { checking: 99, joint: true }] }), { checking: 10, reserve: 5 });
});
