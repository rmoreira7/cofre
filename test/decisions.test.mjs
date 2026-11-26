import test from "node:test";
import assert from "node:assert/strict";
import { validRenewals, upcomingRenewals, idleCost } from "../src/lib/decisions.js";

test("renewals: validated, filtered to the window ahead, nearest first", () => {
  const list = [{ name: "A", date: "2027-01-10" }, { name: "B", date: "2026-12-01", amount: 9.9 }, { name: "C", date: "2026-11-01" }];
  assert.ok(validRenewals(list));
  assert.ok(!validRenewals([{ name: "A", date: "10/01/2027" }]));
  assert.deepEqual(upcomingRenewals(list, "2026-11-24", 60).map((r) => [r.name, r.days]), [["B", 7], ["A", 47]]);
});

test("idle cost: amount × CDI per business day, null without the CDI", () => {
  assert.equal(idleCost(10000, 0.05), 5);
  assert.equal(idleCost(10000, null), null);
});

import { candidates, upcoming, decide, undo, outcome, board } from "../src/lib/decisions.js";

const today = "2026-11-24";
const v = {
  cards: [{ bank: "card_a", name: "Cartão A", bill: 700, due: "2026-12-03", exact: true, early: 200, charges: 900 }, { bank: "card_b", name: "Cartão B", bill: 50, due: "2026-12-20" }],
  mat: { rows: [{ bank: "bank_x", issuer: "Emissor A", n: 1, balance: 2000, due: "2026-12-08", days: 14, joint: false, tag: null }, { bank: "bank_x", issuer: "Emissor B", n: 2, balance: 900, due: "2027-02-10", days: 78, joint: true }] },
  wealth: { banks: [{ label: "bank_j", name: "Banco J", checking: 9000, joint: true }, { label: "bank_x", name: "Banco X", checking: 100 }] },
  guarantee: { issuers: [] },
};
const lad = { now: [{ label: "≤6m", max: 6 }, { label: "6–12m", max: 12 }, { label: "12–18m", max: 18 }, { label: "18–24m", max: 24 }], plan: [{ due: "2026-12-08", buys: [{ months: 24, amount: 2000 }] }] };
const renewals = [{ name: "Plano X", date: "2026-12-10" }, { name: "Plano Y", date: "2027-07-30" }];

test("candidates: bills within 10 days, maturities within 30, idle above the reserve, renewals within 30; nearest first", () => {
  const c = candidates(v, { lad, renewals, today, cdiDaily: 0.05 });
  assert.deepEqual(c.map((d) => d.id), ["idle:bank_j", "bill:card_a:2026-12-03", "mat:bank_x:Emissor A:2026-12-08", "ren:Plano X:2026-12-10"]);
  const m = c.find((d) => d.kind === "maturity");
  assert.deepEqual(m.suggestion, [{ amount: 2000, term: "2 anos", rung: "18–24m" }]);
  assert.equal(m.cost, 1);
  assert.equal(c.find((d) => d.kind === "idle").amount, 4000);
});

test("upcoming: maturities past 30 days (to 90) and renewals within a year, with the day each opens", () => {
  const u = upcoming(v, { renewals, today });
  assert.deepEqual(u.map((x) => [x.title, x.opens]), [["Emissor B ×2 vence", "2027-01-11"], ["Plano Y renova", "2027-06-30"]]);
});

test("decide / undo: a snooze comes back after 7 days or at the deadline, whichever first", () => {
  const c = candidates(v, { lad, renewals, today });
  const bill = c.find((d) => d.kind === "bill");
  let r = decide({}, bill, "snoozed", { today });
  assert.equal(r[bill.id].until, "2026-12-01");
  r = decide(r, c.find((d) => d.kind === "renewal"), "snoozed", { today: "2026-12-08" });
  assert.equal(r["ren:Plano X:2026-12-10"].until, "2026-12-10");
  assert.deepEqual(Object.keys(undo(r, bill.id)), ["ren:Plano X:2026-12-10"]);
});

