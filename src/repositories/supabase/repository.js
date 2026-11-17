import boom from '@hapi/boom';
import { resource, filtroSeguro } from '../resources';
import { createSupabaseTransport } from '../../config/supabase.config';
const normalize = row => row && ({ _id: row.id, owner_id: row.owner_id, document: row.document, revision: row.revision });
export function supabaseRepository(name, owner, transport = createSupabaseTransport()) {
  const table = resource(name).table;
  const scope = { owner_id: 'eq.' + owner };
  return {
    async list({ offset = 0, limit = 50, filtro } = {}) {
      const query = { ...scope, order: 'id.asc', offset, limit };
      for (const [k, v] of filtroSeguro(filtro)) query['document->>' + k] = 'eq.' + v;
      return (await transport(table, 'GET', query)).map(normalize);
    },
    async get(id) { return normalize((await transport(table, 'GET', { ...scope, id: 'eq.' + id, limit: 1 }))[0]); },
    async create(document) {
      const rows = await transport(table, 'POST', {}, { id: document._id, owner_id: owner, document, revision: 1 });
      return normalize(rows[0]);
    },
    async replace(id, document, revision) {
      const rows = await transport(table, 'PATCH', { ...scope, id: 'eq.' + id, revision: 'eq.' + revision }, { document, revision: revision + 1 });
      if (!rows.length) throw boom.conflict('El registro cambió. Consulta de nuevo antes de editar.');
      return normalize(rows[0]);
    },
    async remove(id, revision) {
      const rows = await transport(table, 'DELETE', { ...scope, id: 'eq.' + id, revision: 'eq.' + revision });
      if (!rows.length) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
