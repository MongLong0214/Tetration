/* Offline support. The network is always tried first, so an online visit never runs a
 * stale release; the cached copy is used only when the network is unavailable.
 * The worker makes no requests of its own beyond the files listed here. */
'use strict';
const CACHE = 'tetra-__BUILD__';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const SHELL_PATHS = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    self.registration.navigationPreload?.enable().catch(() => {}),
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tetra-') && key !== CACHE).map(key => caches.delete(key)))),
  ]).then(() => self.clients.claim()));
});

// Only the app page itself may replace the cached shell (not an icon or the manifest opened as a page).
const APP_PATHS = new Set(['./', 'index.html'].map(path => new URL(path, self.registration.scope).pathname));
const NAVIGATION_TIMEOUT = 3000;

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate';
  if (!navigation && !SHELL_PATHS.has(url.pathname)) return;
  const key = navigation ? './' : request;
  const network = (navigation ? Promise.resolve(event.preloadResponse).then(preloaded => preloaded || fetch(request)) : fetch(request)).then(response => {
    const html = (response.headers.get('content-type') || '').startsWith('text/html');
    if (response.ok && (!navigation || (APP_PATHS.has(url.pathname) && html))) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const cached = () => caches.match(key).then(hit => hit || (navigation ? caches.match('./') : null));
  if (!navigation) { event.respondWith(network.catch(() => cached().then(hit => hit || Response.error()))); return; }
  // Navigations: the fresh release when the network answers; the cached shell on failure,
  // a server error or a stalled connection (after a short deadline).
  event.respondWith(new Promise(resolve => {
    let done = false;
    const fallback = () => cached().then(hit => { if (hit && !done) { done = true; resolve(hit); } return hit; });
    const timer = setTimeout(fallback, NAVIGATION_TIMEOUT);
    network.then(response => {
      if (response.status >= 500) return fallback().then(hit => { if (!hit && !done) { done = true; resolve(response); } });
      if (!done) { done = true; clearTimeout(timer); resolve(response); }
    }, () => fallback().then(hit => { if (!hit && !done) { done = true; resolve(Response.error()); } }));
  }));
});