const snap = (inv = [], checking = 100, payments = []) => ({ items: [
  { label: "bank_x", investments: inv, accounts: [{ type: "BANK", balance: checking }] },
  { label: "bank_j", investments: [], accounts: [{ type: "BANK", balance: checking }] },
  { label: "card_a", investments: [], accounts: [{ type: "CREDIT", transactions: payments }] },
] });

test("outcome: a maturity is confirmed by new positions at the same bank around its date, with their rate", () => {
  const d = candidates(v, { lad, today }).find((x) => x.kind === "maturity");
  const rec = decide({}, d, "done", { today: "2026-12-08" })[d.id];
  assert.equal(outcome(rec, snap(), { today: "2026-12-09" }).state, "wait");
  assert.equal(outcome(rec, snap(), { today: "2026-12-19" }).state, "no");
  const ok = outcome(rec, snap([{ purchaseDate: "2026-12-09", amountOriginal: 1000, rateType: "CDI", rate: 110 }, { purchaseDate: "2026-12-10", amountOriginal: 1000, rateType: "CDI", rate: 114 }]), { today: "2026-12-11" });
  assert.equal(ok.state, "ok");
  assert.equal(ok.cdi, 112);
});

test("outcome: idle money is confirmed when the account drops near the reserve; a bill when the payment shows", () => {
  const c = candidates(v, { lad, today });
  const idle = decide({}, c.find((x) => x.kind === "idle"), "done", { today })["idle:bank_j"];
  assert.equal(outcome(idle, snap([], 9000), { today: "2026-11-26" }).state, "wait");
  assert.equal(outcome(idle, snap([], 9000), { today: "2026-12-05" }).state, "no");
  assert.equal(outcome(idle, snap([], 5500), { today: "2026-11-26" }).state, "ok");
  const bill = decide({}, c.find((x) => x.kind === "bill"), "done", { today: "2026-12-02" })["bill:card_a:2026-12-03"];
  assert.equal(outcome(bill, snap(), { today: "2026-12-03" }).state, "wait");
  assert.equal(outcome(bill, snap([], 100, [{ operationType: "PAGAMENTO_FATURA", date: "2026-12-02T10:00:00Z", amount: -700 }]), { today: "2026-12-03" }).state, "ok");
});

test("board: decided leaves open, a failed check brings it back, a snooze returns on its date", () => {
  const c = candidates(v, { lad, renewals, today });
  let r = decide({}, c.find((x) => x.kind === "idle"), "done", { today });
  r = decide(r, c.find((x) => x.kind === "bill"), "snoozed", { today });
  let b = board(c, r, snap([], 9000), { today });
  assert.ok(!b.open.some((d) => d.kind === "idle"));
  assert.equal(b.snoozed.length, 1);
  assert.equal(b.decided[0].outcome.state, "wait");
  b = board(c, r, snap([], 9000), { today: "2026-12-02" });
  assert.ok(b.open.some((d) => d.kind === "idle" && d.failed));
  assert.ok(b.open.some((d) => d.kind === "bill"));
});

import { validMonthly, monthlyDue, monthlyPayment } from "../src/lib/decisions.js";

const monthly = [{ name: "Conta A", day: 10, amount: 200, match: ["Pgt*Conta A"] }, { name: "Conta B", day: 31, amount: 70 }];
const charged = (date, description, amount = 200) => ({ items: [{ label: "card_a", accounts: [{ type: "CREDIT", transactions: [{ date: `${date}T12:00:00Z`, description, amount }] }] }] });

test("monthly bills: validated; due this month until 3 days past it, then next month; short months clamp", () => {
  assert.ok(validMonthly(monthly));
  assert.ok(!validMonthly([{ name: "X", day: 0 }]));
  assert.ok(!validMonthly([{ name: "X", day: 10, match: "texto" }]));
  assert.equal(monthlyDue(monthly[0], "2026-12-01"), "2026-12-10");
  assert.equal(monthlyDue(monthly[0], "2026-12-13"), "2026-12-10");
  assert.equal(monthlyDue(monthly[0], "2026-12-14"), "2027-01-10");
  assert.equal(monthlyDue(monthly[1], "2027-02-05"), "2027-02-28");
});

