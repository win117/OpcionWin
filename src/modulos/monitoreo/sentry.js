// Envío opcional de errores a Sentry por su API HTTP de envelopes, sin SDK (openspec: monitoreo-servicio «Envío
// opcional a Sentry»). En segundo plano, con tope de 3 s y como máximo 1 evento por huella cada 60 s. Nunca lanza.
import { randomBytes } from 'node:crypto';

export function parsearDsn(dsn) {
  try {
    const u = new URL(dsn);
    const proyecto = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !proyecto) return null;
    return { clave: u.username, url: `${u.protocol}//${u.host}/api/${proyecto}/envelope/` };
  } catch { return null; }
}

export function createSentry({ dsn = '', fetch: fetchFn = globalThis.fetch, entorno = process.env.NODE_ENV || 'production', ahora = () => Date.now(), esperaMs = 60000 } = {}) {
  const destino = dsn ? parsearDsn(dsn) : null;
  const ultimoEnvio = new Map();
  return {
    activo: Boolean(destino),
    enviar(grupo, { requestId } = {}) {
      if (!destino || typeof fetchFn !== 'function') return Promise.resolve(false);
      const t = ahora();
      if (t - (ultimoEnvio.get(grupo.huella) || -Infinity) < esperaMs) return Promise.resolve(false);
      ultimoEnvio.set(grupo.huella, t);
      const eventId = randomBytes(16).toString('hex');
      const evento = {
        event_id: eventId, timestamp: t / 1000, platform: 'node', level: 'error', environment: entorno, logger: 'apprestopciones',
        exception: { values: [{ type: grupo.tipo, value: grupo.mensaje }] }, // mensaje ya normalizado y sin secretos
        tags: { ruta: grupo.ruta, ...(requestId ? { requestId } : {}) }, fingerprint: [grupo.huella],
      };
      const cuerpo = [JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(evento)].join('\n');
      return fetchFn(destino.url, {
        method: 'POST', body: cuerpo, signal: AbortSignal.timeout(3000),
        headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${destino.clave}, sentry_client=apprestopciones/1.0` },
      }).then(r => r.ok, () => false);
    },
  };
}
