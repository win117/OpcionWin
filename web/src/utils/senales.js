// Soportes/resistencias, señales de compra/venta y confluencia calculados en el cliente. Funciones puras.
import { macdSerie, resumenIndicadores, rsiSerie, smaSerie } from './indicadores.js';

const esNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Soportes y resistencias por pivotes + agrupación por tolerancia.
 * 1) Pivotes: máximo (o mínimo) local respecto a `ventana` velas a cada lado.
 * 2) Agrupación: los pivotes cuyo precio dista ≤ `tolerancia` (fracción) de la media del grupo forman un nivel;
 *    el nivel es la media del grupo y `toques` el número de pivotes.
 *    Dos pivotes a menos de `ventana` velas son la misma visita: cuentan un toque.
 * 3) Se conservan los niveles con ≥ `minToques`; por encima del último cierre son resistencias, por debajo soportes.
 *    De cada lado: siempre el más cercano al precio y después los más tocados, hasta `maxPorLado`.
 * 4) Los extremos del periodo también frenan el precio aunque se hayan tocado una vez: si el máximo (o el mínimo) queda más allá
 *    de todos los niveles de su lado, se agrega con `extremo: true`.
 * Devuelve [{ precio, toques, tipo: 'resistencia'|'soporte', ultimoToque, extremo? }] de mayor a menor precio.
 */
export function soportesResistencias(velas, { ventana = 5, tolerancia = 0.015, minToques = 2, maxPorLado = 3, ultimas = 260 } = {}) {
  const v = velas.slice(-ultimas);
  if (v.length < ventana * 2 + 1) return [];
  const pivotes = [];
  for (let i = ventana; i < v.length - ventana; i++) {
    const w = v.slice(i - ventana, i + ventana + 1);
    if (v[i].high >= Math.max(...w.map(x => x.high))) pivotes.push({ precio: v[i].high, time: v[i].time, i });
    if (v[i].low <= Math.min(...w.map(x => x.low))) pivotes.push({ precio: v[i].low, time: v[i].time, i });
  }
  pivotes.sort((a, b) => a.precio - b.precio);
  const grupos = [];
  for (const p of pivotes) {
    const g = grupos.at(-1);
    if (g && Math.abs(p.precio - g.suma / g.items.length) / (g.suma / g.items.length) <= tolerancia) { g.items.push(p); g.suma += p.precio; }
    else grupos.push({ items: [p], suma: p.precio });
  }
  const visitas = items => [...items].sort((a, b) => a.i - b.i).reduce((r, p) => (r.ultima == null || p.i - r.ultima >= ventana ? { n: r.n + 1, ultima: p.i } : { ...r, ultima: p.i }), { n: 0, ultima: null }).n;
  const cierre = v.at(-1).close;
  const niveles = grupos
    .map(g => ({ precio: g.suma / g.items.length, toques: visitas(g.items), ultimoToque: Math.max(...g.items.map(p => p.time)) }))
    .filter(n => n.toques >= minToques)
    .map(n => ({ ...n, tipo: n.precio >= cierre ? 'resistencia' : 'soporte' }));
  const lado = tipo => {
    const alza = tipo === 'resistencia';
    const lista = niveles.filter(n => n.tipo === tipo).sort((a, b) => Math.abs(a.precio - cierre) - Math.abs(b.precio - cierre));
    const [cercano, ...resto] = lista;
    const elegidos = cercano ? [cercano, ...resto.sort((a, b) => b.toques - a.toques || Math.abs(a.precio - cierre) - Math.abs(b.precio - cierre)).slice(0, maxPorLado - 1)] : [];
    const vela = v.reduce((m, x) => ((alza ? x.high > m.high : x.low < m.low) ? x : m));
    const precio = alza ? vela.high : vela.low;
    const masAlla = alza ? precio > Math.max(cierre, ...lista.map(n => n.precio * (1 + tolerancia))) : precio < Math.min(cierre, ...lista.map(n => n.precio * (1 - tolerancia)));
    if (masAlla) elegidos.push({ precio, toques: 1, tipo, ultimoToque: vela.time, extremo: true });
    return elegidos;
  };
  return [...lado('resistencia'), ...lado('soporte')].sort((a, b) => b.precio - a.precio);
}

