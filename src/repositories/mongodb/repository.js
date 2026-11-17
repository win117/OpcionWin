import boom from '@hapi/boom';
import { connectMongo } from '../../config/database.config';
import { resource } from '../resources';
export function mongoRepository(name, owner, connect = connectMongo) {
  const table = resource(name).table;
  const collection = async () => {
    try { return (await connect()).db.collection(table); }
    catch { throw boom.serverUnavailable('MongoDB no está disponible.'); }
  };
  return {
    async list({ offset = 0, limit = 50 } = {}) {
      return (await collection()).find({ owner_id: owner }).sort({ _id: 1 }).skip(offset).limit(limit).toArray();
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
    async remove(id, revision) {
      const result = await (await collection()).deleteOne({ _id: id, owner_id: owner, revision });
      if (!result.deletedCount) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
