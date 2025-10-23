// ✅ Service Worker – v18 (offline carte robuste)
const CACHE_NAME = 'mdl-carte-v18';
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

// 🧩 Clés normalisées
function normalizedUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/c/') || u.pathname.startsWith('/barcode/')) {
      u.search = '';
    }
    return u.toString();
  } catch { return url; }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const keyNorm = normalizedUrl(req.url);
  const keyOrig = req.url;

  // Laisse passer l'API au réseau
  if (url.pathname.startsWith('/api/')) return;

  // 🃏 Carte HTML
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // en ligne → on met à jour le cache sous deux clés (avec et sans query)
        const res = await fetch(req);
        await cache.put(keyNorm, res.clone());
        await cache.put(keyOrig, res.clone());
        // console.log('[SW] ✅ Carte MAJ cache:', keyNorm, 'et', keyOrig);
        return res;
      } catch {
        // hors ligne → on tente d'abord la clé normalisée, puis la clé originale
        let cached = await cache.match(keyNorm);
        if (cached) {
          // console.log('[SW] 💾 Carte depuis cache (norm):', keyNorm);
          return cached;
        }
        cached = await cache.match(keyOrig);
        if (cached) {
          // console.log('[SW] 💾 Carte depuis cache (orig):', keyOrig);
          return cached;
        }
        // 💤 Serveur endormi → on affiche le dernier cache si dispo
const offlineFallback = await caches.match(keyNorm) || await caches.match(keyOrig);
if (offlineFallback) return offlineFallback;

// dernier recours : une image si aucun cache HTML
return caches.match('/static/carte-mdl.png');

      }
    })());
    return;
  }

  // 🧾 Code-barres
  if (url.pathname.startsWith('/barcode/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        await cache.put(keyNorm, res.clone());
        await cache.put(keyOrig, res.clone());
        return res;
      } catch {
        let cached = await cache.match(keyNorm);
        if (cached) return cached;
        cached = await cache.match(keyOrig);
        if (cached) return cached;
        return new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // 🧱 Statiques → cache-first
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then(c => c || fetch(req)));
    return;
  }

  // 🌐 Général → network, fallback cache
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const res = await fetch(req);
      await cache.put(keyNorm, res.clone());
      await cache.put(keyOrig, res.clone());
      return res;
    } catch {
      let cached = await cache.match(keyNorm);
      if (cached) return cached;
      cached = await cache.match(keyOrig);
      if (cached) return cached;
      // 🔁 Serveur endormi → garde l'ancien code-barres en cache
const cached = await cache.match(keyNorm) || await cache.match(keyOrig);
if (cached) return cached;
return new Response('💤 serveur en veille', { status: 503 });

    }
  })());
});