// +2 si `a` cruza hacia arriba de `b`, −2 si cruza hacia abajo, 0 si no (signos estrictos; los empates no cuentan).
const cruza = (a0, a1, b0, b1) => {
  if (a0 == null || a1 == null || b0 == null || b1 == null) return 0;
  const antes = Math.sign(a0 - b0), ahora = Math.sign(a1 - b1);
  if (antes < 0 && ahora > 0) return 1;
  if (antes > 0 && ahora < 0) return -1;
  return 0;
};

/**
 * Eventos de tendencia en toda la serie: cruces de SMA 20/50 y 50/200 (core técnico) y cruce MACD/señal (core indicadores),
 * con lado 'compra' | 'venta'. El RSI entrando en sobreventa (≤30) o sobrecompra (≥70) es lado 'info': el core Indicadores
 * lo lee como momentum, no como reversión, así que no se anuncia como compra ni venta.
 * Devuelve [{ time, lado, origen, core, texto }] ascendente.
 */
export function eventosSenales(velas) {
  const c = velas.map(x => x.close);
  const s20 = smaSerie(c, 20), s50 = smaSerie(c, 50), s200 = smaSerie(c, 200);
  const rsi = rsiSerie(c);
  const { macd, senal } = macdSerie(c);
  const ev = [];
  const add = (i, lado, origen, core, texto) => ev.push({ time: velas[i].time, lado, origen, core, texto });
  for (let i = 1; i < velas.length; i++) {
    const x = cruza(s20[i - 1], s20[i], s50[i - 1], s50[i]);
    if (x > 0) add(i, 'compra', 'cruce_sma', 'tecnico', 'SMA 20 cruza sobre SMA 50');
    if (x < 0) add(i, 'venta', 'cruce_sma', 'tecnico', 'SMA 20 cruza bajo SMA 50');
    const y = cruza(s50[i - 1], s50[i], s200[i - 1], s200[i]);
    if (y > 0) add(i, 'compra', 'cruce_sma_largo', 'tecnico', 'Cruce dorado: SMA 50 sobre SMA 200');
    if (y < 0) add(i, 'venta', 'cruce_sma_largo', 'tecnico', 'Cruce de la muerte: SMA 50 bajo SMA 200');
    if (rsi[i - 1] != null && rsi[i] != null) {
      if (rsi[i - 1] > 30 && rsi[i] <= 30) add(i, 'info', 'rsi', 'indicadores', 'RSI en sobreventa (informativo)');
      if (rsi[i - 1] < 70 && rsi[i] >= 70) add(i, 'info', 'rsi', 'indicadores', 'RSI en sobrecompra (informativo)');
    }
    const m = cruza(macd[i - 1], macd[i], senal[i - 1], senal[i]);
    if (m > 0) add(i, 'compra', 'macd', 'indicadores', 'MACD cruza sobre su señal');
    if (m < 0) add(i, 'venta', 'macd', 'indicadores', 'MACD cruza bajo su señal');
  }
  return ev;
}

/** Etiqueta corta para el gráfico. */
export function etiquetaEvento(e) {
  const t = {
    cruce_sma: e.lado === 'compra' ? 'SMA ↑' : 'SMA ↓',
    cruce_sma_largo: e.lado === 'compra' ? 'Dorado' : 'Muerte',
    rsi: 'RSI',
    macd: e.lado === 'compra' ? 'MACD ↑' : 'MACD ↓',
  };
  return t[e.origen] || e.lado;
}

// Lectura de un oscilador: solo describe la zona; no es señal de compra ni de venta.
const zona = (v, bajo, alto) => (v <= bajo ? 'Sobreventa (informativo)' : v >= alto ? 'Sobrecompra (informativo)' : 'Zona media (informativo)');

