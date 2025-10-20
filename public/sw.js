// ✅ Service Worker – Carte fidélité offline complète (v10)
const CACHE_NAME = "mdl-carte-v10";
const STATIC_ASSETS = [
  "/app/index.html",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/icons/card.png",
  "/static/icons/phone.png",
  "/static/icons/wallet.png",
  "/static/icons/instagram.png",
  "/static/carte-mdl.png"
];

// Mise en cache initiale
self.addEventListener("install", (event) => {
  console.log("📦 Installation SW v10");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Nettoyage anciens caches
self.addEventListener("activate", (event) => {
  console.log("🧹 Activation SW v10");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Gestion du réseau + cache intelligent
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 🔹 Ignore les appels API (JSON, points, etc.)
  if (url.pathname.startsWith("/api/")) return;

  // 🔹 Cartes (ex: /c/ADHxxxx)
  if (url.pathname.startsWith("/c/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            // Si aucune version en cache, fallback visuel
            return caches.match("/static/carte-mdl.png");
          })
        )
    );
    return;
  }

  // 🔹 Fichiers statiques classiques
  event.respondWith(
    fetch(req)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
