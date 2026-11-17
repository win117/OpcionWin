// Ejecución asíncrona con estado persistido (ADR-003): pendiente → procesando → completada | fallida.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { crear, parchar } from './registros';
import { resource } from '../../../repositories/resources';

export function mensajeSeguro(error) {
  if (error?.name === 'IntegrationError') return error.mensaje || error.message;
  if (boom.isBoom(error)) return error.output.payload.message;
  return 'Error interno al ejecutar el trabajo.';
}

const conFin = (name, cambios) => resource(name).Model.schema.path('finalizadaEn') ? { ...cambios, finalizadaEn: new Date() } : cambios;

// ejecutar(registro) → cambios a guardar al completar.
export async function iniciarTrabajo({ name, ctx, datos, ejecutar, cola, factory = repository }) {
  const registro = await crear(name, ctx, { ...datos, estado: 'pendiente' }, factory);
  cola.encolar(registro._id, async () => {
    try {
      await parchar(name, ctx, registro._id, { estado: 'procesando' }, factory);
      const cambios = await ejecutar(registro);
      await parchar(name, ctx, registro._id, conFin(name, { ...cambios, estado: 'completada' }), factory);
    } catch (error) {
      if (!error?.name?.startsWith('Integration') && !boom.isBoom(error)) console.error('[trabajo]', name, registro._id, error);
      await parchar(name, ctx, registro._id, conFin(name, { estado: 'fallida', error: mensajeSeguro(error).slice(0, 1900) }), factory).catch(() => {});
    }
  });
  return registro;
}
