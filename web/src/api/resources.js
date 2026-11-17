import { api, qs } from './client';

const enc = encodeURIComponent;
// Campos que administra el servidor; un PUT que los incluya es rechazado.
const SERVER_FIELDS = ['_id', 'id', 'usuarioId', 'createdAt', 'updatedAt', '_revision', 'owner_id'];

export function editable(record = {}) {
  const copy = { ...record };
  for (const field of SERVER_FIELDS) delete copy[field];
  return copy;
}

export function childEditable(child = {}) {
  const { _id, ...rest } = child;
  return rest;
}

export function resource(base) {
  return {
    base,
    list: (params = {}) => api.get(base + qs(params)),
    get: id => api.get(`${base}/${enc(id)}`),
    create: body => api.post(base, body),
    // PUT reemplaza la representación editable completa; If-Match evita actualizaciones perdidas.
    update: (id, body, revision) => api.put(`${base}/${enc(id)}`, editable(body),
      revision ? { headers: { 'If-Match': `"${revision}"` } } : undefined),
    remove: id => api.del(`${base}/${enc(id)}`),
    createMany: items => api.post(`${base}/lote`, { items }),
    updateMany: items => api.put(`${base}/lote`, { items }),
    removeMany: ids => api.post(`${base}/eliminacion-lote`, { ids }),
    child(id, field) {
      const childBase = `${base}/${enc(id)}/${field}`;
      return {
        list: () => api.get(childBase),
        get: childId => api.get(`${childBase}/${enc(childId)}`),
        create: body => api.post(childBase, childEditable(body)),
        update: (childId, body) => api.put(`${childBase}/${enc(childId)}`, childEditable(body)),
        remove: childId => api.del(`${childBase}/${enc(childId)}`),
        removeMany: ids => api.post(`${childBase}/eliminacion-lote`, { ids }),
      };
    },
  };
}

export const empresas = resource('/empresas');
export const estrategias = resource('/estrategias');
export const configuraciones = resource('/configuraciones');
export const perfiles = resource('/perfiles-analisis');
export const brokers = resource('/brokers');
export const conexiones = resource('/conexiones-broker');
export const contratos = resource('/contratos');
export const noticias = resource('/noticias');
export const evaluaciones = resource('/evaluaciones');
export const selecciones = resource('/selecciones');
export const confluencias = resource('/confluencias');
export const ordenes = resource('/ordenes');
export const posiciones = resource('/posiciones');
export const sincronizaciones = resource('/sincronizaciones');
export const auditoria = resource('/auditoria');

/** Recorre páginas de 100 hasta obtener todos los registros (tope maxPages). */
export async function listAll(source, params = {}, maxPages = 20) {
  const fetcher = typeof source === 'function' ? source : source.list;
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetcher({ ...params, page, limit: 100 });
    const pageItems = data?.items || [];
    items.push(...pageItems);
    total = data?.total ?? items.length;
    if (items.length >= total || pageItems.length < 100) break;
  }
  return { items, total, truncated: items.length < total };
}

/**
 * Los repositorios ordenan por _id (UUID aleatorio), no por fecha.
 * Para mostrar "lo más reciente" se descargan las páginas y se ordena en el cliente.
 */
export async function listLatest(source, params = {}, { dateOf = r => r.createdAt, limit, maxPages = 20 } = {}) {
  const result = await listAll(source, params, maxPages);
  const time = r => { const t = Date.parse(dateOf(r)); return Number.isNaN(t) ? 0 : t; };
  const sorted = [...result.items].sort((a, b) => time(b) - time(a));
  return { ...result, items: limit ? sorted.slice(0, limit) : sorted };
}

const sym = simbolo => enc(String(simbolo).toUpperCase());

export const mercado = {
  panorama: params => api.get('/mercado/panorama' + qs(params)),
  historicos: (simbolo, params) => api.get(`/mercado/historicos/${sym(simbolo)}` + qs(params)),
  cotizaciones: (simbolo, params) => api.get(`/mercado/cotizaciones/${sym(simbolo)}` + qs(params)),
  fundamentales: (simbolo, params) => api.get(`/mercado/fundamentales/${sym(simbolo)}` + qs(params)),
  institucional: (simbolo, params) => api.get(`/mercado/institucional/${sym(simbolo)}` + qs(params)),
  snapshot: (contratoId, params) => api.get(`/mercado/opciones/${enc(contratoId)}/snapshot` + qs(params)),
  cotizacionEnVivo: simbolo => api.get(`/mercado/cotizaciones/${sym(simbolo)}/en-vivo`),
  cadena: (simbolo, params) => api.get(`/mercado/opciones/cadena/${sym(simbolo)}` + qs(params)),
  opcionesResumen: (simbolo, params) => api.get(`/mercado/opciones/resumen/${sym(simbolo)}` + qs(params)),
};

export const activos = {
  buscar: (q, limit = 20) => api.get('/activos/busqueda' + qs({ q, limit })),
};

export const cores = {
  catalogo: () => api.get('/cores/catalogo'),
};

// Endpoints de acción (contratos.md §5).
export const acciones = {
  integraciones: () => api.get('/integraciones/estado'),
  sincronizar: body => api.post('/sincronizaciones/ejecuciones', body),
  evaluarCore: (core, body) => api.post(`/cores/${enc(core)}/evaluaciones`, body),
  evaluacionesCore: (core, params) => api.get(`/cores/${enc(core)}/evaluaciones` + qs(params)),
  seleccionar: body => api.post('/selecciones/ejecuciones', body),
  confluir: body => api.post('/confluencias/ejecuciones', body),
  evaluarConfiguracion: (id, body) => api.post(`/configuraciones/${enc(id)}/evaluaciones`, body),
  enviarOrden: (id, idempotencyKey) => api.post(`/ordenes/${enc(id)}/envio`, undefined, { headers: { 'Idempotency-Key': idempotencyKey } }),
  cancelarOrden: id => api.post(`/ordenes/${enc(id)}/cancelacion`),
  verificarConexion: id => api.post(`/conexiones-broker/${enc(id)}/verificacion`),
};

// Rutas de consulta para trabajos asíncronos (202 + sondeo).
export const jobPaths = {
  sincronizacion: id => `/sincronizaciones/${enc(id)}`,
  evaluacionCore: (core, id) => `/cores/${enc(core)}/evaluaciones/${enc(id)}`,
  evaluacion: id => `/evaluaciones/${enc(id)}`,
  seleccion: id => `/selecciones/${enc(id)}`,
  confluencia: id => `/confluencias/${enc(id)}`,
};

export const sesiones = {
  login: body => api.post('/sesiones', body),
  actual: () => api.get('/sesiones/actual'),
  logout: () => api.del('/sesiones/actual'),
};

// Operación directa en Alpaca PAPER (ticket de orden, cartera y cierre de posiciones).
export const operacion = {
  asegurarConexion: () => api.post('/broker/paper/conexion'),
  resumen: () => api.get('/broker/paper/resumen'),
  ticket: (body, key) => api.post('/ordenes/ticket', body, { headers: { 'Idempotency-Key': key } }),
  cerrarPosicion: (id, body, key) => api.post(`/posiciones/${enc(id)}/cierre`, body, { headers: { 'Idempotency-Key': key } }),
  orden: id => api.get(`/ordenes/${enc(id)}`),
};
