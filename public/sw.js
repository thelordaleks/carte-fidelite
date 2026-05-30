/* ============================================================
   Carte fidélité MDL — Service Worker
   Placé dans /public/sw.js (servi sur /sw.js par le serveur).
   ============================================================ */

const VERSION       = "mdl-pwa-v2";
const SHELL_CACHE   = "shell-" + VERSION;
const RUNTIME_CACHE = "runtime-" + VERSION;

// Fichiers indispensables pour ouvrir l'app ET afficher la carte hors-ligne
const PRECACHE = [
  "/app/",
  "/app/index.html",
  "/app/app.js",
  "/app/style.css",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/carte-mdl.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok) {
      caches.open(RUNTIME_CACHE).then((c) => c.put(request, res.clone()));
    }
    return res;
  }).catch(() => null);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/get-card/")) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/barcode/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/app/index.html")));
    return;
  }
  if (url.pathname.startsWith("/app/") || url.pathname.startsWith("/static/")) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
});
