// Lets the app open with no signal: every file it loads is kept, and that copy is served when the network fails.
// shortcut: files are kept as they are fetched, so offline works from the second visit, not the first
const CACHE = 'gym-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API calls are never kept: the outbox handles saving, and an old copy of account data would be wrong
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      // Any page address falls back to the app itself, which then draws the right screen
      .catch(async () => (await caches.match(event.request)) ?? (await caches.match('/'))),
  );
});
