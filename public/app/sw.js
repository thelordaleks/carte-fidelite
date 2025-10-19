self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('mdl-cache').then(cache => {
      return cache.addAll([
        '/app/index.html',
        '/app/manifest.json'
      ]);
    })
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
