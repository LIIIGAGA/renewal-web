// Only a public offline page is cached. Subscription data/auth/API responses are never cached.
const PREFIX = 'renewal-offline-' + self.registration.scope + '-';
const CACHE = PREFIX + 'v3';
const OFFLINE = new URL('offline.html', self.location.href).href;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
