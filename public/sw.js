// ✅ Service Worker version 7 — PWA Carte MDL
const CACHE_NAME = "mdl-carte-v7";
const ASSETS = [
  "/app/index.html",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/icons/card.png",
  "/static/icons/phone.png",
  "/static/icons/wallet.png",
  "/static/icons/instagram.png"
];

// Installation : mise en cache des fichiers essentiels
self.addEventListener("install", event => {
  console.log("📦 Installation du SW...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", event => {
  console.log("🧹 Nettoyage anciens caches...");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord, cache ensuite
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ Ignore les appels API (points, nom, etc.)
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
