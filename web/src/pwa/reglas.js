// Reglas del service worker (openspec: aplicacion-web-pwa). Función pura y sin dependencias:
// el plugin de vite.config.js la incrusta tal cual en sw.js y tests/pwa.test.cjs la prueba sin navegador.
//
// Devuelve qué hacer con una solicitud:
//   null          → no se intercepta: va a la red como si no hubiera service worker (API, SSE, otros orígenes, no-GET…)
//   'cascara'     → archivo con hash de /assets/: caché primero, red si falta
//   'navegacion'  → página de la SPA: red primero, index.html precargado si no hay conexión

const RUTAS_EXCLUIDAS = ['/api/', '/health', '/sw.js'];

/**
 * @param {{ url: string, method?: string, mode?: string, accept?: string }} solicitud
 * @param {string} origenPropio  origen de la app, p. ej. self.location.origin
 * @returns {null | 'cascara' | 'navegacion'}
 */
export function decidirSolicitud(solicitud, origenPropio) {
  if ((solicitud.method || 'GET').toUpperCase() !== 'GET') return null;
  let url;
  try { url = new URL(solicitud.url); } catch { return null; }
  if (url.origin !== origenPropio) return null;
  const ruta = url.pathname;
  if (ruta === '/api' || RUTAS_EXCLUIDAS.some(r => ruta === r || ruta.startsWith(r))) return null;
  if ((solicitud.accept || '').includes('text/event-stream')) return null;
  if (solicitud.mode === 'navigate') return 'navegacion';
  if (ruta.startsWith('/assets/')) return 'cascara';
  return null;
}
