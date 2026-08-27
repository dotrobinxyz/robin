// Minimal service worker: makes Nest installable; network-first so the app
// is always fresh, with a cached shell as offline fallback.
const SHELL = "nest-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add("/nest/")));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/nest/")));
  }
});
