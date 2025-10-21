// ✅ Service Worker – Android robuste (v15)
// - Cache statique + dynamique
// - Normalisation des clés pour /c/:code et /barcode/:txt (ignore ?t=...)
// - Network-first pour la carte, fallback cache en offline

const CACHE_NAME = 'mdl-carte-v15';
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

// 🧰 Normalise une Request pour ignorer la query sur /c/:code et /barcode/:txt
function normalizeRequest(req) {
  try {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/c/') || url.pathname.startsWith('/barcode/')) {
      url.search = ''; // ⚠️ on supprime la query (?t=...)
      return new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
        mode: req.mode,
        credentials: req.credentials,
        redirect: req.redirect
      });
    }
  } catch (e) {}
  return req;
}

// 🧩 Installation : cache statique
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 🧼 Activation : nettoyage anciens caches + navigationPreload
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

// 📩 Gestion message 'skipWaiting'
self.addEventListener('message', evt => {
  if (evt.data && evt.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// 🌐 Stratégies de cache
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const normalized = normalizeRequest(req);

  // ⛔️ API : jamais de cache
  if (url.pathname.startsWith('/api/')) return;

  // 🃏 Carte HTML : /c/:code → network-first, fallback cache normalisé
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(normalized, res.clone()); // toujours clé sans ?t=
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        // fallback : visuel statique
        return caches.match('/static/carte-mdl.png');
      }
    })());
    return;
  }

  // 🧾 Code-barres : /barcode/:txt → network-first, fallback cache normalisé
  if (url.pathname.startsWith('/barcode/')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(normalized, res.clone());
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        return new Response('offline', { status: 503, statusText: 'offline' });
      }
    })());
    return;
  }

  // 🧱 Assets statiques : cache-first
  if (STATIC_ASSETS.some(p => url.pathname === p)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(normalized);
      if (cached) return cached;
      const res = await fetch(req);
      cache.put(normalized, res.clone());
      return res;
    })());
    return;
  }

  // 📄 Navigations/app : network-first, fallback cache
  if (url.pathname.startsWith('/app')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(normalized, res.clone());
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        return caches.match('/app/index.html');
      }
    })());
    return;
  }

  // 🌐 Par défaut : try network, fallback cache
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      await cache.put(normalized, res.clone());
      return res;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(normalized);
      if (cached) return cached;
      return new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
