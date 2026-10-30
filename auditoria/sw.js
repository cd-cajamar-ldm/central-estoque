/* ============================================================
   Service Worker — Central de Estoque (PWA offline-first)
   Precache do shell do app + runtime cache (stale-while-revalidate)
   para os CDNs (fontes e SheetJS) usados pelo módulo de auditoria.
   ============================================================ */
const CACHE_VERSION = 'central-estoque-v5';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './audit/audit-db.js',
  './audit/audit-rules.js',
  './audit/audit-worker.js',
  './audit/audit-app.js',
  './audit/audit.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './brand/Logo_LDM_hor_2.png',
  './brand/Logo_LDM_box.png',
  './brand/Logo_LDM_icon.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache=>cache.addAll(PRECACHE_URLS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if(isSameOrigin){
    // Network-first: sempre busca a versão mais nova do app; usa o cache
    // só como fallback offline. (Antes era cache-first e escondia updates.)
    event.respondWith(
      fetch(req).then(res=>{
        if(res && res.ok){
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c=>c.put(req, clone));
        }
        return res;
      }).catch(()=>caches.match(req))
    );
    return;
  }

  // CDN externo (SheetJS, fontes): stale-while-revalidate para funcionar offline após 1º uso
  event.respondWith(
    caches.open(CACHE_VERSION).then(cache=>
      cache.match(req).then(cached=>{
        const network = fetch(req).then(res=>{
          if(res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(()=>cached);
        return cached || network;
      })
    )
  );
});
