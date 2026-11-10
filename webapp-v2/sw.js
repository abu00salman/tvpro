/*
 * TV Pro v2 — offline shell service worker, scoped to /webapp-v2/.
 * Same cache-first-for-static / network-first-for-navigations strategy as the existing
 * app's sw.js, kept as a separate worker (own scope, own cache name) so it never collides
 * with the existing top-level service worker while this is a parallel, unshipped build.
 */
const VERSION = 'tvpro-v2-shell-v1';
const SCOPE = self.registration.scope;
const SHELL = [
  SCOPE, SCOPE + 'index.html', SCOPE + 'movies.html', SCOPE + 'series.html', SCOPE + 'anime.html',
  SCOPE + 'live.html', SCOPE + 'search.html', SCOPE + 'css/app.css',
  SCOPE + 'js/i18n.js', SCOPE + 'js/storage.js', SCOPE + 'js/gateway.js', SCOPE + 'js/demo.js',
  SCOPE + 'js/rows.js', SCOPE + 'js/hero.js', SCOPE + 'js/app.js', SCOPE + 'js/listing.js', SCOPE + 'js/search.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // streams/playlists/posters/guide data stay untouched

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => { if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((c) => c.put(request.url, copy)); } return response; })
        .catch(() => caches.match(request.url).then((cached) => cached || caches.match(SCOPE + 'index.html'))),
    );
    return;
  }

  if (/\.(css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((c) => c.put(request, copy)); }
        return response;
      })),
    );
  }
});
