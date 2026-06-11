// Network-first service worker: fresh deploys win, offline falls back to cache.
// /api requests are never intercepted — sync must see real network errors.
const CACHE = "min-tid-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((hit) => {
          if (hit) return hit;
          // Offline navigation (incl. /?action=…): serve the cached app shell.
          if (event.request.mode === "navigate") return caches.match("/");
          return Response.error();
        })
      )
  );
});