/**
 * Lectura actual de cada señal: [{ id, nombre, core, valor (texto), direccion: 'alcista'|'bajista'|'neutral'|'informativo', detalle }].
 * Las de tendencia tienen el mismo signo que los cores del servidor: precio vs SMA50/SMA200 y SMA50 vs SMA200 (técnico) e
 * histograma MACD (indicadores). RSI, estocástico y Bollinger %B son informativos y no cuentan en la confluencia.
 */
export function estadoSenales(velas) {
  if (velas.length < 20) return [];
  const r = resumenIndicadores(velas);
  const f = (v, d = 1) => (esNum(v) ? v.toFixed(d) : '—');
  const out = [];
  const add = (id, nombre, core, valor, direccion, detalle) => out.push({ id, nombre, core, valor, direccion, detalle });
  const cmp = (a, b) => (!esNum(a) || !esNum(b) ? null : a > b ? 'alcista' : a < b ? 'bajista' : 'neutral');
  const d50 = cmp(r.precio, r.sma50);
  if (d50) add('precio_sma50', 'Precio vs SMA 50', 'tecnico', f(r.precio, 2) + ' / ' + f(r.sma50, 2), d50, d50 === 'alcista' ? 'Precio sobre la media de 50' : 'Precio bajo la media de 50');
  const d200 = cmp(r.precio, r.sma200);
  if (d200) add('precio_sma200', 'Precio vs SMA 200', 'tecnico', f(r.precio, 2) + ' / ' + f(r.sma200, 2), d200, d200 === 'alcista' ? 'Tendencia larga alcista' : 'Tendencia larga bajista');
  const dc = cmp(r.sma50, r.sma200);
  if (dc) add('sma50_200', 'SMA 50 vs SMA 200', 'tecnico', f(r.sma50, 2) + ' / ' + f(r.sma200, 2), dc, dc === 'alcista' ? 'Media de 50 sobre la de 200' : 'Media de 50 bajo la de 200');
  if (esNum(r.macdHist)) add('macd', 'MACD 12/26/9', 'indicadores', f(r.macdHist, 3), cmp(r.macdHist, 0), r.macdHist > 0 ? 'Histograma positivo' : 'Histograma negativo');
  if (esNum(r.rsi)) add('rsi', 'RSI 14', 'indicadores', f(r.rsi), 'informativo', zona(r.rsi, 30, 70));
  if (esNum(r.estocasticoK)) add('estocastico', 'Estocástico %K', 'indicadores', f(r.estocasticoK), 'informativo', zona(r.estocasticoK, 20, 80));
  if (esNum(r.bollingerPctB)) add('bollinger', 'Bollinger %B', 'indicadores', f(r.bollingerPctB, 2), 'informativo', zona(r.bollingerPctB, 0.2, 0.8));
  return out;
}

/**
 * Confluencia: cuántas señales de tendencia son alcistas/bajistas/neutrales y cuáles coinciden con la mayoría.
 * Las informativas no se cuentan. `cores`: si se indica, solo cuentan las señales de esos cores (los apagados se excluyen).
 */
export function confluencia(estado, cores = null) {
  const tendencia = estado.filter(s => s.direccion !== 'informativo');
  const usadas = cores ? tendencia.filter(s => cores.includes(s.core)) : tendencia;
  const lista = d => usadas.filter(s => s.direccion === d);
  const alcistas = lista('alcista'), bajistas = lista('bajista'), neutrales = lista('neutral');
  const n = usadas.length;
  let sesgo = 'neutral';
  if (alcistas.length > bajistas.length) sesgo = 'alcista';
  else if (bajistas.length > alcistas.length) sesgo = 'bajista';
  const coinciden = sesgo === 'alcista' ? alcistas : sesgo === 'bajista' ? bajistas : neutrales;
  const fuerza = n ? Math.abs(alcistas.length - bajistas.length) / n : 0;
  const nivel = fuerza >= 0.6 ? 'fuerte' : fuerza >= 0.3 ? 'moderada' : 'débil';
  return { total: n, alcistas, bajistas, neutrales, sesgo, coinciden, fuerza, nivel, excluidas: tendencia.length - n };
}
