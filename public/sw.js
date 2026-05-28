const CACHE = 'planless-v2';
const SHELL = ['/app', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip Supabase, external APIs — always network
  if (url.hostname !== self.location.hostname) return;

  // Network-first for HTML navigation (always fresh)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .catch(() => caches.match('/app').then(r => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Cache-first for hashed static assets (they're immutable)
  if (/\/assets\//.test(url.pathname) && /\.(js|css|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }))
    );
    return;
  }

  // Stale-while-revalidate for SVG/images
  if (/\.(svg|png|ico|webp)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request).then(r => {
          if (r.ok) cache.put(e.request, r.clone());
          return r;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
