// Indicadores técnicos como funciones puras. Entrada: velas [{ time, open, high, low, close, volume }] ascendentes.
// Cada serie devuelve un arreglo alineado con la entrada; `null` donde aún no hay datos suficientes.
const esNum = v => typeof v === 'number' && Number.isFinite(v);

export function emaSerie(valores, n) {
  const out = new Array(valores.length).fill(null);
  if (valores.length < n) return out;
  const k = 2 / (n + 1);
  let prev = valores.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < valores.length; i++) { prev = valores[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function smaSerie(valores, n) {
  const out = new Array(valores.length).fill(null);
  let suma = 0;
  valores.forEach((v, i) => {
    suma += v;
    if (i >= n) suma -= valores[i - n];
    if (i >= n - 1) out[i] = suma / n;
  });
  return out;
}

/** RSI de Wilder. */
export function rsiSerie(cierres, n = 14) {
  const out = new Array(cierres.length).fill(null);
  if (cierres.length <= n) return out;
  let gan = 0, per = 0;
  for (let i = 1; i <= n; i++) { const d = cierres[i] - cierres[i - 1]; if (d >= 0) gan += d; else per -= d; }
  gan /= n; per /= n;
  const rsi = () => (per === 0 ? (gan === 0 ? 50 : 100) : 100 - 100 / (1 + gan / per));
  out[n] = rsi();
  for (let i = n + 1; i < cierres.length; i++) {
    const d = cierres[i] - cierres[i - 1];
    gan = (gan * (n - 1) + Math.max(d, 0)) / n;
    per = (per * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = rsi();
  }
  return out;
}

/** MACD (12, 26, 9): { macd, senal, hist } alineados. */
export function macdSerie(cierres, rapida = 12, lenta = 26, senal = 9) {
  const er = emaSerie(cierres, rapida), el = emaSerie(cierres, lenta);
  const macd = cierres.map((_, i) => (er[i] != null && el[i] != null ? er[i] - el[i] : null));
  const primero = macd.findIndex(v => v != null);
  const sen = new Array(cierres.length).fill(null);
  if (primero >= 0) {
    const e = emaSerie(macd.slice(primero), senal);
    e.forEach((v, i) => { sen[primero + i] = v; });
  }
  const hist = macd.map((v, i) => (v != null && sen[i] != null ? v - sen[i] : null));
  return { macd, senal: sen, hist };
}

/** Estocástico %K (n) y %D (media de %K en `d` velas). */
export function estocasticoSerie(velas, n = 14, d = 3) {
  const k = new Array(velas.length).fill(null);
  for (let i = n - 1; i < velas.length; i++) {
    const ventana = velas.slice(i - n + 1, i + 1);
    const hi = Math.max(...ventana.map(v => v.high)), lo = Math.min(...ventana.map(v => v.low));
    k[i] = hi === lo ? 50 : (100 * (velas[i].close - lo)) / (hi - lo);
  }
  const dd = new Array(velas.length).fill(null);
  for (let i = 0; i < velas.length; i++) {
    const w = k.slice(Math.max(0, i - d + 1), i + 1);
    if (w.length === d && w.every(esNum)) dd[i] = w.reduce((a, b) => a + b, 0) / d;
  }
  return { k, d: dd };
}

export function bollingerSerie(cierres, n = 20, desv = 2) {
  const medio = smaSerie(cierres, n);
  const sup = new Array(cierres.length).fill(null), inf = new Array(cierres.length).fill(null), pctB = new Array(cierres.length).fill(null);
  for (let i = n - 1; i < cierres.length; i++) {
    const w = cierres.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - medio[i]) ** 2, 0) / n);
    sup[i] = medio[i] + desv * sd; inf[i] = medio[i] - desv * sd;
    pctB[i] = sup[i] === inf[i] ? 0.5 : (cierres[i] - inf[i]) / (sup[i] - inf[i]);
  }
  return { medio, sup, inf, pctB };
}

/** ATR de Wilder. */
export function atrSerie(velas, n = 14) {
  const out = new Array(velas.length).fill(null);
  if (velas.length <= n) return out;
  const tr = velas.map((v, i) => (i === 0 ? v.high - v.low : Math.max(v.high - v.low, Math.abs(v.high - velas[i - 1].close), Math.abs(v.low - velas[i - 1].close))));
  let a = tr.slice(1, n + 1).reduce((x, y) => x + y, 0) / n;
  out[n] = a;
  for (let i = n + 1; i < velas.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}

/** Volatilidad histórica anualizada (desviación de retornos logarítmicos × √252) de los últimos `n` retornos. */
export function volatilidadHistorica(cierres, n = 20) {
  if (cierres.length < n + 1) return null;
  const r = [];
  for (let i = cierres.length - n; i < cierres.length; i++) r.push(Math.log(cierres[i] / cierres[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / n;
  const varianza = r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return Math.sqrt(varianza) * Math.sqrt(252);
}

const ultimo = serie => { for (let i = serie.length - 1; i >= 0; i--) if (serie[i] != null) return serie[i]; return null; };

/** Valores actuales de todos los indicadores (null si no hay velas suficientes). */
export function resumenIndicadores(velas) {
  const cierres = velas.map(v => v.close);
  const px = cierres.at(-1) ?? null;
  const macd = macdSerie(cierres), est = estocasticoSerie(velas), bol = bollingerSerie(cierres), atr = atrSerie(velas);
  const atrV = ultimo(atr);
  return {
    precio: px,
    rsi: ultimo(rsiSerie(cierres)),
    macd: ultimo(macd.macd), macdSenal: ultimo(macd.senal), macdHist: ultimo(macd.hist),
    estocasticoK: ultimo(est.k), estocasticoD: ultimo(est.d),
    bollingerSup: ultimo(bol.sup), bollingerMedio: ultimo(bol.medio), bollingerInf: ultimo(bol.inf), bollingerPctB: ultimo(bol.pctB),
    atr: atrV, atrPct: atrV != null && px ? (atrV / px) * 100 : null,
    hv20: volatilidadHistorica(cierres, 20), hv60: volatilidadHistorica(cierres, 60),
    sma20: ultimo(smaSerie(cierres, 20)), sma50: ultimo(smaSerie(cierres, 50)), sma200: ultimo(smaSerie(cierres, 200)),
  };
}
