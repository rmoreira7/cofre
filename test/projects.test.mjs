import test from "node:test";
import assert from "node:assert/strict";
import { projectsView, validProjects } from "../src/lib/projects.js";

const tx = (id, date, amount, desc, f, bought, n, of) => ({ id, date: `${date}T12:00:00Z`, amount, description: desc, card: { billForecastDate: `${f}-03`, purchaseDate: bought, paymentType: of ? "INSTALLMENT" : "SINGLE", installmentNumber: n, totalInstallments: of } });
const snap = { items: [{ label: "bank_a", accounts: [{ type: "CREDIT", transactions: [
  tx("a", "2026-05-27", 300, "Aerolinea Teste 1/3", "2026-07", "2026-05-27", 1, 3), tx("b", "2026-06-27", 300, "Aerolinea Teste 2/3", "2026-07", "2026-05-27", 2, 3), tx("c", "2026-07-27", 300, "Aerolinea Teste 3/3", "2026-08", "2026-05-27", 3, 3),
  tx("d", "2026-11-26", 100, "Agencia Viagem", "2027-01", "2026-11-26", 1, 3), tx("e", "2026-12-26", 100, "Agencia Viagem", "2027-02", "2026-11-26", 2, 3), tx("f", "2027-01-26", 100, "Agencia Viagem", "2027-03", "2026-11-26", 3, 3),
  tx("g", "2026-11-17", 80, "Agencia Viagem", "2026-12", "2026-11-17", 1, 1), // same merchant, another day: not the trip
] }] }] };
const rules = { entities: { me: { banks: ["bank_a"] } }, projects: [{ id: "t", name: "Viagem Teste", start: "2027-02-11", end: "2027-02-23",
  items: [{ match: "aerolinea", on: "2026-05-27" }, { match: "agencia viagem", on: "2026-11-26" }], extras: [{ name: "Hotel no local", amount: 100, currency: "USD", due: "2027-02-17" }] }] };

test("projectsView: the trip's purchases by bill (billed, open, ahead) plus what is paid at the hotel", () => {
  assert.equal(validProjects(rules.projects), true);
  const [p] = projectsView(snap, rules, "me", [{ bank: "bank_a", due: "2027-01-03" }], "2026-11-27", { USD: 5 });
  assert.equal(p.billed, 900);
  assert.equal(p.open, 100);
  assert.equal(p.ahead, 200);
  assert.equal(p.lastAhead, "2027-03");
  assert.equal(p.outside, 500);
  assert.equal(p.total, 1700);
  assert.deepEqual(p.buys.map((b) => [b.name, b.amount, b.n]), [["Aerolinea Teste", 900, 3], ["Agencia Viagem", 300, 3]]);
});

test("projectsView: gone 30 days after the trip; invalid lists are refused", () => {
  assert.equal(projectsView(snap, rules, "me", [], "2027-03-30").length, 0);
  assert.equal(validProjects([{ id: "x", name: "y", items: [] }]), false);
  assert.equal(validProjects([{ id: "x", name: "y", items: [{ match: "a", on: "27/05" }] }]), false);
});
