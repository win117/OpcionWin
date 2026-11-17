import boom from '@hapi/boom';
import { connectMongo } from '../../config/database.config';
import { resource, filtroSeguro } from '../resources';
// TTL de sesiones: los documentos viven bajo `document.`, así que el índice del esquema (autoIndex apagado) no
// aplica. Se crea una vez por proceso en el primer acceso a la colección, sin bloquear ni fallar la operación.
let ttlSesiones = false;
async function asegurarTtlSesiones(c) {
  if (ttlSesiones) return;
  ttlSesiones = true;
  try { await c.createIndex({ 'document.expiraEn': 1 }, { expireAfterSeconds: 0 }); }
  catch { ttlSesiones = false; }
}
export function mongoRepository(name, owner, connect = connectMongo) {
  const table = resource(name).table;
  const collection = async () => {
    try {
      const c = (await connect()).db.collection(table);
      if (table === resource('sesiones').table) await asegurarTtlSesiones(c);
      return c;
    }
    catch { throw boom.serverUnavailable('MongoDB no está disponible.'); }
  };
  return {
    // filtro: igualdad sobre campos de primer nivel del documento (claves validadas en filtroSeguro).
    async list({ offset = 0, limit = 50, filtro } = {}) {
      const query = { owner_id: owner };
      for (const [k, v] of filtroSeguro(filtro)) query['document.' + k] = v;
      return (await collection()).find(query).sort({ _id: 1 }).skip(offset).limit(limit).toArray();
    },
    async get(id) { return (await collection()).findOne({ _id: id, owner_id: owner }); },
    async create(document) {
      const row = { _id: document._id, owner_id: owner, document, revision: 1 };
      try { await (await collection()).insertOne(row); } catch (e) {
        if (e.code === 11000) throw boom.conflict('El registro ya existe.');
        throw e;
      }
      return row;
    },
    async replace(id, document, revision) {
      const row = { _id: id, owner_id: owner, document, revision: revision + 1 };
      try {
        const result = await (await collection()).replaceOne({ _id: id, owner_id: owner, revision }, row);
        if (!result.matchedCount) throw boom.conflict('El registro cambió. Consulta de nuevo antes de editar.');
      } catch (e) { if (e.code === 11000) throw boom.conflict('El registro ya existe.'); throw e; }
      return row;
    },
    // Inserta o reemplaza en bloque (datos externos sincronizados). Incrementa revision.
    async upsertMany(documents) {
      const c = await collection();
      for (let i = 0; i < documents.length; i += 500) {
        const ops = documents.slice(i, i + 500).map(document => ({ updateOne: {
          filter: { _id: document._id, owner_id: owner }, update: { $set: { document }, $inc: { revision: 1 } }, upsert: true } }));
        try { await c.bulkWrite(ops, { ordered: false }); }
        catch (e) { if (e.code === 11000) throw boom.conflict('Identificador en uso por otro registro.'); throw e; }
      }
      return documents.length;
    },
    async remove(id, revision) {
      const result = await (await collection()).deleteOne({ _id: id, owner_id: owner, revision });
      if (!result.deletedCount) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
