const CACHE = 'planless-v1';
const SHELL = ['/', '/app', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Skip Supabase, Twilio, external API requests — always network
  if (url.hostname !== self.location.hostname) return;
  // Network-first for navigation (always fresh HTML)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/app').then(r => r || caches.match('/')))
    );
    return;
  }
  // Cache-first for static assets (JS/CSS/images)
  if (/\.(js|css|svg|png|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }))
    );
  }
});
