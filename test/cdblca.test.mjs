import { test } from "node:test";
import assert from "node:assert/strict";
import { curves, irRate } from "../src/lib/cdblca.js";

// The table approved with the design (CDI 13,65%, 2026-11-16).
const V = [[80.5, 80.7, 83.4, 83.8, 86.5, 87.2, 88.5], [84.6, 84.8, 87.6, 88.1, 90.9, 91.7, 93.1], [88.6, 88.9, 91.8, 92.3, 95.3, 96.2, 97.7], [92.7, 93.0, 96.1, 96.6, 99.8, 100.7, 102.3], [96.7, 97.1, 100.3, 100.9, 104.2, 105.2, 106.9], [100.8, 101.2, 104.5, 105.2, 108.6, 109.7, 111.5]];

test("break-even curves reproduce the approved table within 0.1 pt", () => {
  curves(0.1365).forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - V[i][j]) <= 0.1, `${i},${j}: ${v} vs ${V[i][j]}`)));
});

test("IR brackets", () => {
  assert.deepEqual([180, 181, 360, 361, 720, 721].map(irRate), [0.225, 0.2, 0.2, 0.175, 0.175, 0.15]);
});
