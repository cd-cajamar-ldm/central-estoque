/* Service Worker — Controle de Validade. Network-first (nunca esconde atualização);
   cache só como fallback offline. */
const CACHE_VERSION = 'validade-v9';
const PRECACHE_URLS = ['./', './index.html', './manifest.json', './css/theme.css', './css/acesso.css', './css/validade.css',
  './js/acesso.js', './js/app.js', './js/worker.js', './icons/icon-192.png', './brand/Logo_LDM_icon.png', './css/validade.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, {cache: 'no-store'}).then(res => { const cp = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, cp)); return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
