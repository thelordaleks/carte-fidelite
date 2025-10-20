// ✅ Service Worker minimal – ne bloque rien
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => self.clients.claim());
