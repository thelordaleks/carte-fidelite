// ✅ SW v11 — Offline fiable pour la carte
const CACHE_NAME = 'mdl-carte-v11';

const STATIC_ASSETS = [
  '/app/index.html',
  '/app/manifest.json',
  '/static/logo-mdl.png',
  '/static/icons/card.png',
  '/static/icons/phone.png',
  '/static/icons/wallet.png',
  '/static/icons/instagram.png',
  '/static/carte-mdl.png'
];

// 🔧 outil pour avoir une clé "canonique" sans query (?t=...)
function canonicalRequest(req) {
  const url = new URL(req.url);
  // On garde le chemin (/c/ADHxxxx) sans query
  return new Request(url.origin + url.pathname, { method: req.method, headers: req.headers });
}

// Installation : pré-cache des fichiers statiques
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : suppression anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ Laisse passer les API (on ne les cache pas)
  if (url.pathname.startsWith('/api/')) return;

  // 🪪 Page carte /c/<code> -> CACHE D’ABORD (ignore les ?t=...)
  if (url.pathname.startsWith('/c/')) {
    const key = canonicalRequest(req);

    event.respondWith(
      caches.match(key, { ignoreSearch: true }).then(cached => {
        // Si on a du cache et qu’on est OFFLINE -> on renvoie le cache
        if (cached && !self.navigator?.onLine) {
          return cached;
        }
        // Sinon on essaie le réseau, et on met en cache sous forme canonique (sans query)
        return fetch(req).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(key, clone));
          return res;
        }).catch(() => {
          // Réseau KO -> si on a un cache, on le renvoie
          if (cached) return cached;
          // Sinon, simple fallback visuel (image)
          return caches.match('/static/carte-mdl.png');
        });
      })
    );
    return;
  }

  // 🧾 Code-barres -> idem (cache d’abord, clé canonique sans query)
  if (url.pathname.startsWith('/barcode/')) {
    const key = canonicalRequest(req);

    event.respondWith(
      caches.match(key, { ignoreSearch: true }).then(cached => {
        if (cached && !self.navigator?.onLine) {
          return cached;
        }
        return fetch(req).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(key, clone));
          return res;
        }).catch(() => cached || new Response('', { status: 504 }));
      })
    );
    return;
  }

  // 🧩 Pour le reste : réseau d’abord, cache ensuite
  event.respondWith(
    fetch(req).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, clone));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
