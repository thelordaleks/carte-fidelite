// ✅ Service Worker – v19 (offline + mode veille Render invisible)
const CACHE_NAME = 'mdl-carte-v19';
const STATIC_ASSETS = [
  '/app/index.html',
  '/app/manifest.json',
  '/static/logo-mdl.png',
  '/static/carte-mdl.png',
  '/static/icons/card.png',
  '/static/icons/phone.png',
  '/static/icons/wallet.png',
  '/static/icons/instagram.png'
];

// 🧩 Normalisation d’URL
function normalizedUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/c/') || u.pathname.startsWith('/barcode/')) {
      u.search = '';
    }
    return u.toString();
  } catch { return url; }
}

// 🪣 Installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ♻️ Activation
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
  })());
  self.clients.claim();
});

// 📡 Interception des requêtes
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const keyNorm = normalizedUrl(req.url);
  const keyOrig = req.url;

  // ⛔ Laisse passer l’API en direct
  if (url.pathname.startsWith('/api/')) return;

  // 🎴 Carte MDL
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // Online → maj du cache
        const res = await fetch(req);
        await cache.put(keyNorm, res.clone());
        await cache.put(keyOrig, res.clone());
        return res;
      } catch {
        // Offline ou Render en veille → on sert direct le cache
        const cached = await cache.match(keyNorm) || await cache.match(keyOrig);
        if (cached) return cached;

        // dernier recours : fond statique
        return caches.match('/static/carte-mdl.png');
      }
    })());
    return;
  }

  // 📊 Code-barres
  if (url.pathname.startsWith('/barcode/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        await cache.put(keyNorm, res.clone());
        await cache.put(keyOrig, res.clone());
        return res;
      } catch {
        const cached = await cache.match(keyNorm) || await cache.match(keyOrig);
        return cached || new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // 🧱 Ressources statiques → cache-first
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then(c => c || fetch(req)));
    return;
  }

  // 🌍 Tout le reste → online-first, sinon cache
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const res = await fetch(req);
      await cache.put(keyNorm, res.clone());
      await cache.put(keyOrig, res.clone());
      return res;
    } catch {
      const cached = await cache.match(keyNorm) || await cache.match(keyOrig);
      if (cached) return cached;

      // Serveur endormi → réponse silencieuse
      return new Response('<body style="font-family:sans-serif;text-align:center;padding:40px;color:#c0872f;">💤 Serveur en veille<br><small>Affichage hors ligne</small></body>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200
      });
    }
  })());
});
