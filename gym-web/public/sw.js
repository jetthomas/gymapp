// Lets the app open with no signal: on install it keeps every file of the current build,
// and serves those copies when the network fails.
const CACHE = 'gym-app-v1';
const MANIFEST = '/asset-manifest.json';

// '/assets/x.js' for every file Vite built, from the manifest it writes next to them
const builtFiles = (manifest) =>
  [
    ...new Set(
      Object.values(manifest).flatMap((c) => [c.file, ...(c.css ?? []), ...(c.assets ?? [])]),
    ),
  ].map((f) => `/${f}`);

self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch(MANIFEST, { cache: 'no-store' });
      await cache.put(MANIFEST, res.clone());
      await cache.addAll(['/', ...builtFiles(await res.json())]);
      await self.skipWaiting();
    })(),
  ),
);

// Drops files from older builds: their names have a different hash, so nothing asks for them again
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const current = new Set(builtFiles(await (await cache.match(MANIFEST)).json()));
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith('/assets/') && !current.has(path)) await cache.delete(req);
      }
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API calls are never kept: the outbox handles saving, and an old copy of account data would be wrong
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  // Built files have their hash in the name and never change, so the kept copy is always right.
  // Cache first means weak gym signal doesn't stall the app waiting on the network
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((kept) => kept ?? fetchAndKeep(event.request)),
    );
    return;
  }
  // Everything else (the page itself, icons) can change, so try the network first
  event.respondWith(
    fetchAndKeep(event.request)
      // Any page address falls back to the app itself, which then draws the right screen
      .catch(async () => (await caches.match(event.request)) ?? (await caches.match('/'))),
  );
});

function fetchAndKeep(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
