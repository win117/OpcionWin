// Seguimiento de errores propio (openspec: monitoreo-servicio «Errores agrupados»): agrupa los 500 inesperados por
// huella = tipo + mensaje normalizado (sin ids, UUID ni números) + ruta. Mensajes sin secretos (ocultarSecretos).
import { ocultarSecretos } from '../../middlewares/errores.handler';

export const normalizarMensaje = mensaje => ocultarSecretos(String(mensaje ?? ''))
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
  .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
  .replace(/\d+(\.\d+)?/g, '#')
  .slice(0, 200);

export const huellaDe = (error, ruta) => `${error?.name || 'Error'}|${normalizarMensaje(error?.message)}|${ruta || 'sin_ruta'}`;

export function createErrores({ max = 200, ahora = () => new Date() } = {}) {
  const grupos = new Map();
  return {
    /** Registra un error; devuelve el grupo (con `nuevo: true` la primera vez). */
    capturar(error, { ruta, requestId } = {}) {
      const huella = huellaDe(error, ruta), cuando = ahora().toISOString();
      let g = grupos.get(huella), nuevo = false;
      if (!g) {
        if (grupos.size >= max) grupos.delete(grupos.keys().next().value);
        g = { huella, tipo: error?.name || 'Error', mensaje: normalizarMensaje(error?.message), ruta: ruta || 'sin_ruta', conteo: 0, primeraVez: cuando };
        grupos.set(huella, g); nuevo = true;
      }
      g.conteo += 1; g.ultimaVez = cuando; g.requestIdEjemplo = requestId || g.requestIdEjemplo;
      return { ...g, nuevo };
    },
    lista: () => [...grupos.values()].sort((a, b) => (a.ultimaVez < b.ultimaVez ? 1 : -1)),
    total: () => [...grupos.values()].reduce((n, g) => n + g.conteo, 0),
  };
}
