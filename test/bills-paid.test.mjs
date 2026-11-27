import test from "node:test";
import assert from "node:assert/strict";
import { alignInstallments } from "../src/lib/cardtx.js";
import { cards, billMonths, paidSince, isCardPayment } from "../src/lib/model.js";
import { spendRows } from "../src/lib/spend.js";
import { compileRules } from "../src/lib/categorize.js";
import { candidates } from "../src/lib/decisions.js";

const inst = (id, date, f, n, of, amount, desc = "Loja Viagem", bought = "2026-11-26") => ({ id, date: `${date}T12:00:00Z`, amount, description: desc, creditCardMetadata: { billForecastDate: `${f}-03`, paymentType: "INSTALLMENT", installmentNumber: n, totalInstallments: of, purchaseDate: bought } });

test("alignInstallments: an installment on the closing day goes one bill per number after the plan's anchor", () => {
  // Bought on 26/11 (closing day): 1/4 Jan is right; Pluggy put 2/4 (26/12) in Jan too and 3/4 (26/01) in Feb.
  const tx = [inst("a1", "2026-11-26", "2027-01", 1, 4, 100), inst("a2", "2026-12-26", "2027-01", 2, 4, 100), inst("a3", "2027-01-26", "2027-02", 3, 4, 100), inst("a4", "2027-02-26", "2027-04", 4, 4, 100)];
  const out = alignInstallments(tx, "2026-11-26").map((t) => t.creditCardMetadata.billForecastDate.slice(0, 7));
  assert.deepEqual(out, ["2027-01", "2027-02", "2027-03", "2027-04"]);
});

test("alignInstallments: the anchor is the latest installment on a closed bill; rows on closed bills never move", () => {
  // 2/6 was brought forward into November's bill with 3/6 (anticipation, already closed); 4/6 onward follow 3/6.
  const tx = [inst("b1", "2026-09-18", "2026-10", 1, 6, 50, "Loja B", "2026-09-18"), inst("b2", "2026-10-18", "2026-11", 2, 6, 50, "Loja B", "2026-09-18"), inst("b3", "2026-10-20", "2026-11", 3, 6, 50, "Loja B", "2026-09-18"),
    inst("b4", "2026-12-18", "2027-02", 4, 6, 50, "Loja B", "2026-09-18")];
  const out = alignInstallments(tx, "2026-11-26").map((t) => t.creditCardMetadata.billForecastDate.slice(0, 7));
  assert.deepEqual(out, ["2026-10", "2026-11", "2026-11", "2026-12"]);
  assert.equal(alignInstallments(tx, null), tx);
});

// A closed bill of 900 due 03/12, closing 26/11; a later charge on the next bill; payments as given.
const snap = ({ cardPay = [], acctPay = [], xp = null } = {}) => ({ items: [
  { label: "nubank", accounts: [
    { type: "BANK", balance: 1000, transactions: acctPay },
    { type: "CREDIT", balance: 1200, credit: { balanceDueDate: "2026-12-03" }, bills: [{ dueDate: "2026-11-03", totalAmount: 500, billClosingDate: "2026-10-27" }, { dueDate: "2026-12-03", totalAmount: 900, billClosingDate: "2026-11-26" }],
      transactions: [{ id: "c1", date: "2026-11-20T12:00:00Z", amount: 900, description: "Loja A", card: { billForecastDate: "2026-12-03" } }, { id: "c2", date: "2026-11-27T12:00:00Z", amount: 300, description: "Loja C", card: { billForecastDate: "2027-01-03" } }, ...cardPay] },
  ] },
  ...(xp ? [xp] : []),
] });
const rules = { entities: { me: { banks: ["nubank", "xp"] } } };
const pay = (id, date, amount, desc = "Pagamento recebido", f = "2027-01") => ({ id, date: `${date}T12:00:00Z`, amount, description: desc, operationType: "PAGAMENTO_FATURA", card: { billForecastDate: `${f}-03` } });

test("cards: a closed bill not yet paid is the bill to pay, at its real total", () => {
  const [c] = cards(snap(), rules, "me", "2026-11-27");
  assert.equal(c.due, "2026-12-03");
  assert.equal(c.bill, 900);
  assert.equal(c.closed, true);
  assert.equal(c.paid, undefined);
});

test("cards: once the closed bill is paid, the open one is next month's, and the paid one is reported", () => {
  const [c] = cards(snap({ cardPay: [pay("p1", "2026-11-26", -900)] }), rules, "me", "2026-11-27");
  assert.equal(c.due, "2027-01-03");
  assert.equal(c.bill, 300);
  assert.deepEqual(c.paid, { due: "2026-12-03", total: 900, amount: 900, date: "2026-11-26" });
  const m = billMonths(snap({ cardPay: [pay("p1", "2026-11-26", -900)] }), rules, "me", "2026-11-27");
  assert.equal(m[0].month, "2027-01");
  assert.equal(m[0].amount, 300);
});

test("cards: a part payment leaves the rest to pay", () => {
  const [c] = cards(snap({ cardPay: [pay("p1", "2026-11-27", -400)] }), rules, "me", "2026-11-28");
  assert.equal(c.bill, 500);
  assert.equal(c.due, "2026-12-03");
});

const xpCard = { label: "xp", accounts: [{ type: "CREDIT", balance: 46, credit: { balanceDueDate: "2026-12-01" }, bills: [{ dueDate: "2026-12-01", totalAmount: 46, billClosingDate: "2026-11-24" }],
  transactions: [{ id: "x1", date: "2026-11-15T12:00:00Z", amount: 46, description: "CLUBE FIDELIDADE" }] }] };
