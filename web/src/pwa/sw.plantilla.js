/* global decidirSolicitud, __VERSION__, __PRECACHE__, clients */
// Plantilla del service worker (openspec: aplicacion-web-pwa). No se importa desde la app: el plugin de
// web/vite.config.js la convierte en dist/sw.js en cada compilación, reemplazando sus tres marcadores por
// la versión (hash de la compilación, nombre de la caché), la lista de precarga ('/', '/index.html', '/assets/…')
// y el código de reglas.js (decidirSolicitud).
// Nunca intercepta la API, /health, SSE, otros orígenes ni métodos distintos de GET (ver reglas.js).

// __REGLAS__

const PREFIJO = 'winopciones-';
const CACHE = PREFIJO + __VERSION__;
const PRECACHE = __PRECACHE__;

// Instalar: precarga la cáscara de esta versión. Sin skipWaiting: la versión nueva espera a que el usuario la active.
self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))));
});

// Activar: borra solo las cachés de versiones anteriores de este service worker y toma el control de las pestañas.
self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n.startsWith(PREFIJO) && n !== CACHE).map(n => caches.delete(n)));
    await clients.claim();
  })());
});

// La web pide activar la versión en espera cuando el usuario pulsa «Recargar».
self.addEventListener('message', evento => {
  if (evento.data && evento.data.tipo === 'activar') self.skipWaiting();
});

self.addEventListener('fetch', evento => {
  const r = evento.request;
  const tipo = decidirSolicitud({ url: r.url, method: r.method, mode: r.mode, accept: r.headers.get('accept') || '' }, self.location.origin);
  if (tipo === 'cascara') {
    // Archivos con hash: nunca cambian de contenido. Caché de esta versión primero; si falta, la red.
    evento.respondWith(caches.match(r, { cacheName: CACHE }).then(guardada => guardada || fetch(r)));
  } else if (tipo === 'navegacion') {
    // Red primero para ver siempre lo publicado; sin conexión, el index.html precargado de esta versión.
    evento.respondWith(fetch(r).catch(async () => (await caches.match('/index.html', { cacheName: CACHE })) || Response.error()));
  }
  // null: no se llama a respondWith y el navegador la resuelve como si no hubiera service worker.
});
