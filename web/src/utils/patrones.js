// Patrones de velas japonesas. Funciones puras. Describen la forma de una a tres velas en su contexto; no forman parte del puntaje.
// Entrada: velas [{ time, open, high, low, close }] ascendentes.
import { atrSerie, smaSerie } from './indicadores.js';

export const PATRONES = {
  doji: { nombre: 'Doji', corto: 'Doji', lado: 'info', texto: 'Abre y cierra casi igual: duda entre compradores y vendedores.' },
  martillo: { nombre: 'Martillo', corto: 'Mart.', lado: 'alcista', texto: 'Tras caer, los vendedores empujaron y los compradores recuperaron casi todo.' },
  martillo_invertido: { nombre: 'Martillo invertido', corto: 'M. inv.', lado: 'alcista', texto: 'Tras caer, los compradores probaron más arriba aunque no se quedaron.' },
  hombre_colgado: { nombre: 'Hombre colgado', corto: 'Colgado', lado: 'bajista', texto: 'Tras subir, apareció venta fuerte durante el día.' },
  estrella_fugaz: { nombre: 'Estrella fugaz', corto: 'Fugaz', lado: 'bajista', texto: 'Tras subir, probó más arriba y la rechazaron.' },
  envolvente_alcista: { nombre: 'Envolvente alcista', corto: 'Env. ↑', lado: 'alcista', texto: 'Una vela verde cubre por completo a la roja anterior.' },
  envolvente_bajista: { nombre: 'Envolvente bajista', corto: 'Env. ↓', lado: 'bajista', texto: 'Una vela roja cubre por completo a la verde anterior.' },
  harami_alcista: { nombre: 'Harami alcista', corto: 'Har. ↑', lado: 'alcista', texto: 'Tras una roja grande, una verde chica dentro de ella: la caída pierde fuerza.' },
  harami_bajista: { nombre: 'Harami bajista', corto: 'Har. ↓', lado: 'bajista', texto: 'Tras una verde grande, una roja chica dentro de ella: la subida pierde fuerza.' },
  penetrante: { nombre: 'Penetrante', corto: 'Pen. ↑', lado: 'alcista', texto: 'Abre más abajo y recupera más de la mitad de la vela roja anterior.' },
  nube_oscura: { nombre: 'Nube oscura', corto: 'Nube ↓', lado: 'bajista', texto: 'Abre más arriba y pierde más de la mitad de la vela verde anterior.' },
  estrella_manana: { nombre: 'Estrella de la mañana', corto: 'E. mañ.', lado: 'alcista', texto: 'Roja grande, vela pequeña y verde que recupera más de la mitad.' },
  estrella_tarde: { nombre: 'Estrella de la tarde', corto: 'E. tarde', lado: 'bajista', texto: 'Verde grande, vela pequeña y roja que pierde más de la mitad.' },
  tres_soldados: { nombre: 'Tres soldados blancos', corto: '3 sold.', lado: 'alcista', texto: 'Tres verdes seguidas con cierres cada vez más altos.' },
  tres_cuervos: { nombre: 'Tres cuervos negros', corto: '3 cuer.', lado: 'bajista', texto: 'Tres rojas seguidas con cierres cada vez más bajos.' },
};

const TENDENCIA = 5; // sesiones previas que deben confirmar que venía subiendo o bajando

/** Patrones de toda la serie: [{ time, i, tipo, lado }]. Como mucho uno por vela; mandan los de más velas. */
export function detectarPatrones(velas) {
  const atr = atrSerie(velas, 14), media = smaSerie(velas.map(v => v.close), 10), salida = [];
  const m = velas.map(v => ({ cuerpo: Math.abs(v.close - v.open), rango: v.high - v.low, sup: v.high - Math.max(v.open, v.close), inf: Math.min(v.open, v.close) - v.low, verde: v.close > v.open, roja: v.close < v.open, mitad: (v.open + v.close) / 2 }));
  const venia = (j, signo) => j - TENDENCIA >= 0 && media[j] != null && signo * (velas[j].close - velas[j - TENDENCIA].close) > 0 && signo * (velas[j].close - media[j]) > 0;
  for (let i = 14; i < velas.length; i++) {
    const a = atr[i - 1], v = velas[i], x = m[i], p = velas[i - 1], y = m[i - 1], q = velas[i - 2], w = m[i - 2];
    if (!(a > 0) || !(x.rango > 0)) continue;
    const grande = k => m[k].cuerpo >= 0.6 * a, bajaba = j => venia(j, -1), subia = j => venia(j, 1);
    let tipo = null;
    if (bajaba(i - 2) && w.roja && grande(i - 2) && y.cuerpo <= 0.35 * w.cuerpo && Math.max(p.open, p.close) < w.mitad && x.verde && v.close > w.mitad) tipo = 'estrella_manana';
    else if (subia(i - 2) && w.verde && grande(i - 2) && y.cuerpo <= 0.35 * w.cuerpo && Math.min(p.open, p.close) > w.mitad && x.roja && v.close < w.mitad) tipo = 'estrella_tarde';
    else if ([i - 2, i - 1, i].every(k => m[k].verde && m[k].cuerpo >= 0.5 * m[k].rango && m[k].cuerpo >= 0.4 * a) && v.close > p.close && p.close > q.close && p.open >= q.open && p.open <= q.close && v.open >= p.open && v.open <= p.close) tipo = 'tres_soldados';
    else if ([i - 2, i - 1, i].every(k => m[k].roja && m[k].cuerpo >= 0.5 * m[k].rango && m[k].cuerpo >= 0.4 * a) && v.close < p.close && p.close < q.close && p.open <= q.open && p.open >= q.close && v.open <= p.open && v.open >= p.close) tipo = 'tres_cuervos';
    else if (bajaba(i - 1) && y.roja && x.verde && v.open <= p.close && v.close >= p.open && x.cuerpo > y.cuerpo && y.cuerpo > 0.1 * a) tipo = 'envolvente_alcista';
    else if (subia(i - 1) && y.verde && x.roja && v.open >= p.close && v.close <= p.open && x.cuerpo > y.cuerpo && y.cuerpo > 0.1 * a) tipo = 'envolvente_bajista';
    else if (bajaba(i - 1) && y.roja && grande(i - 1) && x.verde && v.open < p.close && v.close > y.mitad && v.close < p.open) tipo = 'penetrante';
    else if (subia(i - 1) && y.verde && grande(i - 1) && x.roja && v.open > p.close && v.close < y.mitad && v.close > p.open) tipo = 'nube_oscura';
    else if (bajaba(i - 1) && y.roja && grande(i - 1) && x.verde && x.cuerpo <= 0.6 * y.cuerpo && v.open >= p.close && v.close <= p.open && x.cuerpo > 0.05 * a) tipo = 'harami_alcista';
    else if (subia(i - 1) && y.verde && grande(i - 1) && x.roja && x.cuerpo <= 0.6 * y.cuerpo && v.open <= p.close && v.close >= p.open && x.cuerpo > 0.05 * a) tipo = 'harami_bajista';
    else if (x.rango >= 0.6 * a && x.cuerpo > 0.1 * x.rango && x.inf >= 2 * x.cuerpo && x.sup <= 0.15 * x.rango) tipo = bajaba(i - 1) ? 'martillo' : subia(i - 1) ? 'hombre_colgado' : null;
    else if (x.rango >= 0.6 * a && x.cuerpo > 0.1 * x.rango && x.sup >= 2 * x.cuerpo && x.inf <= 0.15 * x.rango) tipo = bajaba(i - 1) ? 'martillo_invertido' : subia(i - 1) ? 'estrella_fugaz' : null;
    else if (x.rango >= 0.5 * a && x.cuerpo <= 0.1 * x.rango) tipo = 'doji';
    if (tipo) salida.push({ time: v.time, i, tipo, lado: PATRONES[tipo].lado });
  }
  return salida;
}

