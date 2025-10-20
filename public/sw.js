// ✅ Nouvelle version pour forcer la mise à jour
const CACHE_NAME = "mdl-carte-v6";
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
  console.log("📦 Service Worker: installation...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // activation immédiate
  );
});

// Activation : nettoyage des anciennes versions
self.addEventListener("activate", event => {
  console.log("🧹 Nettoyage anciens caches...");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      }))
    )
  );
  self.clients.claim(); // prend le contrôle sans attendre
});

// Stratégie : "Network first" puis fallback cache
self.addEventListener("fetch", event => {
  const req = event.request;

  // On ignore les appels API pour éviter de cacher les points
  if (req.url.includes("/api/")) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // On met à jour le cache silencieusement
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req)) // fallback offline
  );
});
