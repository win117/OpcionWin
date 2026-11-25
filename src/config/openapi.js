// OpenAPI sin escribir nada dos veces: las rutas CRUD salen de los modelos y las demás de api/v1/schemas (los mismos esquemas que validan).
import * as z from 'zod';
import { resources } from '../repositories/resources';
import { rutas } from '../api/v1/schemas';
import config from './config';

const SIN_CRUD = ['sesiones', 'screener'];
const SOLO_LECTURA = ['auditoria', 'posiciones'];
const ok = { description: 'Respuesta JSON', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: {} } } } } };
const cuerpoLibre = { required: true, content: { 'application/json': { schema: { type: 'object' } } } };
const pathId = name => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const operation = (summary, tag, params = [], hasBody = false) => ({ summary, tags: [tag], security: [{ bearerAuth: [] }], parameters: params, ...(hasBody ? { requestBody: cuerpoLibre } : {}),
  responses: { 200: ok, 201: ok, 400: { description: 'Datos inválidos' }, 401: { description: 'Sesión inválida' }, 404: { description: 'No encontrado' }, 409: { description: 'Conflicto' } } });

const esquemaJson = s => { const { $schema: _s, ...resto } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any', target: 'openapi-3.0' }); return resto; };
const parametros = (esquema, donde) => {
  if (!esquema) return [];
  const { properties = {}, required = [] } = esquemaJson(esquema);
  return Object.entries(properties).map(([name, { description, ...schema }]) => ({ name: name === 'idempotency-key' ? 'Idempotency-Key' : name, in: donde, required: donde === 'path' || required.includes(name), ...(description ? { description } : {}), schema }));
};
function documentar(d) {
  const params = parametros(d.params, 'path'), conocidos = new Set(params.map(p => p.name));
  for (const [, n] of d.ruta.matchAll(/:(\w+)/g)) if (!conocidos.has(n)) params.push(pathId(n));
  return { summary: d.resumen, tags: [d.grupo], security: d.publica ? [] : [{ bearerAuth: [] }],
    parameters: [...params, ...parametros(d.query, 'query'), ...parametros(d.headers, 'header')],
    ...(d.body ? { requestBody: { required: !d.body.safeParse(undefined).success, content: { 'application/json': { schema: esquemaJson(d.body) } } } } : {}),
    responses: { [d.exito]: d.exito === 204 ? { description: 'Hecho' } : ok, 400: { description: 'Datos inválidos' }, ...(d.publica ? {} : { 401: { description: 'Sesión inválida' } }),
      ...Object.fromEntries(Object.entries(d.errores).map(([codigo, description]) => [codigo, { description }])) } };
}

export function openapi() {
  const paths = {};
  const crud = (base, tag, params, child, escritura) => {
    const key = child ? 'childId' : 'id', item = base + '/{' + key + '}', p = [...params, pathId(key)];
    paths[base] = { get: operation('Listar', tag, params), ...(escritura ? { post: operation('Crear', tag, params, true) } : {}) };
    paths[item] = { get: operation('Consultar', tag, p), ...(escritura ? { put: operation('Reemplazar campos editables', tag, p, true), delete: operation('Eliminar', tag, p) } : {}) };
    if (!escritura) return;
    paths[base + '/lote'] = { post: operation('Crear varios: {items:[]}', tag, params, true), put: operation('Reemplazar varios: {items:[{id,datos}]}', tag, params, true) };
    paths[base + '/eliminacion-lote'] = { post: operation('Eliminar varios: {ids:[]}', tag, params, true) };
  };
  for (const [name, { Model }] of Object.entries(resources)) {
    if (SIN_CRUD.includes(name)) continue;
    const escritura = !SOLO_LECTURA.includes(name);
    crud('/' + name, name, [], false, escritura);
    for (const [field, type] of Object.entries(Model.schema.paths)) {
      if (!type.schema) continue;
      const base = '/' + name + '/{id}/' + field, params = [pathId('id')], editable = escritura && !(name === 'ordenes' && ['eventos', 'componentes'].includes(field));
      if (type.$isMongooseDocumentArray) crud(base, name, params, true, editable);
      else paths[base] = { get: operation('Consultar subdocumento', name, params), ...(editable ? { post: operation('Crear subdocumento', name, params, true), put: operation('Reemplazar subdocumento', name, params, true), delete: operation('Eliminar si el modelo lo permite', name, params) } : {}) };
    }
  }
  for (const d of rutas) {
    const path = d.ruta.replace(/:(\w+)/g, '{$1}');
    paths[path] = { ...paths[path], [d.metodo]: documentar(d) };
  }
  return { openapi: '3.0.3', info: { title: 'Plataforma de análisis de opciones', version: '2.1.0', description: 'CRUD dual MongoDB/PostgreSQL, datos de Alpaca, SEC y Tesoro de EE. UU., cinco cores, confluencia, selección y órdenes en paper (Alpaca y Webull).' },
    servers: [{ url: config.API_URL }], tags: [...new Set(rutas.map(d => d.grupo))].map(name => ({ name })), components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token opaco devuelto por POST /sesiones' } } }, paths };
}
