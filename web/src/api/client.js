// Envoltura de fetch para la API REST. Agrega el token de sessionStorage,
// serializa JSON y convierte respuestas de error en ApiError con el mensaje del servidor.
const STORAGE_KEY = 'opciones.sesion';
export const API_PREFIX = '/api/v1';
export const SESSION_EXPIRED_EVENT = 'opciones:sesion-expirada';

export function readSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Función aún sin implementar en el servidor (404 de ruta o 501). */
export const esNoDisponible = error => error?.status === 404 || error?.status === 501;

export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? '?' + text : '';
}

function friendlyMessage(status, json) {
  const message = json?.message;
  if (status === 404 && (!message || message === 'Ruta no encontrada.')) {
    return 'Esta función aún no está disponible en el servidor (ruta no encontrada).';
  }
  if (status === 501 && !message) return 'Esta función aún no está implementada en el servidor.';
  if (message) return message;
  if (status === 429) return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return 'El servidor no pudo completar la operación (error ' + status + ').';
  return 'La solicitud falló (error ' + status + ').';
}

export async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const session = readSession();
  const url = path.startsWith('/health') ? path : API_PREFIX + path;
  const init = { method, headers: { Accept: 'application/json', ...headers }, signal };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (session?.token) init.headers.Authorization = 'Bearer ' + session.token;

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('No se pudo contactar al servidor. Verifica que la API esté en ejecución.', 0);
  }

  let json = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
  }

  if (response.status === 401 && session?.token) {
    writeSession(null);
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok) throw new ApiError(friendlyMessage(response.status, json), response.status, json);

  return {
    status: response.status,
    data: json && typeof json === 'object' && 'data' in json ? json.data : json,
    message: json?.message,
    etag: response.headers.get('ETag'),
  };
}

/**
 * Escucha el seguimiento de una orden (Server-Sent Events). Se usa fetch y no EventSource porque la API pide el token en una cabecera.
 * Resuelve con el motivo del fin ('final' | 'tiempo' | 'apagado') o null si la conexión se cortó.
 */
export async function seguirOrden(id, { signal, alEvento }) {
  const token = readSession()?.token;
  const r = await fetch(`${API_PREFIX}/ordenes/${encodeURIComponent(id)}/seguimiento`, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, signal });
  if (!r.ok || !r.body || !/text\/event-stream/.test(r.headers.get('Content-Type') || '')) throw new ApiError('No se pudo seguir la orden.', r.status);
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let pendiente = '', fin = null;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) return fin;
    pendiente += value;
    const bloques = pendiente.split('\n\n');
    pendiente = bloques.pop();
    for (const b of bloques) {
      const evento = /^event: (.+)$/m.exec(b)?.[1], datos = /^data: (.+)$/m.exec(b)?.[1];
      if (!evento || !datos) continue;
      const data = JSON.parse(datos);
      if (evento === 'fin') fin = data.motivo;
      alEvento(evento, data);
    }
  }
}

const unwrap = promise => promise.then(result => result.data);

export const api = {
  request,
  get: (path, options) => unwrap(request(path, options)),
  post: (path, body, options) => unwrap(request(path, { ...options, method: 'POST', body })),
  put: (path, body, options) => unwrap(request(path, { ...options, method: 'PUT', body })),
  del: (path, options) => unwrap(request(path, { ...options, method: 'DELETE' })),
};
