const CACHE_NAME = 'tv-stream-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Passthrough con soporte offline básico para assets estáticos
  if (e.request.url.includes('/socket.io/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
