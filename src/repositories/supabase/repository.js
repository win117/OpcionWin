import boom from '@hapi/boom';
import config from '../../config/config';
import { resource, condiciones, patronBusqueda, idSeguro, filtroPurga, CAMPOS_BUSQUEDA } from '../resources';
import { createSupabaseTransport } from '../../config/supabase.config';
const normalize = row => row && ({ _id: row.id, owner_id: row.owner_id, document: row.document, revision: row.revision });
const ORDEN = { recientes: 'document->>createdAt.desc.nullslast,id.asc' };
// Dentro de or=(...) los valores van entre comillas, con \ y " escapados (sintaxis de PostgREST).
const citar = v => '"' + v.replace(/[\\"]/g, '\\$&') + '"';
// Texto que produce document->>campo para cada tipo (los arreglos, como los imprime jsonb).
const comoTexto = v => v instanceof Date ? v.toISOString() : Array.isArray(v) ? '[' + v.map(x => JSON.stringify(x)).join(', ') + ']' : String(v);
// El total exacto llega en la cabecera Content-Range ("0-0/1234"), no en el cuerpo.
export async function fetchTotal(url, opciones) {
  const r = await fetch(url, opciones);
  if (!r.ok) return r;
  await r.body?.cancel();
  return Response.json(Number(r.headers.get('content-range')?.split('/')[1]));
}
export function supabaseRepository(name, owner, transport = createSupabaseTransport(), transporteTotal = createSupabaseTransport(config, fetchTotal)) {
  const table = resource(name).table;
  const scope = { owner_id: 'eq.' + owner };
  // Consulta con alcance de dueño; null si ningún registro puede coincidir.
  const consulta = (filtro, busqueda) => {
    const iguales = condiciones(name, filtro);
    if (!iguales) return null;
    const query = { ...scope };
    for (const [k, v] of iguales) query['document->>' + k] = 'eq.' + comoTexto(v);
    if (busqueda) query.or = '(' + CAMPOS_BUSQUEDA.map(k => 'document->>' + k + '.imatch.' + citar(patronBusqueda(busqueda))).join(',') + ')';
    return query;
  };
  return {
    // Mismo contrato que el repositorio MongoDB.
    async list({ offset = 0, limit = 50, filtro, busqueda, orden } = {}) {
      const query = consulta(filtro, busqueda);
      if (!query) return [];
      return (await transport(table, 'GET', { ...query, order: ORDEN[orden] || 'id.asc', offset, limit })).map(normalize);
    },
    async count({ filtro, busqueda } = {}) {
      const query = consulta(filtro, busqueda);
      if (!query) return 0;
      const total = await transporteTotal(table, 'GET', { ...query, select: 'id', limit: 1 }, undefined, { Prefer: 'count=exact' });
      if (!Number.isSafeInteger(total)) throw boom.serverUnavailable('Supabase no devolvió el total de registros.');
      return total;
    },
    async referenciado(rutas, id, excepto) {
      // Contención jsonb: {"componentes":[{"contratoId":"…"}]} cubre campos simples, subdocumentos y arreglos.
      const contiene = ruta => JSON.stringify(ruta.reduceRight((valor, s) => ({ [s.campo]: s.arreglo ? [valor] : valor }), idSeguro(id)));
      const rows = await transport(table, 'GET', { ...scope, ...(excepto ? { id: 'neq.' + idSeguro(excepto) } : {}), select: 'id', limit: 1,
        or: '(' + rutas.map(r => 'document.cs.' + citar(contiene(r))).join(',') + ')' });
      return rows.length > 0;
    },
    async purgar({ antesDe, filtro }) {
      const query = { ...scope, 'document->>createdAt': 'lt.' + antesDe.toISOString() };
      for (const [k, v] of filtroPurga(name, filtro)) query['document->>' + k] = 'eq.' + v;
      await transport(table, 'DELETE', query, undefined, { Prefer: 'return=minimal' });
    },
    async get(id) { return normalize((await transport(table, 'GET', { ...scope, id: 'eq.' + idSeguro(id), limit: 1 }))[0]); },
    async create(document) {
      const rows = await transport(table, 'POST', {}, { id: document._id, owner_id: owner, document, revision: 1 });
      return normalize(rows[0]);
    },
    async replace(id, document, revision) {
      const rows = await transport(table, 'PATCH', { ...scope, id: 'eq.' + idSeguro(id), revision: 'eq.' + revision }, { document, revision: revision + 1 });
      if (!rows.length) throw boom.conflict('El registro cambió. Consulta de nuevo antes de editar.');
      return normalize(rows[0]);
    },
    // Upsert en bloque: consulta revisiones existentes (sin filtro de dueño, para rechazar ids ajenos) y envía lotes.
    async upsertMany(documents) {
      for (let i = 0; i < documents.length; i += 100) {
        const chunk = documents.slice(i, i + 100);
        const existing = await transport(table, 'GET', { select: 'id,owner_id,revision', id: 'in.(' + chunk.map(d => d._id).join(',') + ')' });
        if (existing.some(r => r.owner_id !== owner)) throw boom.conflict('Identificador en uso por otro registro.');
        const rev = new Map(existing.map(r => [r.id, r.revision]));
        await transport(table, 'POST', { on_conflict: 'id' },
          chunk.map(document => ({ id: document._id, owner_id: owner, document, revision: (rev.get(document._id) || 0) + 1 })),
          { Prefer: 'return=minimal,resolution=merge-duplicates' });
      }
      return documents.length;
    },
    async remove(id, revision) {
      const rows = await transport(table, 'DELETE', { ...scope, id: 'eq.' + idSeguro(id), revision: 'eq.' + revision });
      if (!rows.length) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
