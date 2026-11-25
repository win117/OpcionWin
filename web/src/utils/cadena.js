// Cadena de opciones en pantalla: agrupar por strike, recortar alrededor del precio y mezclar cotizaciones nuevas.
import { cotizacionFiable, enSesion } from './estrategiasOrden.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Agrupa por strike: [{ strike, call, put }], de menor a mayor. */
export function porStrike(items = []) {
  const m = new Map();
  for (const it of items) {
    if (!isNum(it.strike)) continue;
    const row = m.get(it.strike) || { strike: it.strike };
    row[it.tipo === 'put' ? 'put' : 'call'] = it;
    m.set(it.strike, row);
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
}

/** Las `n` filas más cercanas al precio, la mitad a cada lado si las hay (0 = todas). */
export function cercanas(filas, precio, n) {
  if (!n || filas.length <= n || !isNum(precio)) return filas;
  const corte = filas.findIndex(f => f.strike >= precio), medio = corte < 0 ? filas.length : corte;
  const desde = Math.max(0, Math.min(medio - Math.floor(n / 2), filas.length - n));
  return filas.slice(desde, desde + n);
}

/** Cambio del último precio frente al cierre anterior; null si falta alguno o si el último es de hace más de 7 días. */
export function cambioPct(it) {
  if (!isNum(it?.ultimo) || !(it?.cierreAnterior > 0)) return null;
  if (it.ultimoFecha && Date.now() - Date.parse(it.ultimoFecha) > 7 * 86400000) return null;
  return it.ultimo / it.cierreAnterior - 1;
}

/** Vencimiento mensual (el más negociado): tercer viernes o, si ese viernes es feriado y no está en la lista, el jueves anterior. */
export function esMensual(v, lista = []) {
  const d = new Date(v + 'T00:00:00Z'), dia = d.getUTCDay(), n = d.getUTCDate();
  if (dia === 5) return n >= 15 && n <= 21;
  return dia === 4 && n >= 14 && n <= 20 && lista.length > 0 && !lista.includes(new Date(d.getTime() + 86400000).toISOString().slice(0, 10));
}

const CAMPOS = ['bid', 'ask', 'ultimo', 'ultimoFecha', 'cierreAnterior', 'volumen', 'volatilidadImplicita', 'fechaDato'];
/** Pone cotizaciones nuevas sobre los contratos. Fuera de horario no reemplaza la de la última sesión por una que no se puede operar. */
export function fusionarCotizaciones(items = [], nuevas = []) {
  const por = new Map(nuevas.map(q => [q.contratoExternoId, q]));
  return items.map(it => {
    const q = por.get(it.simbolo);
    if (!q) return it;
    const conserva = !enSesion(q.fechaDato) && cotizacionFiable(it) && enSesion(it.fechaDato);
    const campos = conserva ? ['ultimo', 'ultimoFecha'] : CAMPOS;
    const out = { ...it };
    for (const c of campos) if (q[c] != null) out[c] = q[c];
    if (!conserva && q.griegas && isNum(q.griegas.delta)) out.griegas = q.griegas;
    return out;
  });
}
