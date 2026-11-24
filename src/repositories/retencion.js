// Retención por usuario (mejor esfuerzo): borra registros auxiliares antiguos. filtroPurga impide tocar cualquier otro recurso.
import { repository } from './index';
const DIA = 86400000;
// Se conserva lo de los últimos `dias` y, como máximo, los `max` registros más recientes.
export const RETENCION = [
  { name: 'auditoria', dias: 90, max: 5000 },
  { name: 'sincronizaciones', dias: 90, max: 2000 },
  { name: 'datos-mercado', filtro: { tipo: 'cotizacion' }, dias: 90, max: 10000 },
];
export function createRetencion({ factory = repository, reglas = RETENCION, ahora = Date.now, cadaMs = DIA } = {}) {
  const ultima = new Map(); // base:usuario → última ejecución (una vez al día por proceso)
  return async function aplicar(context) {
    const clave = context.database + ':' + context.userId, t = ahora();
    if (t - (ultima.get(clave) ?? -Infinity) < cadaMs) return;
    ultima.set(clave, t);
    for (const { name, filtro, dias, max } of reglas) {
      try {
        const repo = factory(name, context);
        const [tope] = await repo.list({ offset: max - 1, limit: 1, filtro, orden: 'recientes' });
        const masAntiguo = tope ? new Date(tope.document.createdAt).getTime() : NaN;
        const corte = Math.max(t - dias * DIA, Number.isFinite(masAntiguo) ? masAntiguo : 0);
        await repo.purgar({ antesDe: new Date(corte), filtro });
      } catch { /* se reintenta al día siguiente */ }
    }
  };
}
