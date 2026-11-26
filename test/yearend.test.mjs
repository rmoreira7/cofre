import { test } from "node:test";
import assert from "node:assert/strict";
import { keepYearEnd, yearEndSummary } from "../src/lib/yearend.js";

const snap = (bal, extra = {}) => ({
  fx: { USD: 5 },
  items: [
    { label: "xp", accounts: [{ type: "BANK", name: "Conta", balance: bal, transactions: [{ id: "t" }] }, { type: "CREDIT", balance: 900 }], investments: [{ id: "i1", balance: 1000, issuer: "Banco Teste" }], ...extra },
    { label: "wise", accounts: [{ type: "BANK", balance: 10, currencyCode: "USD" }], investments: [] },
  ],
});

test("the last refresh of the year is the year-end, per bank; a failed bank keeps its earlier entry; no transactions", () => {
  let ye = keepYearEnd(undefined, snap(100), "2026-12-20");
  ye = keepYearEnd(ye, { fx: { USD: 6 }, items: [{ label: "xp", error: "x" }, { ...snap(0).items[1] }] }, "2026-12-31");
  ye = keepYearEnd(ye, snap(999), "2027-01-02");
  assert.equal(ye["2026"].banks.xp.d, "2026-12-20");
  assert.equal(ye["2026"].banks.xp.accounts.length, 1, "the card is not a balance to declare");
  assert.ok(!("transactions" in ye["2026"].banks.xp.accounts[0]));
  assert.equal(ye["2026"].banks.wise.d, "2026-12-31");
  assert.equal(ye["2027"].banks.xp.accounts[0].balance, 999, "January writes the new year, not the old one");
  const s = yearEndSummary(ye, "2026");
  assert.equal(s.done, false);
  const xp = s.banks.find((b) => b.label === "xp"), wise = s.banks.find((b) => b.label === "wise");
  assert.deepEqual([xp.checking, xp.invested, xp.positions, xp.onTime], [100, 1000, 1, false]);
  assert.deepEqual([wise.checking, wise.onTime], [60, true]);
  assert.equal(yearEndSummary(ye, "2025"), null);
});

test("every bank kept on 31/12 is done", () => {
  const s = yearEndSummary(keepYearEnd({}, snap(1), "2026-12-31"), "2026");
  assert.equal(s.done, true);
});
