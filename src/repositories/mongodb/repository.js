import boom from '@hapi/boom';
import { connectMongo } from '../../config/database.config';
import { resource, condiciones, patronBusqueda, idSeguro, filtroPurga, CAMPOS_BUSQUEDA } from '../resources';
import { asegurarIndices } from './indices';
const ORDEN = { recientes: { 'document.createdAt': -1, _id: 1 } };
export function mongoRepository(name, owner, connect = connectMongo) {
  const table = resource(name).table;
  const collection = async () => {
    try {
      const c = (await connect()).db.collection(table);
      asegurarIndices(c, name); // en segundo plano: no retrasa ni hace fallar la operación
      return c;
    }
    catch { throw boom.serverUnavailable('MongoDB no está disponible.'); }
  };
  // Consulta con alcance de dueño; null si ningún registro puede coincidir.
  const consulta = (filtro, busqueda) => {
    const iguales = condiciones(name, filtro);
    if (!iguales) return null;
    const query = { owner_id: owner };
    for (const [k, v] of iguales) query['document.' + k] = { $eq: v };
    if (busqueda) query.$or = CAMPOS_BUSQUEDA.map(k => ({ ['document.' + k]: { $regex: patronBusqueda(busqueda), $options: 'i' } }));
    return query;
  };
  return {
    // filtro: igualdad sobre campos de primer nivel del documento (claves validadas en filtroSeguro).
    // busqueda: texto en CAMPOS_BUSQUEDA. orden 'recientes': createdAt descendente; por defecto, _id.
    async list({ offset = 0, limit = 50, filtro, busqueda, orden } = {}) {
      const query = consulta(filtro, busqueda);
      if (!query) return [];
      return (await collection()).find(query).sort(ORDEN[orden] || { _id: 1 }).skip(offset).limit(limit).toArray();
    },
    async count({ filtro, busqueda } = {}) {
      const query = consulta(filtro, busqueda);
      return query ? (await collection()).countDocuments(query) : 0;
    },
    // ¿Algún registro (distinto de `excepto`) apunta a id? rutas: ver rutasReferencia.
    async referenciado(rutas, id, excepto) {
      const query = { owner_id: owner, ...(excepto ? { _id: { $ne: idSeguro(excepto) } } : {}),
        $or: rutas.map(r => ({ ['document.' + r.map(s => s.campo).join('.')]: idSeguro(id) })) };
      return Boolean(await (await collection()).findOne(query, { projection: { _id: 1 } }));
    },
    // Retención: borra lo creado antes de la fecha (solo lo que permite filtroPurga).
    async purgar({ antesDe, filtro }) {
      const query = { owner_id: owner, 'document.createdAt': { $lt: antesDe } };
      for (const [k, v] of filtroPurga(name, filtro)) query['document.' + k] = v;
      await (await collection()).deleteMany(query);
    },
    async get(id) { return (await collection()).findOne({ _id: idSeguro(id), owner_id: owner }); },
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
        const result = await (await collection()).replaceOne({ _id: idSeguro(id), owner_id: owner, revision }, row);
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
      const result = await (await collection()).deleteOne({ _id: idSeguro(id), owner_id: owner, revision });
      if (!result.deletedCount) throw boom.conflict('El registro cambió. Consulta de nuevo.');
    },
  };
}
