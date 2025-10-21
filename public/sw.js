// ✅ Service Worker – version v17 (offline corrigé)
const CACHE_NAME = 'mdl-carte-v17';
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

// 🧩 Normalise juste l’URL (sans recréer la Request)
function normalizedUrl(req) {
  try {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/c/') || url.pathname.startsWith('/barcode/')) {
      url.search = ''; // ignore les ?t=...
    }
    return url.toString();
  } catch {
    return req.url;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
  })());
  self.clients.claim();
});

// 💡 gestion du cache intelligent
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const cacheKey = normalizedUrl(req);

  // Ne jamais intercepter /api/
  if (url.pathname.startsWith('/api/')) return;

  // 🃏 Carte HTML
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        await cache.put(cacheKey, res.clone());
        console.log('[SW] ✅ Carte mise à jour en cache :', cacheKey);
        return res;
      } catch {
        const cached = await cache.match(cacheKey);
        if (cached) {
          console.log('[SW] 💾 Carte chargée depuis cache :', cacheKey);
          return cached;
        }
        console.warn('[SW] ⚠️ Aucune carte en cache, fallback image');
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
        await cache.put(cacheKey, res.clone());
        return res;
      } catch {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        return new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // 🧱 Assets statiques
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
    return;
  }

  // 🌐 fallback général
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const res = await fetch(req);
      await cache.put(cacheKey, res.clone());
      return res;
    } catch {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      return new Response('offline', { status: 503 });
    }
  })());
});
