/*
 * TV Pro service worker — offline shell only.
 * - Navigations: network first, cached shell when offline.
 * - Hashed build assets (/_next/static): cache first (immutable).
 * - Everything cross-origin (streams, playlists, posters, guide data) is never touched or cached.
 */
const VERSION = 'tvpro-shell-v1';
const SCOPE = self.registration.scope;
const SHELL = [SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon.svg', SCOPE + 'icons/icon-192.png'];

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
  if (url.origin !== self.location.origin) return; // user sources stay between the browser and the source

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((c) => c.put(SCOPE, copy)); }
          return response;
        })
        .catch(() => caches.match(SCOPE).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.includes('/_next/static/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((c) => c.put(request, copy)); }
        return response;
      })),
    );
  }
});
