import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { resources, resource } from '../../../repositories/resources';
import { reconciliarTrabajo, reconciliarTrabajos } from './trabajos-huerfanos.service';
const protectedFields = ['_id', 'id', 'usuarioId', 'createdAt', 'updatedAt', '_revision', 'owner_id'];
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw boom.badRequest('Se requiere un objeto JSON.');
  return value;
}
export function input(value) {
  object(value);
  for (const key of Object.keys(value)) if (protectedFields.includes(key) || key.startsWith('$') || key.includes('.')) throw boom.badRequest('Campo no editable: ' + key);
  return value;
}
export function safeDocument(row) {
  const value = structuredClone(row.document);
  delete value.tokenHash; delete value.credencialRef;
  return { ...value, _revision: row.revision };
}
export async function validated(name, value) {
  try {
    const doc = new (resource(name).Model)(value);
    await doc.validate();
    // Los secretos solo se conservan dentro del repositorio.
    return doc.toObject({ transform: false, depopulate: true });
  } catch (error) {
    if (['ValidationError', 'StrictModeError', 'CastError'].includes(error.name)) throw boom.badRequest(error.message);
    throw error;
  }
}
const entityResources = Object.fromEntries(Object.entries(resources).map(([name, { Model }]) => [Model.modelName, name]));
async function references(name, document, context, factory) {
  const visit = async (schema, value) => {
    for (const [key, type] of Object.entries(schema.paths)) {
      const item = value?.[key];
      if (item == null) continue;
      if (type.options.ref) {
        const target = entityResources[type.options.ref];
        if (target && !await factory(target, context).get(String(item))) throw boom.badRequest('Referencia inexistente o ajena: ' + key);
      } else if (type.schema) {
        for (const child of Array.isArray(item) ? item : [item]) await visit(type.schema, child);
      }
    }
  };
  await visit(resource(name).Model.schema, document);
  const arrays = name === 'confluencias' ? { evaluacionesIds: 'evaluaciones' } : name === 'selecciones' ? { empresasCandidatas: 'empresas' } : {};
  for (const [field, target] of Object.entries(arrays)) {
    for (const id of document[field] || []) if (!await factory(target, context).get(id)) throw boom.badRequest('Referencia inexistente o ajena: ' + field);
  }
}
export async function allRows(repo) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const page = await repo.list({ offset, limit: 500 });
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw boom.badRequest('Demasiados registros para esta consulta. Reduce el conjunto de datos.');
}
function hasReference(schema, value, targetModel, id) {
  return Object.entries(schema.paths).some(([key, type]) => {
    const item = value?.[key];
    if (item == null) return false;
    if (type.options.ref === targetModel && String(item) === id) return true;
    return type.schema && (Array.isArray(item) ? item : [item]).some(v => hasReference(type.schema, v, targetModel, id));
  });
}
export function createCrudService(name, factory = repository, { cola, ahora } = {}) {
  resource(name);
  const huerfanos = { factory, cola, ahora };
  return {
    async list(context, query = {}) {
      const allowed = new Set(['page', 'limit', 'search', ...Object.keys(resource(name).Model.schema.paths).filter(k => !['tokenHash','credencialRef','_id'].includes(k))]);
      for (const [key, value] of Object.entries(query)) {
        if (!allowed.has(key) || typeof value !== 'string') throw boom.badRequest('Filtro inválido: ' + key);
      }
      const page = Number(query.page || 1), limit = Number(query.limit || 50);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw boom.badRequest('Paginación inválida.');
      let rows = await allRows(factory(name, context));
      for (const [key, value] of Object.entries(query)) {
        if (['page','limit'].includes(key)) continue;
        if (key === 'search') rows = rows.filter(r => ['nombre','simbolo','titulo','descripcion'].some(k => String(r.document[k] || '').toLowerCase().includes(value.toLowerCase())));
        else rows = rows.filter(r => String(r.document[key]) === value);
      }
      // Más recientes primero (los _id son UUID aleatorios y no sirven como orden).
      const t = r => new Date(r.document.createdAt || 0).getTime() || 0;
      rows.sort((a, b) => t(b) - t(a) || String(a._id).localeCompare(String(b._id)));
      return { items: await reconciliarTrabajos(name, context, rows.slice((page-1)*limit, page*limit).map(safeDocument), huerfanos), page, limit, total: rows.length };
    },
    async get(context, id) {
      if (typeof id !== 'string' || !id) throw boom.badRequest('Identificador inválido.');
      const row = await factory(name, context).get(id);
      if (!row) throw boom.notFound('Registro no encontrado.');
      return reconciliarTrabajo(name, context, safeDocument(row), huerfanos);
    },
    async create(context, body) {
      input(body);
      const now = new Date();
      const owner = resource(name).Model.schema.path('usuarioId') ? { usuarioId: context.userId } : {};
      const document = await validated(name, { ...body, ...owner, createdAt: now, updatedAt: now });
      await references(name, document, context, factory);
      return safeDocument(await factory(name, context).create(document));
    },
    async update(context, id, body, expectedRevision) {
      input(body);
      const repo = factory(name, context), row = await repo.get(id);
      if (!row) throw boom.notFound('Registro no encontrado.');
      if (expectedRevision !== undefined && expectedRevision !== row.revision) throw boom.conflict('Versión desactualizada.');
      const owner = resource(name).Model.schema.path('usuarioId') ? { usuarioId: context.userId } : {};
      // PUT reemplaza todos los campos editables. Los obligatorios ausentes son error.
      const document = await validated(name, { ...body, ...owner, _id: id, createdAt: row.document.createdAt, updatedAt: new Date() });
      if (name === 'perfiles-analisis') document.version = (row.document.version || 1) + 1;
      await references(name, document, context, factory);
      return safeDocument(await repo.replace(id, document, row.revision));
    },
    async remove(context, id) {
      const repo = factory(name, context), row = await repo.get(id);
      if (!row) throw boom.notFound('Registro no encontrado.');
      for (const [other, { Model }] of Object.entries(resources)) {
        if (other === 'sesiones') continue;
        const rows = await allRows(factory(other, context));
        if (rows.some(r => !(other === name && r._id === id) && (
          hasReference(Model.schema, r.document, resource(name).Model.modelName, id) ||
          (name === 'evaluaciones' && other === 'confluencias' && r.document.evaluacionesIds?.includes(id)) ||
          (name === 'empresas' && other === 'selecciones' && r.document.empresasCandidatas?.includes(id))
        ))) throw boom.conflict('El registro está referenciado. Elimina o actualiza sus dependencias primero.');
      }
      await repo.remove(id, row.revision);
      return { _id: id, eliminado: true };
    },
  };
}
export async function batch(items, action) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw boom.badRequest('Envía de 1 a 100 elementos.');
  const results = [];
  for (let index = 0; index < items.length; index++) {
    try { results.push({ index, success: true, data: await action(items[index]), status: 200 }); }
    catch (error) {
      const known = boom.isBoom(error) ? error : boom.internal();
      results.push({ index, success: false, status: known.output.statusCode, message: known.output.payload.message });
    }
  }
  const exitosos = results.filter(r => r.success).length;
  return { success: exitosos === results.length, total: results.length, exitosos, fallidos: results.length - exitosos, results };
}
export function createChildService(name, field, factory = repository) {
  const schema = resource(name).Model.schema.path(field)?.schema;
  if (!schema) throw new Error('Subdocumento desconocido: ' + field);
  const parentCrud = createCrudService(name, factory);
  async function mutate(context, parentId, action) {
    const repo = factory(name, context), row = await repo.get(parentId);
    if (!row) throw boom.notFound('Registro padre no encontrado.');
    if (name === 'configuraciones' && row.document.estado !== 'borrador') throw boom.conflict('Solo se editan componentes de un borrador.');
    const next = structuredClone(row.document);
    const resultId = action(next[field] || (next[field] = []));
    next.updatedAt = new Date();
    if (name === 'perfiles-analisis') next.version = (next.version || 1) + 1;
    const document = await validated(name, next);
    await references(name, document, context, factory);
    const saved = await repo.replace(parentId, document, row.revision);
    return resultId ? (saved.document[field].find(v => v._id === resultId) || { _id: resultId, eliminado: true }) : saved.document[field].at(-1);
  }
  return {
    async list(context, id) { return (await parentCrud.get(context, id))[field] || []; },
    async get(context, id, childId) {
      const child = (await this.list(context, id)).find(v => v._id === childId);
      if (!child) throw boom.notFound('Subdocumento no encontrado.');
      return child;
    },
    create(context, id, body) {
      input(body);
      return mutate(context, id, items => { items.push(body); });
    },
    update(context, id, childId, body) {
      input(body);
      return mutate(context, id, items => {
        const at = items.findIndex(v => v._id === childId);
        if (at < 0) throw boom.notFound('Subdocumento no encontrado.');
        items[at] = { ...body, _id: childId };
        return childId;
      });
    },
    remove(context, id, childId) {
      return mutate(context, id, items => {
        const at = items.findIndex(v => v._id === childId);
        if (at < 0) throw boom.notFound('Subdocumento no encontrado.');
        items.splice(at, 1); return childId;
      });
    },
  };
}
