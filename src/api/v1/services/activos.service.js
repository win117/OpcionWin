// Búsqueda de activos de Alpaca con caché en memoria por proceso (la lista completa pesa ~1 MB).
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { todos } from './registros';

export const TTL_ACTIVOS_MS = 12 * 60 * 60 * 1000;

// `ahora` (reloj) y `cache` ({ lista, expira }) son inyectables para controlarlos en pruebas.
export function createBusquedaActivos({ integraciones, factory = repository, ahora = Date.now, cache = {}, ttlMs = TTL_ACTIVOS_MS } = {}) {
  let pendiente = null;
  async function activos() {
    if (cache.lista && ahora() < cache.expira) return cache.lista;
    if (!pendiente) pendiente = integraciones.alpaca.listarActivos()
      .then(lista => { cache.lista = lista; cache.expira = ahora() + ttlMs; return lista; })
      .finally(() => { pendiente = null; });
    return pendiente;
  }

  return {
    async buscar(ctx, q, limit) {
      const texto = typeof q === 'string' ? q.trim() : '';
      if (texto.length < 1 || texto.length > 20) throw boom.badRequest('q requerido: de 1 a 20 caracteres.');
      const n = Number(limit ?? 20);
      if (!Number.isSafeInteger(n) || n < 1 || n > 50) throw boom.badRequest('limit debe estar entre 1 y 50.');
      const t = texto.toLowerCase();
      const puntuados = [];
      for (const a of await activos()) {
        if (!a.negociable) continue;
        const simbolo = String(a.simbolo).toLowerCase();
        const rango = simbolo === t ? 0 : simbolo.startsWith(t) ? 1 : String(a.nombre || '').toLowerCase().includes(t) ? 2 : null;
        if (rango != null) puntuados.push({ a, rango });
      }
      puntuados.sort((x, y) => x.rango - y.rango || x.a.simbolo.localeCompare(y.a.simbolo));
      const total = puntuados.length;
      const elegidos = puntuados.slice(0, n).map(x => x.a);
      const registradas = new Map((elegidos.length ? await todos('empresas', ctx, undefined, factory) : []).map(e => [String(e.simbolo).toUpperCase(), e._id]));
      const items = elegidos.map(a => {
        const empresaId = registradas.get(String(a.simbolo).toUpperCase());
        return { simbolo: a.simbolo, nombre: a.nombre, mercado: a.mercado, opciones: Boolean(a.opciones), registrada: Boolean(empresaId), ...(empresaId ? { empresaId } : {}) };
      });
      return { items, total };
    },
  };
}