test("monthly bills open 10 days ahead, close themselves when the matching charge shows up, and are checked", () => {
  const open = candidates(v, { lad, monthly, snapshot: { items: [] }, today: "2026-12-02" }).filter((d) => d.kind === "monthly");
  assert.deepEqual(open.map((d) => [d.id, d.days, d.amount]), [["mon:Conta A:2026-12", 8, 200]]);
  const paid = charged("2026-12-05", "Net PGT*CONTA A");
  assert.ok(!candidates(v, { lad, monthly, snapshot: paid, today: "2026-12-06" }).some((d) => d.id === "mon:Conta A:2026-12"), "paid → no decision");
  assert.equal(monthlyPayment(charged("2026-11-10", "Pgt*Conta A"), monthly[0], "2026-12-10"), null, "last month's charge does not count");
  const rec = decide({}, open[0], "done", { today: "2026-12-02" })[open[0].id];
  assert.equal(outcome(rec, paid, { today: "2026-12-06" }).state, "ok");
  assert.equal(outcome(rec, { items: [] }, { today: "2026-12-11" }).state, "wait");
  assert.equal(outcome(rec, { items: [] }, { today: "2026-12-14" }).state, "no");
  const noMatch = decide({}, { id: "mon:Conta B:2026-12", kind: "monthly", due: "2026-12-31", match: [] }, "done", { today: "2026-12-25" });
  assert.equal(outcome(noMatch["mon:Conta B:2026-12"], { items: [] }, { today: "2027-01-10" }).state, "manual");
});

import { nextMonthly, toMonday } from "../src/lib/decisions.js";

test("rolling bills: due `every` days after the last payment, a Friday to Sunday moved to Monday; paying moves it on", () => {
  const plan = { name: "Aulas", every: 30, match: ["Prof X"] };
  assert.ok(validMonthly([plan]));
  assert.ok(!validMonthly([{ name: "Aulas", every: 30 }]), "rolling needs a match");
  assert.equal(toMonday("2026-12-05"), "2026-12-07");
  assert.equal(toMonday("2026-12-06"), "2026-12-07");
  assert.equal(toMonday("2026-12-04"), "2026-12-07", "Friday too");
  assert.equal(toMonday("2026-12-03"), "2026-12-03");
  const pix = (...ds) => ({ items: [{ label: "bank_x", accounts: [{ type: "BANK", transactions: ds.map(([d, a]) => ({ date: `${d}T10:00:00Z`, description: "Pix enviado|prof x", amount: -a })) }] }] });
  assert.deepEqual(nextMonthly([plan], "2026-11-26", { items: [] }), [], "no payment seen yet → nothing");
  const s1 = pix(["2026-10-05", 160], ["2026-11-04", 190]);
  const [m] = nextMonthly([plan], "2026-11-26", s1);
  assert.deepEqual([m.due, m.amount, m.days], ["2026-12-07", 190, 11], "04/11 + 30 = Fri 04/12 → Mon 07/12");
  assert.equal(nextMonthly([plan], "2026-11-26", pix(["2026-11-06", 190]))[0].due, "2026-12-07", "06/11 + 30 = Sat 06/12 → Mon");
  const open = candidates(v, { lad, monthly: [plan], snapshot: s1, today: "2026-11-28" }).find((d) => d.kind === "monthly");
  assert.equal(open.id, "mon:Aulas:2026-12");
  const s2 = pix(["2026-11-04", 190], ["2026-12-02", 210]);
  assert.ok(!candidates(v, { lad, monthly: [plan], snapshot: s2, today: "2026-12-03" }).some((d) => d.kind === "monthly"), "paid → the next one is 30 days out");
  const rec = decide({}, open, "done", { today: "2026-12-01" })[open.id];
  assert.equal(outcome(rec, s2, { today: "2026-12-03" }).state, "ok");
});
