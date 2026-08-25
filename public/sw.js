// sw.js — makes the app installable and lets the shell (HTML/CSS/JS/icons)
// load instantly even on a poor connection.
//
// IMPORTANT: this deliberately does NOT cache anything under /api/. Cash,
// stock and sales figures must always come fresh from the server — caching
// them could show a stale balance sheet, which is worse than no offline
// support at all.

const CACHE_NAME = 'day-book-shell-v3';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always go to the network for real data.
  if (url.pathname.startsWith('/api/')) return;

  // Only handle our own GET requests for the shell.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached); // offline fallback to cache
      return cached || network;
    })
  );
});
