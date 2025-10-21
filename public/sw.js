// ✅ Service Worker – version v16 stable
// - Correction clé de cache (garde Request d’origine)
// - Carte 100 % visible hors ligne sur Android

const CACHE_NAME = 'mdl-carte-v16';
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

// 🧩 Normalisation : renvoie juste la clé URL sans recréer la Request
function normalizedUrl(req) {
  try {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/c/') || url.pathname.startsWith('/barcode/')) {
      url.search = ''; // on ignore ?t=...
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
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
  })());
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Ne rien intercepter pour l’API
  if (url.pathname.startsWith('/api/')) return;

  const cacheKey = normalizedUrl(req);

  // 🃏 Carte HTML
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        await cache.put(cacheKey, res.clone());
        return res;
      } catch {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
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
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      const res = await fetch(req);
      cache.put(cacheKey, res.clone());
      return res;
    })());
    return;
  }

  // 📄 /app pages
  if (url.pathname.startsWith('/app')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        await cache.put(cacheKey, res.clone());
        return res;
      } catch {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        return caches.match('/app/index.html');
      }
    })());
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
