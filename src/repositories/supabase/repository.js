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
      const rows = await transport(table, 'DELETE', { ...scope, id: 'eq.' + id, revision: 'eq.' + revision });
      if (!rows.length) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
