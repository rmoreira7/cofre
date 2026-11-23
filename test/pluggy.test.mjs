import { test } from "node:test";
import assert from "node:assert/strict";
import { createPluggy, reservedHoldings } from "../src/lib/pluggy.js";

function fakeApi(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), key: init.headers["x-api-key"] });
    const handler = routes[`${init.method} ${u.pathname}`];
    const [status, body] = handler ? handler(u, init, calls) : [404, { message: "nope" }];
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const noSleep = async () => {};

const baseRoutes = {
  "POST /auth": () => [200, { apiKey: "k1" }],
  "GET /items/i1": () => [200, { id: "i1", status: "UPDATED" }],
  "GET /accounts": () => [200, { results: [{ id: "a1", type: "BANK" }, { id: "c1", type: "CREDIT" }] }],
  "GET /v2/transactions": (u) => {
    const acc = u.searchParams.get("accountId");
    if (acc === "a1" && !u.searchParams.get("cursor")) return [200, { results: [{ id: "t1" }, { id: "t2" }], next: "?accountId=a1&cursor=x" }];
    if (acc === "a1") return [200, { results: [{ id: "t3" }], next: null }];
    return [200, { results: [{ id: "t4" }] }];
  },
  "GET /bills": () => [200, { results: [{ id: "b1" }] }],
  "GET /investments": () => [200, { results: [{ id: "v1" }, { id: "v2" }] }],
};

test("pullItem follows next cursors, fetches bills only for CREDIT", async () => {
  const { fetch, calls } = fakeApi(baseRoutes);
  const p = createPluggy({ clientId: "c", clientSecret: "s", fetch, sleep: noSleep });
  const r = await p.pullItem("i1");
  assert.equal(r.item.status, "UPDATED");
  assert.deepEqual(r.accounts[0].transactions.map((t) => t.id), ["t1", "t2", "t3"]);
  assert.equal(r.accounts[0].bills, undefined);
  assert.deepEqual(r.accounts[1].bills.map((b) => b.id), ["b1"]);
  assert.equal(r.investments.length, 2);
  assert.ok(calls.filter((c) => c.path !== "/auth").every((c) => c.key === "k1"));
  assert.equal(calls.find((c) => c.path === "/investments").query.pageSize, "500");
});

test("re-authenticates once on 401", async () => {
  let n = 0;
  const { fetch, calls } = fakeApi({
    ...baseRoutes,
    "POST /auth": () => [200, { apiKey: `k${++n}` }],
    "GET /items/i1": (u, init) => (init.headers["x-api-key"] === "k1" ? [401, {}] : [200, { id: "i1" }]),
  });
  const p = createPluggy({ clientId: "c", clientSecret: "s", fetch, sleep: noSleep });
  assert.equal((await p.request("GET", "/items/i1")).id, "i1");
  assert.equal(calls.filter((c) => c.path === "/auth").length, 2);
});

test("retries 429 then gives up with status", async () => {
  const { fetch, calls } = fakeApi({ ...baseRoutes, "GET /items/i1": () => [429, {}] });
  const p = createPluggy({ clientId: "c", clientSecret: "s", fetch, sleep: noSleep, retries: 2 });
  await assert.rejects(p.request("GET", "/items/i1"), (e) => e.status === 429);
  assert.equal(calls.filter((c) => c.path === "/items/i1").length, 3);
});

test("pullAll isolates a failing item", async () => {
  const { fetch } = fakeApi(baseRoutes);
  const p = createPluggy({ clientId: "c", clientSecret: "s", fetch, sleep: noSleep });
  const seen = [];
  const r = await p.pullAll([{ label: "a", id: "i1" }, { label: "b", id: "missing" }], { onProgress: (e) => seen.push(e) });
  assert.equal(r.items[0].accounts.length, 2);
  assert.equal(r.items[1].status, 404);
  assert.deepEqual(seen.map((e) => e.ok).sort(), [false, true]);
});

test("reservedHoldings reads bankData.reservedBalances", () => {
  assert.deepEqual(reservedHoldings({ bankData: { reservedBalances: [{ amount: 1 }] } }), [{ amount: 1 }]);
  assert.deepEqual(reservedHoldings({ type: "CREDIT" }), []);
});
