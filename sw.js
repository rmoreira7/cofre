// Caches the app shell only. API calls (api.pluggy.ai) are never cached here:
// the data lives encrypted in IndexedDB, not in the HTTP cache.
const CACHE = "cofre-0.33.0";
const SHELL = [
  "./", "index.html", "oauth.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
  "icons/icon-512.png", "src/app.css", "src/tokens.css", "src/lib/agenda.js", "src/lib/bio.js",
  "src/lib/cardtx.js", "src/lib/categorize.js", "src/lib/cdblca.js", "src/lib/closing.js", "src/lib/decisions.js",
  "src/lib/format.js", "src/lib/gauth.js", "src/lib/gcal.js", "src/lib/ics.js", "src/lib/income.js",
  "src/lib/ladder.js", "src/lib/lists.js", "src/lib/model.js", "src/lib/pace.js", "src/lib/pluggy.js",
  "src/lib/projection.js", "src/lib/projects.js", "src/lib/recurring.js", "src/lib/remote.js", "src/lib/seal.js",
  "src/lib/spend.js", "src/lib/sync.js", "src/lib/vault.js", "src/lib/view.js", "src/lib/yearend.js",
  "src/main.js", "src/oauth.js", "src/screens/home/agenda.js", "src/screens/home/decisions.js",
  "src/screens/home/index.js", "src/screens/home/summary.js", "src/screens/investments/income.js",
  "src/screens/investments/index.js", "src/screens/investments/maturities.js", "src/screens/investments/rules.js",
  "src/screens/investments/wallet.js", "src/screens/projection/assumptions.js", "src/screens/projection/chart.js",
  "src/screens/projection/index.js", "src/screens/projection/reality.js", "src/screens/projection/scenarios.js",
  "src/screens/projection/state.js", "src/screens/settings/about.js", "src/screens/settings/bills.js",
  "src/screens/settings/common.js", "src/screens/settings/connections.js", "src/screens/settings/goals.js",
  "src/screens/settings/index.js", "src/screens/settings/security.js", "src/screens/spend/bills.js",
  "src/screens/spend/common.js", "src/screens/spend/cycle.js", "src/screens/spend/groups.js",
  "src/screens/spend/history.js", "src/screens/spend/index.js", "src/ui/agenda.js", "src/ui/earn.js",
  "src/ui/shell.js", "src/ui/tabbed.js",
];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())),
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
