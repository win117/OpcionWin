// Cliente HTTP mínimo sobre fetch: tiempo límite, reintentos con espera exponencial
// para 429/5xx, limitador de ritmo (intervalo mínimo entre solicitudes) y
// traducción de fallos a IntegrationError. No registra encabezados ni cuerpos.
import { IntegrationError, redactar } from './errors';

// Sin unref: la espera debe mantener vivo el proceso (scripts, trabajos en segundo plano).
const esperarPorDefecto = ms => new Promise(resolve => { setTimeout(resolve, ms); });

export const construirQuery = (query = {}) => {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null || valor === '') continue;
    if (Array.isArray(valor)) {
      if (valor.length) params.set(clave, valor.join(','));
    } else params.set(clave, String(valor));
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

const codigoPorStatus = status => {
  if (status === 401) return 'SIN_CREDENCIALES';
  if (status === 404) return 'NO_ENCONTRADO';
  if (status === 429) return 'LIMITE';
  return 'PROVEEDOR';
};

const mensajePorStatus = status => ({
  400: 'Solicitud rechazada por el proveedor.',
  401: 'Credenciales inválidas o ausentes.',
  403: 'Acceso denegado por el proveedor (permisos, suscripción o identificación).',
  404: 'Recurso no encontrado en el proveedor.',
  422: 'El proveedor no pudo procesar la solicitud.',
  429: 'Límite de solicitudes del proveedor alcanzado.',
}[status] || (status >= 500 ? 'El proveedor no está disponible.' : 'Respuesta inesperada del proveedor.'));

const extraerDetalle = cuerpo => {
  if (!cuerpo) return '';
  if (typeof cuerpo === 'string') return cuerpo.trim().startsWith('<') ? '' : cuerpo.trim();
  return cuerpo.message || cuerpo.error || cuerpo.msg || '';
};

export const createHttp = ({
  proveedor,
  fetch: fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  reintentos = 2,
  esperaBaseMs = 500,
  intervaloMs = 0,
  esperar = esperarPorDefecto,
  ahora = () => Date.now(),
  secretos = [],
  headers: headersBase = {},
} = {}) => {
  if (typeof fetchFn !== 'function') throw new IntegrationError({ proveedor, codigo: 'RED', mensaje: 'No hay implementación de fetch disponible.' });
  let siguienteTurno = 0;

  // Reserva sincrónica del turno: seguro ante llamadas concurrentes.
  const turno = async () => {
    if (!intervaloMs) return;
    const t = ahora();
    const espera = Math.max(0, siguienteTurno - t);
    siguienteTurno = Math.max(t, siguienteTurno) + intervaloMs;
    if (espera > 0) await esperar(espera);
  };

  const error = (status, codigo, detalle) => new IntegrationError({
    proveedor, status, codigo,
    mensaje: redactar(detalle ? `${mensajePorStatus(status)} ${detalle}` : mensajePorStatus(status), secretos),
  });

  const unaVez = async ({ url, method, headers, body }) => {
    const controlador = typeof AbortController === 'function' ? new AbortController() : null;
    const temporizador = controlador ? setTimeout(() => controlador.abort(), timeoutMs) : null;
    if (typeof temporizador?.unref === 'function') temporizador.unref();
    try {
      return await fetchFn(url, { method, headers, body, signal: controlador?.signal });
    } catch (e) {
      const agotado = e?.name === 'AbortError' || e?.name === 'TimeoutError';
      throw new IntegrationError({
        proveedor, status: null, codigo: 'RED',
        mensaje: agotado ? `Tiempo de espera agotado (${timeoutMs} ms).` : 'Fallo de red al contactar al proveedor.',
      });
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  };

  const leer = async (res, respuesta) => {
    if (res.status === 204) return null;
    const texto = typeof res.text === 'function' ? await res.text() : (res.body ?? '');
    if (respuesta === 'text') return texto;
    if (!texto) return null;
    try {
      return JSON.parse(texto);
    } catch {
      throw new IntegrationError({ proveedor, status: res.status, codigo: 'PROVEEDOR', mensaje: 'Respuesta JSON inválida del proveedor.' });
    }
  };

  const request = async ({ url, method = 'GET', query, headers = {}, body, respuesta = 'json', reintentarServidor } = {}) => {
    const destino = `${url}${construirQuery(query)}`;
    const cabeceras = { Accept: respuesta === 'json' ? 'application/json' : '*/*', ...headersBase, ...headers };
    let cuerpo;
    if (body !== undefined) {
      cuerpo = JSON.stringify(body);
      cabeceras['Content-Type'] = 'application/json';
    }
    // Un POST solo se reintenta ante 429 (no procesado) para no duplicar órdenes.
    const reintenta5xx = reintentarServidor ?? (method === 'GET' || method === 'DELETE');
    for (let intento = 0; ; intento += 1) {
      await turno();
      const res = await unaVez({ url: destino, method, headers: cabeceras, body: cuerpo });
      if (res.ok || (res.status >= 200 && res.status < 300)) return leer(res, respuesta);
      const reintentable = res.status === 429 || (res.status >= 500 && reintenta5xx);
      if (reintentable && intento < reintentos) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const espera = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10000)
          : esperaBaseMs * 2 ** intento;
        await esperar(espera);
        continue;
      }
      let detalle = '';
      try {
        const texto = await leer(res, 'text');
        let contenido = texto;
        try { contenido = JSON.parse(texto); } catch { /* texto plano */ }
        detalle = extraerDetalle(contenido);
      } catch { /* sin detalle */ }
      throw error(res.status, codigoPorStatus(res.status), String(detalle).slice(0, 300));
    }
  };

  return { request };
};