/**
 * Qué pasó después de cada patrón en el historial de esta empresa: { tipo: { n, aciertos (fracción), base (fracción), media } }.
 * «Acierto»: a `h` sesiones el precio fue hacia el lado del patrón. `base`: con qué frecuencia pasa eso en un día cualquiera; sin superarla,
 * el patrón no aporta nada.
 */
export function historialPatrones(velas, patrones, h = 5) {
  const ret = velas.map((v, i) => (i + h < velas.length ? velas[i + h].close / v.close - 1 : null)), validos = ret.filter(r => r != null);
  const sube = validos.length ? validos.filter(r => r > 0).length / validos.length : 0, baja = validos.length ? validos.filter(r => r < 0).length / validos.length : 0;
  const out = {};
  for (const p of patrones) {
    const r = ret[p.i];
    if (r == null || p.lado === 'info') continue;
    const signo = p.lado === 'alcista' ? 1 : -1, o = (out[p.tipo] ||= { n: 0, aciertos: 0, media: 0, base: signo > 0 ? sube : baja });
    o.n += 1; o.aciertos += signo * r > 0 ? 1 : 0; o.media += signo * r;
  }
  for (const o of Object.values(out)) { o.aciertos /= o.n; o.media /= o.n; }
  return out;
}

/** Recta de regresión de las últimas `n` velas (la pendiente que usa el core técnico): [{ time, value }]. */
export function rectaTendencia(velas, n = 20) {
  if (velas.length < n) return [];
  const v = velas.slice(-n), mx = (n - 1) / 2, my = v.reduce((a, x) => a + x.close, 0) / n;
  const b = v.reduce((a, x, i) => a + (i - mx) * (x.close - my), 0) / v.reduce((a, _x, i) => a + (i - mx) ** 2, 0);
  return v.map((x, i) => ({ time: x.time, value: my + b * (i - mx) }));
}

/** Vela del día con el mercado abierto, a partir de la ficha en vivo. Añade o actualiza la última; nunca inventa máximos ni mínimos. */
export function conVelaEnVivo(velas, vivo) {
  const { apertura, maximo, minimo, precio, abierto, actualizadoEn } = vivo || {};
  if (!abierto || !velas.length || ![apertura, maximo, minimo, precio].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)) return velas;
  const dia = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(t), ultima = velas.at(-1), hoy = dia(new Date(actualizadoEn || Date.now()));
  const nueva = { open: apertura, high: Math.max(maximo, precio, apertura), low: Math.min(minimo, precio, apertura), close: precio, volume: vivo.volumen || 0, enVivo: true };
  const diaUltima = dia(new Date(ultima.time * 1000 + 12 * 3600000));
  if (diaUltima === hoy) return [...velas.slice(0, -1), { ...ultima, ...nueva, high: Math.max(nueva.high, ultima.high), low: Math.min(nueva.low, ultima.low) }];
  if (hoy < diaUltima) return velas;
  return [...velas, { ...nueva, time: Date.parse(hoy + 'T00:00:00Z') / 1000 + (ultima.time % 86400) }];
}

/** Valor final de esa misma regresión en cada vela: la tendencia de 20 sesiones a lo largo de todo el histórico. */
export function curvaRegresion(velas, n = 20) {
  const out = [];
  for (let i = n - 1; i < velas.length; i++) out.push({ time: velas[i].time, value: rectaTendencia(velas.slice(i - n + 1, i + 1), n).at(-1).value });
  return out;
}
