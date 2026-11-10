/*
 * TV Pro — service worker retirement shim.
 *
 * Until this deploy, "/" served the old Next.js export, whose root index.html registered
 * ("./sw.js", scope "/") a cache-first-for-/_next/static service worker (see legacy-v1/sw.js,
 * VERSION "tvpro-shell-v40"). "/" now serves webapp-v2, which doesn't register a service
 * worker of its own and has no /_next/ to cache. A returning visitor's browser can still be
 * running that old worker, though: a registration isn't dropped just because the new page
 * stops calling register() — the browser keeps it and periodically re-checks the script at
 * this same URL/scope for byte-for-byte changes on its own.
 *
 * This file is that changed script. The old worker's own `activate` handler already calls
 * self.skipWaiting() on install and deletes every cache key that isn't its current VERSION, so
 * once the browser notices this file differs, it installs and activates this one: this
 * `activate` handler reuses that same cache-sweep (removing the old "tvpro-shell-v40" cache
 * full of /_next/static/* entries that no longer correspond to anything served here) and then
 * calls self.registration.unregister() so nothing stays in the way of plain, uncached network
 * requests going forward. Deliberately not shipping a new caching worker in this same change:
 * webapp-v2's own sw.js (kept only under its original parallel-build history, not deployed
 * here) cache-first's its CSS/JS by plain filename rather than a content hash, so reusing it
 * as-is here — on the very commit that makes webapp-v2 the production site — would swap one
 * staleness risk for another. Revisit that once webapp-v2 has an actual cache-busting story.
 */
self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
