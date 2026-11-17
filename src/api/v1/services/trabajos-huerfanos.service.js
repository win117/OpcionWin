// Trabajos huérfanos (ADR-003): un reinicio del servidor (p. ej. Render) pierde la cola en memoria y deja registros
// en 'pendiente'/'procesando' para siempre. Al leerlos se marcan 'fallida' si superan el tiempo máximo y no están activos.
import { resource } from '../../../repositories/resources';
import { colaGlobal } from '../../../jobs/cola';
import { parchar } from './registros';

export const TIEMPO_MAX_TRABAJO_MS = 15 * 60 * 1000;
export const ERROR_TRABAJO_INTERRUMPIDO = 'Trabajo interrumpido (servidor reiniciado o tiempo agotado). Vuelve a ejecutarlo.';

export const esRecursoDeTrabajo = name => resource(name).Model.schema.path('estado')?.enumValues?.includes('procesando') === true;

// Devuelve el registro (actualizado si se marcó fallida). Nunca lanza.
export async function reconciliarTrabajo(name, ctx, registro, { factory, cola = colaGlobal, ahora = () => new Date() } = {}) {
  try {
    if (!registro || !['pendiente', 'procesando'].includes(registro.estado) || !esRecursoDeTrabajo(name)) return registro;
    const edad = ahora().getTime() - new Date(registro.updatedAt || registro.createdAt || 0).getTime();
    if (!(edad > TIEMPO_MAX_TRABAJO_MS) || cola?.activo?.(registro._id)) return registro;
    const fin = resource(name).Model.schema.path('finalizadaEn') ? { finalizadaEn: ahora() } : {};
    return await parchar(name, ctx, registro._id, actual => (['pendiente', 'procesando'].includes(actual.estado)
      ? { ...actual, estado: 'fallida', error: ERROR_TRABAJO_INTERRUMPIDO, ...fin } : actual), factory);
  } catch { return registro; }
}

export async function reconciliarTrabajos(name, ctx, registros, opciones) {
  if (!esRecursoDeTrabajo(name)) return registros;
  return Promise.all(registros.map(r => reconciliarTrabajo(name, ctx, r, opciones)));
}
