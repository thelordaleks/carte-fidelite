// ✅ Service Worker — version stable MDL
const CACHE_NAME = "mdl-carte-v8";
const ASSETS = [
  "/app/index.html",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/icons/card.png",
  "/static/icons/phone.png",
  "/static/icons/wallet.png",
  "/static/icons/instagram.png"
];

// Installation : cache les fichiers essentiels
self.addEventListener("install", event => {
  console.log("📦 Installation du Service Worker...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", event => {
  console.log("🧹 Nettoyage des anciens caches...");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

// Fetch : réseau d'abord, cache en secours
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ Ignore les appels API pour éviter de bloquer les points
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
