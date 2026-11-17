import boom from '@hapi/boom';
import { CORES } from '../models/shared';
import evaluations from './evaluaciones.service';
export function forCore(core) {
  if (!CORES.includes(core)) throw boom.notFound('Core desconocido.');
  return {
    list: (ctx, query) => evaluations.list(ctx, { ...query, core }),
    async get(ctx, id) {
      const result = await evaluations.get(ctx, id);
      if (result.core !== core) throw boom.notFound('Evaluación no encontrada en este core.');
      return result;
    },
    // Este CRUD administra evaluaciones guardadas; no ejecuta algoritmos.
    create: (ctx, body) => evaluations.create(ctx, { ...body, core }),
  };
}
