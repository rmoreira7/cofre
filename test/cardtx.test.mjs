import { test } from "node:test";
import assert from "node:assert/strict";
import { ghostIds, cleanCard } from "../src/lib/cardtx.js";

let id = 0;
const inst = (desc, n, total, amount, date, purchaseDate, status = "POSTED") => ({ id: `t${++id}`, description: `${desc} ${n}/${total}`, amount, date: `${date}T12:00:00Z`, status, creditCardMetadata: { paymentType: "INSTALLMENT", installmentNumber: n, totalInstallments: total, purchaseDate } });

test("anticipation: earliest row per installment survives, extra copies trimmed", () => {
  const rows = [
    inst("Air Example", 1, 3, 100, "2026-05-27", "2026-05-27"), inst("Air Example", 1, 3, 100, "2026-05-27", "2026-05-27"),
    inst("Air Example", 2, 3, 100, "2026-06-01", "2026-05-27"), inst("Air Example", 2, 3, 100, "2026-06-27", "2026-05-27"),
    inst("Air Example", 3, 3, 100, "2026-06-01", "2026-05-27"), inst("Air Example", 3, 3, 100, "2026-07-27", "2026-05-27"),
  ];
  const kept = cleanCard(rows);
  assert.deepEqual(kept.map((t) => [t.creditCardMetadata.installmentNumber, t.date.slice(0, 10)]), [[1, "2026-05-27"], [2, "2026-06-01"], [3, "2026-06-01"]]);
});

test("reversed purchase: refunds of installment 1 cancel that many copies", () => {
  const rows = [];
  for (const copy of [0, 1]) for (let n = 1; n <= 3; n++) rows.push(inst("Shop Example", n, 3, n === 1 ? 33.34 : 33.33, n === 1 ? "2026-07-20" : `2026-0${7 + n}-20`, "2026-07-20", n === 1 ? "POSTED" : "PENDING"));
  const refunds = [{ id: "r1", description: "Estorno de compra", amount: -33.34, date: "2026-07-21T12:00:00Z" }, { id: "r2", description: "Estorno de compra", amount: -33.34, date: "2026-07-21T12:00:00Z" }];
  const g = ghostIds([...rows, ...refunds]);
  assert.equal(g.size, 4);
  assert.ok(rows.filter((t) => t.creditCardMetadata.installmentNumber === 1).every((t) => !g.has(t.id)));
  const one = ghostIds([...rows, refunds[0]]);
  assert.equal(one.size, 2);
});

test("genuine plans and late refunds are untouched", () => {
  const rows = [inst("Store Example", 1, 2, 50, "2026-09-01", "2026-09-01"), inst("Store Example", 2, 2, 50, "2026-10-01", "2026-09-01", "PENDING")];
  const late = { id: "r9", description: "Estorno de compra", amount: -50, date: "2026-09-20T12:00:00Z" };
  assert.equal(ghostIds([...rows, late]).size, 0);
  const noFirst = [inst("Old Example", 5, 6, 10, "2026-11-01", "2026-06-01"), inst("Old Example", 6, 6, 10, "2026-12-01", "2026-06-01", "PENDING")];
  assert.equal(ghostIds(noFirst).size, 0);
});
