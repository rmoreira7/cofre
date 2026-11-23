// Caches the app shell only. API calls (api.pluggy.ai) are never cached here:
// the data lives encrypted in IndexedDB, not in the HTTP cache.
const CACHE = "cofre-0.3.2";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "src/tokens.css", "src/app.css", "src/main.js",
  "src/lib/vault.js", "src/lib/pluggy.js", "src/lib/categorize.js", "src/lib/spend.js", "src/lib/model.js", "src/lib/format.js", "src/lib/cdblca.js", "src/lib/cardtx.js", "src/lib/projection.js",
  "src/screens/home.js", "src/screens/spend.js", "src/screens/maturities.js", "src/screens/projection.js", "src/screens/settings.js",
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
