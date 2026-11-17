// Utilidades de series de velas: agregación por intervalo, rangos visibles y medias móviles.
// Las velas llevan `time` en segundos UTC, orden ascendente.

export const RANGOS = [
  { value: '1M', label: '1M', dias: 30 },
  { value: '3M', label: '3M', dias: 91 },
  { value: '6M', label: '6M', dias: 182 },
  { value: 'YTD', label: 'YTD' },
  { value: '1A', label: '1A', dias: 365 },
  { value: '3A', label: '3A', dias: 1096 },
  { value: '5A', label: '5A', dias: 1826 },
  { value: 'MAX', label: 'Máx' },
];

export const INTERVALOS = [
  { value: 'D', label: 'Diario' },
  { value: 'W', label: 'Semanal' },
  { value: 'M', label: 'Mensual' },
];

const DIA = 86400;

/** Rango visible {from,to} (segundos) para la clave dada; null = todo (Máx). */
export function rangoVisible(clave, velas) {
  if (!velas.length || clave === 'MAX') return null;
  const to = velas.at(-1).time;
  const first = velas[0].time;
  let from;
  if (clave === 'YTD') from = Date.UTC(new Date(to * 1000).getUTCFullYear(), 0, 1) / 1000;
  else from = to - (RANGOS.find(r => r.value === clave)?.dias || 182) * DIA;
  return { from: Math.max(from, first), to };
}

function claveBloque(time, intervalo) {
  const d = new Date(time * 1000);
  if (intervalo === 'M') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  // Semana que inicia el lunes (UTC).
  const dia = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia) / 1000;
}

/** Agrega velas diarias a semanales ('W') o mensuales ('M'). 'D' devuelve la misma serie. */
export function agregar(velas, intervalo) {
  if (intervalo !== 'W' && intervalo !== 'M') return velas;
  const out = [];
  let cur = null;
  for (const v of velas) {
    const t = claveBloque(v.time, intervalo);
    if (cur && cur.time === t) {
      cur.high = Math.max(cur.high, v.high);
      cur.low = Math.min(cur.low, v.low);
      cur.close = v.close;
      cur.volume += v.volume || 0;
    } else {
      cur = { time: t, open: v.open, high: v.high, low: v.low, close: v.close, volume: v.volume || 0 };
      out.push(cur);
    }
  }
  return out;
}

export function sma(velas, n) {
  const out = [];
  let suma = 0;
  velas.forEach((v, i) => {
    suma += v.close;
    if (i >= n) suma -= velas[i - n].close;
    if (i >= n - 1) out.push({ time: v.time, value: suma / n });
  });
  return out;
}

/** Fecha ISO (YYYY-MM-DD) de hace `anios` años. */
export function haceAnios(anios) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - anios);
  return d.toISOString().slice(0, 10);
}
