// Minimal service worker: exists so the app is installable as a PWA (the
// Android share sheet only lists installed PWAs) and so the installed app
// starts instantly and works offline. It never caches API responses or pages —
// only the shell assets the browser already marked cacheable.
const CACHE = "memora-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

// Navigation requests: network first (the app is a live data view), falling
// back to the cached shell only when the device is offline — so the installed
// app opens instead of a dinosaur, and everything else always hits the server.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((hit) => hit || caches.match("/"))));
  }
});
