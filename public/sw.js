// ✅ Service Worker – version offline persistante (v9)
const CACHE_NAME = "mdl-carte-v9";
const ASSETS = [
  "/app/index.html",
  "/app/manifest.json",
  "/static/logo-mdl.png",
  "/static/icons/card.png",
  "/static/icons/phone.png",
  "/static/icons/wallet.png",
  "/static/icons/instagram.png",
  "/static/carte-mdl.png"
];

// Installation : mise en cache des fichiers essentiels
self.addEventListener("install", (event) => {
  console.log("📦 Installation du SW (cache initial)...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", (event) => {
  console.log("🧹 Activation / nettoyage anciens caches...");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord, fallback cache (surtout pour /c/:code)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ne jamais intercepter les API dynamiques
  if (url.pathname.startsWith("/api/")) return;

  // 📌 Spécial pour la carte (ex: /c/ADHXXXX)
  if (url.pathname.startsWith("/c/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => {
          if (cached) return cached;
          // fallback visuel si rien en cache
          return caches.match("/static/carte-mdl.png");
        }))
    );
    return;
  }

  // Autres ressources statiques (index, images, etc.)
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
