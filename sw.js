/* Buku Arisan — service worker
 * - Berkas aplikasi: network-first (update langsung terpakai), cadangan dari cache saat offline.
 * - Font & pustaka CDN: cache-first (versinya terkunci).
 * - Supabase (data) tidak pernah di-cache di sini; aplikasi menyimpan snapshot sendiri.
 */
const CACHE = "buku-arisan-77544f00";
const SHELL = ["./", "index.html", "config.js", "app.js", "reminder-core.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png"];
const CDN = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === "navigate" ? "index.html" : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === "navigate" ? "index.html" : req, { ignoreSearch: true })
    .then(hit => hit || caches.match(req, { ignoreSearch: true }))
    .then(hit => hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }))));
});
