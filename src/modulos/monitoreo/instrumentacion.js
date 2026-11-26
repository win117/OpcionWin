// Middleware de instrumentación (openspec: monitoreo-servicio): mide cada solicitud, pone Server-Timing y, al terminar,
// la registra con la ruta como PATRÓN (/api/v1/empresas/:id), nunca la URL real (cardinalidad y privacidad).

// La única ruta con expresión regular es el respaldo de la SPA (app.js entrega index.html): una etiqueta legible.
const RUTA_REGEX = 'spa';

/** Patrón de la ruta que atendió la solicitud, o 'sin_ruta' (404, archivos estáticos, error antes del enrutador). */
export function rutaDe(req) {
  if (!req.route?.path) return 'sin_ruta';
  if (typeof req.route.path !== 'string') return RUTA_REGEX;
  const patron = req.route.path;
  const base = req.baseUrl || '';
  return (base + (patron === '/' && base ? '' : patron)) || '/';
}

// Los enrutadores montados con parámetros (p. ej. '/:id/componentes') dejan en baseUrl el valor REAL: se vuelve a poner
// el nombre del parámetro para no filtrar ids ni crear una serie por registro.
const basePatron = req => {
  const valores = new Map(Object.entries(req.params || {}).map(([k, v]) => [String(v), k]));
  return (req.baseUrl || '').split('/').map(seg => (valores.has(decodeURIComponentSeguro(seg)) ? ':' + valores.get(decodeURIComponentSeguro(seg)) : seg)).join('/');
};
const decodeURIComponentSeguro = s => { try { return decodeURIComponent(s); } catch { return s; } };
const unir = (base, patron) => (base || '') + (patron === '/' && base ? '' : patron) || '/';

export const instrumentar = monitoreo => (req, res, next) => {
  const inicio = process.hrtime.bigint();
  // El patrón completo solo existe en el instante en que Express asigna req.route (al coincidir la ruta): si después
  // hay un error, Express deshace req.baseUrl al salir de cada enrutador y el patrón quedaría incompleto ('/:id').
  let rutaActual;
  Object.defineProperty(req, 'route', {
    configurable: true, enumerable: true,
    get: () => rutaActual,
    set: valor => { rutaActual = valor; if (valor?.path != null) req.rutaMonitoreo = typeof valor.path === 'string' ? unir(basePatron(req), valor.path) : RUTA_REGEX; },
  });
  const ms = () => Number(process.hrtime.bigint() - inicio) / 1e6;
  // Server-Timing debe ir antes de que salgan las cabeceras: se intercepta writeHead.
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (!res.headersSent) { try { res.setHeader('Server-Timing', `app;dur=${ms().toFixed(1)}`); } catch { /* cabeceras ya enviadas */ } }
    return writeHead.apply(this, args);
  };
  // La ruta se toma en cuanto Express la conoce (antes de que un error deshaga baseUrl al salir del enrutador).
  res.on('finish', () => monitoreo.registrarSolicitud({ metodo: req.method, ruta: req.rutaMonitoreo || rutaDe(req), codigo: res.statusCode, ms: ms(), usuarioId: req.context?.userId, requestId: req.requestId }));
  next();
};
