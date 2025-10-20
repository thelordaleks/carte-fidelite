// ✅ Service Worker — Carte fidélité MDL (v11)
const CACHE_NAME = "mdl-carte-v11";
const STATIC_ASSETS = [
  "/app/index.html",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/icons/card.png",
  "/static/icons/phone.png",
  "/static/icons/wallet.png",
  "/static/icons/instagram.png",
  "/static/carte-mdl.png",
  "/static/carte-mdl-small.png",
  "/static/carte-mdl-medium.png"
];

// 📦 Installation : met en cache les fichiers essentiels
self.addEventListener("install", (event) => {
  console.log("📦 Installation SW v11...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 🧹 Activation : supprime les anciens caches
self.addEventListener("activate", (event) => {
  console.log("🧹 Activation SW v11");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => key !== CACHE_NAME && caches.delete(key)))
    )
  );
  self.clients.claim();
});

// 🌐 Gestion des requêtes réseau + cache intelligent
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ Ignore les appels API
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
        .catch(async () => {
          // Si hors ligne, on affiche la dernière carte en cache
          const cached = await caches.match(req);
          if (cached) return cached;
          // Fallback : affiche juste l’image de la carte
          return caches.match("/static/carte-mdl.png");
        })
    );
    return;
  }

  // 🔹 Autres fichiers statiques
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

// 🔄 Permet de forcer le skipWaiting depuis l’app
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "skipWaiting") {
    self.skipWaiting();
  }
});