const boleto = { id: "b1", date: "2026-11-26T12:00:00Z", amount: -46, description: "Pagamento efetuado|BANCO XP S/A", operationType: "BOLETO", category: "Transfers" };

test("cards: a card paid by boleto from another bank's account counts as paid", () => {
  assert.equal(isCardPayment(boleto, "xp"), true);
  assert.equal(isCardPayment(boleto, "nubank"), false);
  assert.equal(isCardPayment({ ...boleto, description: "Pagamento efetuado|OPERADORA TESTE S.A." }, "xp"), false);
  const s = snap({ acctPay: [boleto], xp: xpCard });
  assert.equal(paidSince(s, "xp", xpCard.accounts[0], "2026-11-24").amount, 46);
  const x = cards(s, rules, "me", "2026-11-27").find((c) => c.bank === "xp");
  assert.equal(x.bill, 0);
  assert.equal(x.due, "2027-01-01");
  assert.equal(x.paid.date, "2026-11-26");
});

test("spendRows: paying one's own card from an account is not spending (its charges already are)", () => {
  const s = snap({ acctPay: [boleto, { id: "b2", date: "2026-11-26T12:00:00Z", amount: -80, description: "Pagamento efetuado|OPERADORA TESTE S.A.", operationType: "BOLETO", category: "Telecommunications" }], xp: xpCard });
  const r = { ...rules, primary: "me" };
  const rows = spendRows(s, { rules: r, compiled: compileRules(r, {}), entity: "me", today: "2026-11-27" });
  const acct = rows.filter((x) => x.src === "account").map((x) => x.amt);
  assert.deepEqual(acct, [80]);
  assert.ok(rows.some((x) => x.src === "card" && x.amt === 46));
});

test("candidates: a conta charged on the card is not a decision", () => {
  const v = { cards: [], mat: { rows: [] }, wealth: { banks: [] }, guarantee: { issuers: [] } };
  const monthly = [{ name: "Streaming", day: 30, amount: 20, card: true }, { name: "Internet", day: 30, amount: 100 }];
  const out = candidates(v, { monthly, today: "2026-11-27" });
  assert.deepEqual(out.map((d) => d.name), ["Internet"]);
});

test("spendRows: an installment already on the open bill counts in this cycle before its date; later bills' do not", async () => {
  const { cardCycles } = await import("../src/lib/spend.js");
  const r = { ...rules, primary: "me" };
  const s = snap();
  s.items[0].accounts[1].transactions.push(
    { id: "i2", date: "2026-12-06T12:00:00Z", amount: 50, description: "Loja D 2/6", card: { billForecastDate: "2027-01-03", paymentType: "INSTALLMENT", installmentNumber: 2, totalInstallments: 6, purchaseDate: "2026-11-07" } },
    { id: "i3", date: "2027-01-06T12:00:00Z", amount: 50, description: "Loja D 3/6", card: { billForecastDate: "2027-02-03", paymentType: "INSTALLMENT", installmentNumber: 3, totalInstallments: 6, purchaseDate: "2026-11-07" } });
  const cycles = cardCycles(s, { rules: r, entity: "me" });
  const rows = spendRows(s, { rules: r, compiled: compileRules(r, {}), entity: "me", today: "2026-11-27", cycles });
  const ahead = rows.filter((x) => x.ahead);
  assert.deepEqual(ahead.map((x) => [x.d, x.cyc]), [["2026-12-06", "2026-12"]]);
});

test("points used on the bill are income; an early-payment discount nets against the installments brought forward", async () => {
  const { incomeRows, cardCycles } = await import("../src/lib/spend.js");
  const r = { ...rules, primary: "me" };
  const s = snap();
  const meta = (f, n) => ({ billForecastDate: `${f}-03`, paymentType: "INSTALLMENT", installmentNumber: n, totalInstallments: 4, purchaseDate: "2026-09-01" });
  s.items[0].accounts[1].transactions.push(
    { id: "aj", date: "2026-11-04T12:00:00Z", amount: -50, description: "Ajuste a crédito", category: "Income", card: { billForecastDate: "2026-12-03" } },
    { id: "q3", date: "2026-11-10T12:00:00Z", amount: 100, description: "Aerolinea Teste 3/4", category: "Airport and airlines", card: meta("2026-12", 3) },
    { id: "q4", date: "2026-11-10T12:00:00Z", amount: 100, description: "Aerolinea Teste 4/4", category: "Airport and airlines", card: meta("2026-12", 4) },
    { id: "ds", date: "2026-11-10T12:00:00Z", amount: -7.5, description: "Desconto Antecipação ", category: "Income", card: { billForecastDate: "2026-12-03" } });
  const compiled = compileRules(r, {});
  const cycles = cardCycles(s, { rules: r, entity: "me" });
  const inc = incomeRows(s, { rules: r, compiled, entity: "me", today: "2026-11-27", cycles });
  assert.deepEqual(inc.filter((x) => x.kind === "points").map((x) => [x.amt, x.cyc]), [[50, "2026-11"]]);
  const rows = spendRows(s, { rules: r, compiled, entity: "me", today: "2026-11-27", cycles });
  const disc = rows.find((x) => x.amt === -7.5);
  assert.equal(disc.cluster, "travel");
  assert.ok(!rows.some((x) => /ajuste/i.test(x.desc)));
});
