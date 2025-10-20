// ✅ Service Worker — Carte fidélité MDL (v12)
const CACHE_NAME = "mdl-carte-v12";
const STATIC_ASSETS = [
  "/app/",
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

// 📦 Installation : cache tous les fichiers essentiels
self.addEventListener("install", (event) => {
  console.log("📦 Installation SW v12...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.error("❌ Erreur cache install:", err))
  );
});

// 🧹 Activation : supprime les anciens caches
self.addEventListener("activate", (event) => {
  console.log("🧹 Activation SW v12");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => key !== CACHE_NAME && caches.delete(key)))
    )
  );
  self.clients.claim();
});

// 🌐 Gestion réseau + cache intelligent
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ Ignore les appels API
  if (url.pathname.startsWith("/api/")) return;

  // 🔹 Stratégie spéciale pour la page de l’app
  if (url.pathname === "/app/" || url.pathname === "/app/index.html") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match("/app/index.html"))
    );
    return;
  }

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
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match("/static/carte-mdl.png");
        })
    );
    return;
  }

  // 🔹 Fichiers statiques (icônes, images, manifest)
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// 🔄 Forcer la mise à jour du SW
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "skipWaiting") {
    self.skipWaiting();
  }
});
