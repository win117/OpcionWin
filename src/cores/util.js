// Utilidades matemáticas compartidas por los cores. Funciones puras y deterministas.
// Convención: las series vienen en orden ascendente (más antigua primero).
import { aplicarReglas } from './reglas.js';

export const esNumero = v => typeof v === 'number' && Number.isFinite(v);
export const clamp = (x, min = -1, max = 1) => Math.min(max, Math.max(min, x));
export const round = (x, decimales = 4) => {
  if (!esNumero(x)) return x;
  const f = 10 ** decimales;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
export const promedio = valores => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);

/** Fecha → milisegundos; null si no es válida. */
export const tiempo = valor => {
  if (valor == null || valor === '') return null;
  const t = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
  return Number.isFinite(t) ? t : null;
};
export const DIA_MS = 86400000;

/** Desviación estándar (muestral si muestral=true). */
export const desviacion = (valores, muestral = false) => {
  const n = valores.length;
  if (n < (muestral ? 2 : 1)) return null;
  const m = promedio(valores);
  const s = valores.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(s / (muestral ? n - 1 : n));
};

/** Serie SMA alineada con la entrada (null donde no hay datos suficientes). */
export const smaSerie = (valores, n) => {
  const out = new Array(valores.length).fill(null);
  let suma = 0;
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i];
    if (i >= n) suma -= valores[i - n];
    if (i >= n - 1) out[i] = suma / n;
  }
  return out;
};
/** Último valor de la SMA de n periodos. */
export const sma = (valores, n) => (valores.length >= n ? promedio(valores.slice(-n)) : null);

