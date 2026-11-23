// Pluggy Open Finance client. Runs in the browser (CORS allowed) and in Node (tests, parity).
// Pluggy has no item-list endpoint (GET /items → 405), so item IDs always come from the vault.

export const BASE = "https://api.pluggy.ai";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class PluggyError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function createPluggy({ clientId, clientSecret, fetch = globalThis.fetch, base = BASE, retries = 3, sleep = defaultSleep }) {
  let apiKey = null;

  async function request(method, path, { params, body, auth = true } = {}, attempt = 0, reauthed = false) {
    if (auth && !apiKey) await authenticate();
    const url = base + path + (params ? "?" + new URLSearchParams(params) : "");
    const headers = { "content-type": "application/json" };
    if (auth) headers["x-api-key"] = apiKey;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return res.json();
    if (auth && res.status === 401 && !reauthed) {
      apiKey = null;
      return request(method, path, { params, body, auth }, attempt, true);
    }
    if (RETRY_STATUS.has(res.status) && attempt < retries) {
      await sleep(500 * 2 ** attempt);
      return request(method, path, { params, body, auth }, attempt + 1, reauthed);
    }
    throw new PluggyError(method, path, res.status, await res.text().catch(() => ""));
  }

  async function authenticate() {
    const res = await request("POST", "/auth", { body: { clientId, clientSecret }, auth: false });
    apiKey = res.apiKey;
  }

  async function paged(path, params) {
    const out = [];
    let p = params;
    for (;;) {
      const res = await request("GET", path, { params: p });
      out.push(...res.results);
      if (!res.next) return out;
      p = Object.fromEntries(new URLSearchParams(res.next.replace(/^\?/, "")));
    }
  }

  async function pullItem(id) {
    const item = await request("GET", `/items/${id}`);
    const accounts = (await request("GET", "/accounts", { params: { itemId: id } })).results;
    for (const acc of accounts) {
      acc.transactions = await paged("/v2/transactions", { accountId: acc.id });
      if (acc.type === "CREDIT") acc.bills = (await request("GET", "/bills", { params: { accountId: acc.id } })).results;
    }
    const investments = await paged("/investments", { itemId: id, pageSize: 500 });
    return { item, accounts, investments };
  }

  // items: [{ label, id }]. One failing bank never sinks the others.
  async function pullAll(items, { onProgress = () => {} } = {}) {
    await authenticate();
    const results = await Promise.all(
      items.map(async ({ label, id }) => {
        try {
          const r = await pullItem(id);
          onProgress({ label, ok: true });
          return { label, ...r };
        } catch (e) {
          onProgress({ label, ok: false, error: e.message });
          return { label, error: e.message, status: e.status ?? null };
        }
      }),
    );
    return { at: new Date().toISOString(), items: results };
  }

  return { authenticate, request, paged, pullItem, pullAll };
}

// Cofrinhos and similar earmarked cash: Pluggy reports them on the BANK account, not as investments (P10).
export function reservedHoldings(account) {
  const r = account?.bankData?.reservedBalances;
  return Array.isArray(r) ? r : [];
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
