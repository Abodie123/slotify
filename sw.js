/* SLOTIFY Service Worker – installable + offline */
const SHELL = 'slotify-shell-v1';
const RUNTIME = 'slotify-runtime-v1';
const FILES = ['./', './index.html', './manifest.json', './icon.png'];
const MAX_RUNTIME = 80;

/* Install: cache the app shell (a missing file, e.g. icon.png, won't break install) */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

/* Activate: remove old caches */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Keep the runtime cache from growing forever */
async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) {
    await c.delete(keys[0]);
    return trim(name, max);
  }
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;

  const url = r.url;

  /* Never touch live data: Firestore, Firebase Auth, Google Maps, map tiles */
  if (/googleapis\.com|maps\.google|google\.com\/maps|openstreetmap/.test(url)) return;

  /* Page loads: network first, fall back to the cached app */
  if (r.mode === 'navigate') {
    e.respondWith(
      fetch(r)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(m => m || caches.match('./')))
    );
    return;
  }

  /* Everything else (Firebase scripts, Unsplash photos, icon, manifest):
     serve from cache instantly, refresh in the background */
  e.respondWith(
    caches.match(r).then(hit => {
      const net = fetch(r)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME).then(c => c.put(r, copy)).then(() => trim(RUNTIME, MAX_RUNTIME));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || net;
    })
  );
});