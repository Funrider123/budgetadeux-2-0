const CACHE_NAME = 'budget-a-soi-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
// index.html (et /) : toujours le réseau en priorité, le cache seulement en secours hors-ligne.
// L'app change souvent en ce moment ; avec l'ancienne stratégie cache-d'abord, chaque mise à
// jour poussée restait invisible jusqu'à la visite SUIVANTE. Le reste (manifest, icônes) change
// rarement : cache-d'abord y reste pertinent.
const NETWORK_FIRST = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // prend le contrôle sans attendre que tous les onglets ouverts se ferment
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const path = new URL(event.request.url).pathname;
  const cacheIfShell = (response) => {
    if (response.ok && SHELL_URLS.includes(path)) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    }
    return response;
  };
  if (NETWORK_FIRST.includes(path)) {
    event.respondWith(fetch(event.request).then(cacheIfShell).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then(cacheIfShell).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
