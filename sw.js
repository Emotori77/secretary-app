// 最小のオフライン・シェル。/api/ は常にネットワークへ。
const C = 'rina-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((r) => { const c = r.clone(); caches.open(C).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});
