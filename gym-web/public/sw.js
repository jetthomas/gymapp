// Lets the app open with no signal: it keeps every file of the current build,
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

// Keeps a build's files (only the ones not kept yet), then drops older builds' files:
// their names have a different hash, so nothing asks for them again
async function keepBuild(cache, manifest) {
  const files = builtFiles(await manifest.clone().json());
  const kept = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  await cache.addAll(files.filter((f) => !kept.has(f)));
  await cache.put(MANIFEST, manifest);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !files.includes(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.add('/');
      await keepBuild(cache, await fetch(MANIFEST, { cache: 'no-store' }));
      await self.skipWaiting();
    })(),
  ),
);

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
  // Built files have their hash in the name and never change, so the kept copy is always right.
  // Cache first means weak gym signal doesn't stall the app waiting on the network
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((kept) => kept ?? fetchAndKeep(event.request)),
    );
    return;
  }
  // Opening the app shows the kept page at once instead of waiting on a slow link;
  // the fresh copy fetched alongside it is the one shown on the next open
  if (event.request.mode === 'navigate') {
    const fresh = keepPage(event.request);
    event.waitUntil(fresh.catch(() => {}));
    event.respondWith(
      caches
        .match(event.request)
        .then((kept) => kept ?? fresh.catch(() => caches.match('/'))),
    );
    return;
  }
  // Everything else (icons) can change, so try the network first
  event.respondWith(
    fetchAndKeep(event.request)
      // Any page address falls back to the app itself, which then draws the right screen
      .catch(async () => (await caches.match(event.request)) ?? (await caches.match('/'))),
  );
});

// A new build's page replaces the kept one only once that build's files are kept too:
// otherwise the next open with no signal would load scripts that aren't here, and show nothing
async function keepPage(request) {
  const [page, manifest] = await Promise.all([
    fetch(request),
    fetch(MANIFEST, { cache: 'no-store' }),
  ]);
  if (!page.ok || !manifest.ok) return page;
  const cache = await caches.open(CACHE);
  await keepBuild(cache, manifest);
  await cache.put(request, page.clone());
  return page;
}

function fetchAndKeep(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
