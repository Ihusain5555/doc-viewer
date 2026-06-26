/* Doc Viewer — service worker.
 *
 * Purpose: make the app installable and let its SHELL (the page, styles, script,
 * icons) open even when offline.
 *
 * Two rules keep it safe and non-surprising:
 *   1. NETWORK-FIRST for the shell — when you're online you always get the latest
 *      version, so an update is never "stuck" behind an old cached build. The cache
 *      is only a fallback for when the network is unavailable.
 *   2. It NEVER touches /api/ — your live Google Doc data always goes straight to
 *      the network and is never cached. This preserves the read-only, always-fresh
 *      behavior and the integrity line (nothing about your docs is stored here).
 *
 * Bump CACHE when the shell file list changes to drop the old cache cleanly.
 */
const CACHE = 'doc-viewer-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // a failed precache must not block install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // leave cross-origin requests alone
  if (url.pathname.startsWith('/api/')) return;     // NEVER cache live doc data

  // Network-first: fresh when online, cached shell when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
  );
});
