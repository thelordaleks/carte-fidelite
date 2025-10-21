// ✅ Service Worker – Android robuste (v14)
// - Cache statique + dynamique
// - Normalisation des clés pour /c/:code et /barcode/:txt (ignore ?t=...)
// - Network-first pour la carte, fallback cache en offline

const CACHE_NAME = 'mdl-carte-v14';
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
      // ⚠️ on supprime la query (?t=...) pour que le cache matche offline
      url.search = '';
      return new Request(url.toString(), { method: req.method, headers: req.headers, mode: req.mode, credentials: req.credentials, redirect: req.redirect });
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
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
      if ('navigationPreload' in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
    })()
  );
  self.clients.claim();
});

// 📩 Gestion message 'skipWaiting' (utile si on pousse une maj)
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

  // ⛔️ API : jamais de cache (toujours réseau)
  if (url.pathname.startsWith('/api/')) {
    return; // laisser passer au réseau sans intercepter
  }

  // 🃏 Carte HTML : /c/:code → network-first, fallback cache normalisé
  if (url.pathname.startsWith('/c/')) {
    event.respondWith((async () => {
      const normalized = normalizeRequest(req);
      try {
        const res = await fetch(req);
        // on stocke sous la clé normalisée (sans ?t=...)
        const clone = res.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(normalized, clone);
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        // dernier recours : visuel statique (l'image) si jamais la carte n'a jamais été vue
        return caches.match('/static/carte-mdl.png');
      }
    })());
    return;
  }

  // 🧾 Code-barres : /barcode/:txt → network-first, fallback cache normalisé
  if (url.pathname.startsWith('/barcode/')) {
    event.respondWith((async () => {
      const normalized = normalizeRequest(req);
      try {
        const res = await fetch(req);
        const clone = res.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(normalized, clone);
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(normalized);
        if (cached) return cached;
        // pas de fallback image générique — on laisse échouer proprement
        return new Response('offline', { status: 503, statusText: 'offline' });
      }
    })());
    return;
  }

  // 🧱 Assets statiques : cache-first
  if (STATIC_ASSETS.some(p => url.pathname === p)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 📄 Navigations/app : network-first, fallback cache
  if (url.pathname.startsWith('/app')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const clone = res.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, clone);
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
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
      const clone = res.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(req, clone);
      return res;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      return new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
