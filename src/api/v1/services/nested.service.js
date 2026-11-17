import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { createCrudService, input, validated } from './crud.service';
export function createNestedService(name, field, factory = repository) {
  const parent = createCrudService(name, factory);
  async function change(context, id, body, mode) {
    const repo = factory(name, context), row = await repo.get(id);
    if (!row) throw boom.notFound('Registro padre no encontrado.');
    const document = structuredClone(row.document);
    if (mode === 'create' && document[field] != null) throw boom.conflict('El subdocumento ya existe. Usa PUT.');
    if (mode !== 'create' && document[field] == null) throw boom.notFound('Subdocumento no encontrado.');
    if (mode === 'remove') delete document[field]; else document[field] = input(body);
    document.updatedAt = new Date();
    if (name === 'perfiles-analisis') document.version = (document.version || 1) + 1;
    const checked = await validated(name, document);
    if (mode === 'remove' && checked[field] != null) throw boom.conflict('Este campo tiene un valor predeterminado; utiliza PUT para restablecerlo.');
    await repo.replace(id, checked, row.revision);
    return mode === 'remove' ? { eliminado: true } : checked[field];
  }
  return {
    async get(context, id) {
      const document = await parent.get(context, id);
      if (document[field] == null) throw boom.notFound('Subdocumento no encontrado.');
      return document[field];
    },
    create: (c, id, b) => change(c, id, b, 'create'),
    update: (c, id, b) => change(c, id, b, 'update'),
    remove: (c, id) => change(c, id, null, 'remove'),
  };
}