/** Serie EMA; semilla = SMA de los primeros n valores. */
export const emaSerie = (valores, n) => {
  const out = new Array(valores.length).fill(null);
  if (valores.length < n) return out;
  const k = 2 / (n + 1);
  let e = promedio(valores.slice(0, n));
  out[n - 1] = e;
  for (let i = n; i < valores.length; i++) {
    e = valores[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
};
export const ema = (valores, n) => {
  const s = emaSerie(valores, n);
  return s.length ? s[s.length - 1] : null;
};

/** RSI de Wilder. Requiere n+1 cierres. */
export const rsi = (cierres, n = 14) => {
  if (cierres.length < n + 1) return null;
  let ganancia = 0;
  let perdida = 0;
  for (let i = 1; i <= n; i++) {
    const d = cierres[i] - cierres[i - 1];
    if (d > 0) ganancia += d; else perdida -= d;
  }
  ganancia /= n;
  perdida /= n;
  for (let i = n + 1; i < cierres.length; i++) {
    const d = cierres[i] - cierres[i - 1];
    ganancia = (ganancia * (n - 1) + Math.max(d, 0)) / n;
    perdida = (perdida * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (perdida === 0) return ganancia === 0 ? 50 : 100;
  return 100 - 100 / (1 + ganancia / perdida);
};

/** MACD(rapida, lenta, senal). Requiere lenta + senal - 1 cierres. */
export const macd = (cierres, rapida = 12, lenta = 26, senal = 9) => {
  if (cierres.length < lenta + senal - 1) return null;
  const er = emaSerie(cierres, rapida);
  const el = emaSerie(cierres, lenta);
  const linea = [];
  for (let i = lenta - 1; i < cierres.length; i++) linea.push(er[i] - el[i]);
  const s = ema(linea, senal);
  const m = linea[linea.length - 1];
  return { macd: m, senal: s, histograma: m - s };
};

/** Estocástico %K(n) y %D (SMA d de %K). Requiere n + d - 1 velas. */
export const estocastico = (velas, n = 14, d = 3) => {
  if (velas.length < n + d - 1) return null;
  const ks = [];
  for (let i = velas.length - d; i < velas.length; i++) {
    const ventana = velas.slice(i - n + 1, i + 1);
    const max = Math.max(...ventana.map(v => v.maximo));
    const min = Math.min(...ventana.map(v => v.minimo));
    ks.push(max === min ? 50 : ((velas[i].cierre - min) / (max - min)) * 100);
  }
  return { k: ks[ks.length - 1], d: promedio(ks) };
};

/** Bandas de Bollinger (desviación poblacional). */
export const bollinger = (cierres, n = 20, k = 2) => {
  if (cierres.length < n) return null;
  const ventana = cierres.slice(-n);
  const media = promedio(ventana);
  const de = desviacion(ventana);
  const superior = media + k * de;
  const inferior = media - k * de;
  const ultimo = cierres[cierres.length - 1];
  return { media, superior, inferior, pctB: superior === inferior ? 0.5 : (ultimo - inferior) / (superior - inferior) };
};

/** ATR de Wilder. Requiere n+1 velas. */
export const atr = (velas, n = 14) => {
  if (velas.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < velas.length; i++) {
    const v = velas[i];
    const c = velas[i - 1].cierre;
    tr.push(Math.max(v.maximo - v.minimo, Math.abs(v.maximo - c), Math.abs(v.minimo - c)));
  }
  let a = promedio(tr.slice(0, n));
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
};

/** Volatilidad histórica anualizada: desviación muestral de retornos logarítmicos × √252. Requiere n+1 cierres. */
export const volatilidadHistorica = (cierres, n = 20, anual = 252) => {
  if (cierres.length < n + 1) return null;
  const c = cierres.slice(-(n + 1));
  const r = [];
  for (let i = 1; i < c.length; i++) {
    if (c[i] <= 0 || c[i - 1] <= 0) return null;
    r.push(Math.log(c[i] / c[i - 1]));
  }
  const de = desviacion(r, true);
  return de == null ? null : de * Math.sqrt(anual);
};

/** Pendiente por mínimos cuadrados con x = 0..n-1. */
export const pendienteRegresion = valores => {
  const n = valores.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = promedio(valores);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (valores[i] - my);
    den += (i - mx) ** 2;
  }
  return num / den;
};

/** Velas válidas (OHLC finitos), hasta fechaReferencia, en orden ascendente. */
export const limpiarVelas = (velas, fechaReferencia) => {
  const ref = tiempo(fechaReferencia);
  return (Array.isArray(velas) ? velas : [])
    .filter(v => v && ['apertura', 'maximo', 'minimo', 'cierre'].every(k => esNumero(v[k])) && tiempo(v.fecha) != null)
    .filter(v => ref == null || tiempo(v.fecha) <= ref)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => tiempo(a.v.fecha) - tiempo(b.v.fecha) || a.i - b.i)
    .map(x => x.v);
};

/**
 * Combina sub-señales { nombre, valor: -1..1|null, peso }.
 * sesgo = promedio ponderado de las calculables; cobertura = calculables / total;
 * confianza = cobertura × (0.5·consistencia + 0.5·intensidad).
 */
export const combinar = subsenales => {
  const total = subsenales.length;
  const validas = subsenales.filter(s => esNumero(s.valor) && s.peso > 0);
  const cobertura = total ? validas.length / total : 0;
  const sumaPeso = validas.reduce((a, s) => a + s.peso, 0);
  if (!validas.length || sumaPeso === 0) return { sesgo: null, confianza: 0, cobertura };
  const suma = validas.reduce((a, s) => a + s.peso * s.valor, 0);
  const sumaAbs = validas.reduce((a, s) => a + s.peso * Math.abs(s.valor), 0);
  const sesgo = clamp(suma / sumaPeso);
  const consistencia = sumaAbs === 0 ? 0 : Math.abs(suma) / sumaAbs;
  const intensidad = sumaAbs / sumaPeso;
  return { sesgo, confianza: clamp(cobertura * (0.5 * consistencia + 0.5 * intensidad), 0, 1), cobertura };
};

/**
 * Aplica la selección de señales del usuario (parametros.indicadores) a la lista de sub-señales de un core.
 * Si contiene al menos una señal de ESTE core, solo esas entran; si no (vacía o de otros cores) se usan todas.
 * Devuelve { senales, motivo } (motivo null cuando no hay selección aplicable).
 */
export const filtrarSenales = (lista, parametros) => {
  const sel = Array.isArray(parametros?.indicadores) ? parametros.indicadores : [];
  const propias = lista.filter(s => sel.includes(s.nombre));
  if (!propias.length) return { senales: lista, motivo: null };
  return { senales: propias, motivo: `Señales usadas: ${propias.map(s => s.nombre).join(', ')} (selección del usuario).` };
};

/** Métrica con valor finito redondeado; null si el valor no es finito (no se inventan datos). */
export const metrica = (nombre, valor, unidad, periodo) => {
  if (!esNumero(valor)) return null;
  const m = { nombre, valor: round(valor), unidad };
  if (periodo) m.periodo = periodo;
  return m;
};

/** Arma el resultado del contrato §1 y aplica las reglas del perfil. */
export const finalizar = ({ sesgo, confianza, cobertura, metricas = [], motivos = [], datosFaltantes = [], reglas = [], core }) => {
  const base = metricas.filter(Boolean);
  const s = esNumero(sesgo) ? clamp(sesgo) : null;
  const conf = esNumero(confianza) ? clamp(confianza, 0, 1) : 0;
  const cob = esNumero(cobertura) ? clamp(cobertura, 0, 1) : 0;
  const lista = [...base];
  if (s != null) lista.push(metrica('sesgo', s, 'indice'));
  lista.push(metrica('confianza', conf, 'fraccion'), metrica('cobertura', cob, 'fraccion'));
  const r = aplicarReglas({ sesgo: s, confianza: conf, metricas: lista, reglas, core });
  const final = lista.map(m => {
    if (m.nombre === 'sesgo') return { ...m, valor: round(r.sesgo) };
    if (m.nombre === 'confianza') return { ...m, valor: round(r.confianza) };
    return m;
  });
  // puntaje se deriva del sesgo ya redondeado para que puntaje = 50 + 50·sesgo sea exacto.
  const sesgoFinal = r.sesgo == null ? null : round(r.sesgo);
  return {
    sesgo: sesgoFinal,
    confianza: round(r.confianza),
    puntaje: sesgoFinal == null ? null : round(50 + 50 * sesgoFinal, 2),
    cobertura: round(cob),
    metricas: final,
    motivos: [...motivos, ...r.motivos],
    datosFaltantes: [...new Set([...datosFaltantes, ...r.datosFaltantes])],
    reglas: r.reglas,
  };
};
