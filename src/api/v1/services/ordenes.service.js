import boom from '@hapi/boom';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { repository } from '../../../repositories';
import { ESTADOS_TERMINALES } from './broker.service';
import { createCrudService, input } from './crud.service';
import { todos } from './registros';

// Campos que solo escribe el servidor al operar con el broker.
const ADMINISTRADOS = ['estado', 'ordenExternaId', 'eventos', 'cantidadEjecutada', 'precioPromedioEjecucion', 'huella'];
const plano = v => (v == null ? null : JSON.parse(JSON.stringify(v)));

// CRUD de órdenes: borradores editables hasta el primer envío; lo demás lo mueve el broker.
export function forRepository(factory = repository) {
  const crud = createCrudService('ordenes', factory);
  const leer = async (ctx, id) => {
    const row = await factory('ordenes', ctx).get(id);
    if (!row) throw boom.notFound('Registro no encontrado.');
    return row;
  };
  return {
    ...crud,
    // La clave puede elegirse al crear (es la misma que se enviará en Idempotency-Key); después no cambia.
    async create(ctx, body) {
      input(body);
      for (const campo of ADMINISTRADOS) if (campo in body) throw boom.badRequest('Campo administrado por el servidor: ' + campo);
      const idempotencyKey = body.idempotencyKey ?? randomUUID();
      if (typeof idempotencyKey !== 'string' || !/^[\w-]{8,128}$/.test(idempotencyKey)) throw boom.badRequest('idempotencyKey inválida (8-128 caracteres: letras, números, _ o -).');
      if ((await todos('ordenes', ctx, { idempotencyKey }, factory)).length) throw boom.conflict('Esa idempotencyKey ya pertenece a otra orden.');
      return crud.create(ctx, { ...body, idempotencyKey });
    },
    async update(ctx, id, body, revision) {
      input(body);
      const { document, revision: actual } = await leer(ctx, id);
      if (document.estado !== 'pendiente' || document.ordenExternaId || document.eventos?.length) throw boom.conflict('Solo se edita una orden pendiente que no se ha intentado enviar.');
      const fijos = {};
      for (const campo of [...ADMINISTRADOS, 'idempotencyKey']) {
        if (body[campo] != null && !isDeepStrictEqual(plano(body[campo]), plano(document[campo]))) throw boom.badRequest('Campo administrado por el servidor: ' + campo);
        if (document[campo] != null) fijos[campo] = document[campo];
      }
      return crud.update(ctx, id, { ...body, ...fijos }, revision ?? actual);
    },
    async remove(ctx, id) {
      const { document } = await leer(ctx, id);
      if (!ESTADOS_TERMINALES.includes(document.estado)) throw boom.conflict('Cancela la orden antes de eliminarla.');
      return crud.remove(ctx, id);
    },
  };
}
