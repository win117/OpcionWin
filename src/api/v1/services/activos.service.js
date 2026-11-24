// Búsqueda de activos de Alpaca con caché en memoria por proceso (la lista completa pesa ~1 MB).
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { todos } from './registros';

export const TTL_ACTIVOS_MS = 12 * 60 * 60 * 1000;

const normal = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Distancia de edición (Levenshtein) acotada: en cuanto supera `tope` devuelve tope + 1.
export function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const nueva = [i];
    for (let j = 1; j <= b.length; j += 1) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...nueva) > tope) return tope + 1;
    fila = nueva;
  }
  return fila[b.length];
}

// `ahora` (reloj) y `cache` ({ lista, expira }) son inyectables para controlarlos en pruebas.
export function createBusquedaActivos({ integraciones, factory = repository, ahora = Date.now, cache = {}, ttlMs = TTL_ACTIVOS_MS, universo } = {}) {
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
      const t = normal(texto);
      const puntuados = [], parecidos = [];
      for (const a of await activos()) {
        if (!a.negociable) continue;
        const simbolo = normal(a.simbolo), nombre = normal(a.nombre || ''), palabras = nombre.split(' ');
        const rango = simbolo === t ? 0 : simbolo.startsWith(t) ? 1 : nombre.startsWith(t) ? 2 : palabras.some(p => p.startsWith(t)) ? 3 : nombre.includes(t) ? 5 : null;
        if (rango != null) puntuados.push({ a, rango });
        else if (t.length >= 4 && a.opciones) {
          // Mal escrito («aple», «google» → GOOGL): una letra de diferencia (dos en textos largos) con el símbolo o la primera palabra.
          const tope = t.length >= 7 ? 2 : 1, d = Math.min(distancia(t, simbolo, tope), distancia(t, palabras[0], tope));
          if (d <= tope) parecidos.push({ a, rango: 4 + d / 10 });
        }
      }
      // A igual coincidencia, primero las empresas grandes del universo, luego las que tienen opciones. Los fondos apalancados quedan al final.
      const cap = x => universo?.capitalizacionDe?.(x.a.simbolo) || 0;
      const orden = x => (cap(x) ? Math.min(x.rango, 2) : x.rango);
      const todosOrden = [...puntuados, ...parecidos];
      todosOrden.sort((x, y) => (x.rango === 0 ? -1 : 0) - (y.rango === 0 ? -1 : 0) || orden(x) - orden(y) || cap(y) - cap(x) || Boolean(y.a.opciones) - Boolean(x.a.opciones) || x.a.simbolo.localeCompare(y.a.simbolo));
      puntuados.length = 0;
      puntuados.push(...todosOrden);
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
