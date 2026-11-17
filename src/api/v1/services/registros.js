// Operaciones internas del servidor sobre registros (no expuestas como CRUD).
// Validan con el modelo, respetan propietario y control de revisión.
import boom from '@hapi/boom';
import { createHash } from 'node:crypto';
import { repository } from '../../../repositories';
import { validated, safeDocument } from './crud.service';
import { resource } from '../../../repositories/resources';

// Identificador determinista para "upsert" de datos externos (misma vela, mismo contrato → mismo _id).
export function idDeterminista(...partes) {
  const h = createHash('sha256').update(partes.map(String).join('|')).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

export async function todos(name, ctx, filtro, factory = repository) {
  const repo = factory(name, ctx), rows = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await repo.list({ offset, limit: 500, filtro });
    rows.push(...page);
    if (page.length < 500) return rows.map(safeDocument);
  }
  throw boom.badRequest('Demasiados registros (' + name + '). Reduce el periodo o los símbolos.');
}

export async function obtener(name, ctx, id, factory = repository) {
  const row = id ? await factory(name, ctx).get(String(id)) : null;
  if (!row) throw boom.badRequest('Referencia inexistente o ajena: ' + name);
  return safeDocument(row);
}

function propietario(name, ctx) {
  return resource(name).Model.schema.path('usuarioId') ? { usuarioId: ctx.userId } : {};
}

export async function crear(name, ctx, datos, factory = repository) {
  const now = new Date();
  const doc = await validated(name, { ...datos, ...propietario(name, ctx), createdAt: now, updatedAt: now });
  return safeDocument(await factory(name, ctx).create(doc));
}

// Inserta o reemplaza por _id. Devuelve { registro, nuevo }.
export async function guardar(name, ctx, id, datos, factory = repository) {
  const repo = factory(name, ctx), row = await repo.get(id);
  if (!row) return { registro: await crear(name, ctx, { ...datos, _id: id }, factory), nuevo: true };
  const doc = await validated(name, { ...datos, ...propietario(name, ctx), _id: id, createdAt: row.document.createdAt, updatedAt: new Date() });
  return { registro: safeDocument(await repo.replace(id, doc, row.revision)), nuevo: false };
}

// Upsert en bloque validando cada documento. items: [{ id, datos }]. Datos externos: createdAt = momento de la sincronización.
export async function guardarLote(name, ctx, items, factory = repository) {
  if (!items.length) return 0;
  const repo = factory(name, ctx), now = new Date();
  const docs = [];
  for (const { id, datos } of items) docs.push(await validated(name, { ...datos, ...propietario(name, ctx), _id: id, createdAt: now, updatedAt: now }));
  if (repo.upsertMany) return repo.upsertMany(docs);
  for (const d of docs) await guardar(name, ctx, d._id, d, factory); // repositorio sin soporte de bloque
  return docs.length;
}

// Aplica cambios parciales con reintento ante conflicto de revisión.
export async function parchar(name, ctx, id, cambios, factory = repository) {
  const repo = factory(name, ctx);
  for (let intento = 0; intento < 4; intento++) {
    const row = await repo.get(id);
    if (!row) throw boom.notFound('Registro no encontrado.');
    const next = typeof cambios === 'function' ? cambios(structuredClone(row.document)) : { ...row.document, ...cambios };
    const doc = await validated(name, { ...next, _id: id, updatedAt: new Date() });
    try { return safeDocument(await repo.replace(id, doc, row.revision)); }
    catch (error) { if (!(boom.isBoom(error) && error.output.statusCode === 409) || intento === 3) throw error; }
  }
}
