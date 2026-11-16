// Minimal service worker: makes Mapair installable as an app and lets the
// shell open without a connection. Only same-origin page navigations are
// handled (network first, cached shell as fallback); Firebase, Google Maps and
// all other requests go straight to the network untouched.
const CACHE = "mapair-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("./")).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match("./").then((cached) => cached || Response.error()))
  );
});
