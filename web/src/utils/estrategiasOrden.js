// Lógica pura para armar patas de orden a partir de la cadena de opciones y calcular costos/riesgos.
// Una pata es { accion:'buy'|'sell', intencion, contratoId }; para calcular se le añade `item` (fila de la cadena).
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400000;

export const intencionPara = accion => (accion === 'sell' ? 'sell_to_open' : 'buy_to_open');

/** Punto medio bid/ask; si no hay cotización válida usa el último precio. */
export function mid(item) {
  if (!item) return null;
  if (isNum(item.bid) && isNum(item.ask) && item.ask > 0) return (item.bid + item.ask) / 2;
  if (isNum(item.ultimo) && item.ultimo > 0) return item.ultimo;
  return null;
}

/** Spread relativo (ask-bid)/mid o null. */
export function spreadPct(item) {
  const m = mid(item);
  if (!isNum(item?.bid) || !isNum(item?.ask) || !isNum(m) || m <= 0) return null;
  return (item.ask - item.bid) / m;
}

/** Días (enteros) desde `hoy` hasta el vencimiento YYYY-MM-DD. */
export function diasHasta(venc, hoy = new Date()) {
  const t0 = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.parse(venc) - t0) / DAY);
}

/**
 * Vencimiento más cercano con ≥ `minDias` días (y ≤ `maxDias` si se indica y es posible);
 * si no, el primero con ≥ minDias, el más cercano futuro o el primero.
 */
export function elegirVencimiento(vencimientos = [], hoy = new Date(), minDias = 7, maxDias = null) {
  const dias = v => diasHasta(v, hoy);
  const futuros = [...vencimientos].filter(v => dias(v) >= 0).sort();
  const okMin = futuros.filter(v => dias(v) >= minDias);
  const enRango = isNum(maxDias) ? okMin.find(v => dias(v) <= maxDias) : null;
  return enRango || okMin[0] || futuros[0] || [...vencimientos].sort()[0] || null;
}

const delta = it => it?.griegas?.delta;
const cercano = (lista, valor, medida) => lista.reduce((a, b) => (a == null || medida(b, valor) < medida(a, valor) ? b : a), null);

/** Opción de `tipo` cuyo |Δ| esté más cerca de `objetivo`; sin griegas, el strike más cercano a `fallback`. */
function porDelta(items, tipo, objetivo, fallback) {
  const lista = items.filter(i => i.tipo === tipo && isNum(i.strike));
  const conDelta = lista.filter(i => isNum(delta(i)) && Math.abs(delta(i)) > 0.02 && Math.abs(delta(i)) < 0.98);
  if (conDelta.length) return cercano(conDelta, objetivo, (i, v) => Math.abs(Math.abs(delta(i)) - v));
  return cercano(lista, fallback, (i, v) => Math.abs(i.strike - v));
}

/** Ala protectora: entre los strikes en `dir` (-1 abajo / +1 arriba) de `base`, el más cercano a ~anchoObjetivo (mín. 1 paso). */
function ala(items, tipo, base, dir, anchoObjetivo) {
  const cand = items.filter(i => i.tipo === tipo && (dir < 0 ? i.strike < base.strike : i.strike > base.strike));
  if (!cand.length) return null;
  return cercano(cand, anchoObjetivo, (i, v) => Math.abs(Math.abs(i.strike - base.strike) - v));
}

/**
 * Construye las patas de una estrategia. Devuelve { legs } o { error }.
 * items: cadena de UN vencimiento; precio: subyacente.
 */
export function construirPatas(codigo, items = [], precio) {
  const validos = items.filter(i => i.contratoId && isNum(i.strike));
  if (!validos.length) return { error: 'La cadena no tiene contratos disponibles.' };
  if (!isNum(precio)) return { error: 'No hay precio del subyacente para armar la estrategia.' };
  const pata = (accion, it) => ({ accion, intencion: intencionPara(accion), contratoId: it.contratoId });
  if (codigo === 'LONG_CALL' || codigo === 'LONG_PUT') {
    const tipo = codigo === 'LONG_CALL' ? 'call' : 'put';
    const it = cercano(validos.filter(i => i.tipo === tipo), precio, (i, v) => Math.abs(i.strike - v));
    return it ? { legs: [pata('buy', it)] } : { error: `No hay ${tipo}s en el vencimiento elegido.` };
  }
  if (codigo === 'IRON_CONDOR') {
    const sp = porDelta(validos, 'put', 0.2, precio * 0.95);
    const sc = porDelta(validos, 'call', 0.2, precio * 1.05);
    if (!sp || !sc) return { error: 'Faltan puts o calls para armar el iron condor.' };
    const ancho = precio * 0.025;
    const bp = ala(validos, 'put', sp, -1, ancho);
    const bc = ala(validos, 'call', sc, +1, ancho);
    if (!bp || !bc) return { error: 'No hay strikes suficientes para las alas protectoras del iron condor.' };
    return { legs: [pata('sell', sp), pata('buy', bp), pata('sell', sc), pata('buy', bc)] };
  }
  return { error: 'Estrategia sin armado automático: ' + codigo };
}

/**
 * Reconstruye las patas en otra expiración. Con `codigo` usa construirPatas; sin él conserva tipo/acción/intención
 * de cada pata y elige el strike más cercano al anterior. `previas` = [{accion,intencion,item}] (item de la cadena anterior).
 */
export function reconstruirPatas(codigo, previas, items = [], precio) {
  if (codigo) return construirPatas(codigo, items, precio);
  const validos = items.filter(i => i.contratoId && isNum(i.strike));
  const legs = [];
  for (const p of previas) {
    const tipo = p.item?.tipo || 'call';
    const ref = p.item?.strike ?? precio;
    const it = cercano(validos.filter(i => i.tipo === tipo), ref, (i, v) => Math.abs(i.strike - v));
    if (!it) return { error: `No hay ${tipo}s en el vencimiento elegido.` };
    legs.push({ accion: p.accion, intencion: p.intencion, contratoId: it.contratoId });
  }
  return { legs };
}

/** Neto por unidad (Σ ventas − Σ compras, ponderado por proporción). >0 = crédito. null si falta algún precio. */
export function netoMid(patas) {
  let total = 0;
  for (const p of patas) {
    const m = mid(p.item);
    if (!isNum(m)) return null;
    total += (p.accion === 'sell' ? 1 : -1) * m * (p.proporcion || 1);
  }
  return total;
}

/** Redondea a 0.01 si < 3, a 0.05 si ≥ 3 (mínimo 0.01). */
export function redondearPrecio(valor) {
  if (!isNum(valor)) return null;
  const v = Math.abs(valor);
  const tick = v < 3 ? 0.01 : 0.05;
  return Math.max(0.01, Math.round(Math.round(v / tick) * tick * 100) / 100);
}

/**
 * Perfil de riesgo total (×100×cantidad). `patas` = [{accion,item}], `precioNeto` = precio positivo por unidad.
 * maxGanancia/maxPerdida null = ilimitada. Devuelve null si no se reconoce la estructura.
 */
export function perfilRiesgo(patas, precioNeto, credito, cantidad = 1) {
  const k = 100 * cantidad;
  if (!patas.length || !isNum(precioNeto)) return null;
  if (patas.length === 1) {
    const { accion, item } = patas[0];
    if (!item || !isNum(item.strike)) return null;
    const call = item.tipo === 'call';
    const be = call ? item.strike + precioNeto : item.strike - precioNeto;
    if (accion === 'buy') return { tipo: 'long', maxPerdida: precioNeto * k, maxGanancia: call ? null : (item.strike - precioNeto) * k, breakevens: [be] };
    return { tipo: 'short', maxPerdida: call ? null : (item.strike - precioNeto) * k, maxGanancia: precioNeto * k, breakevens: [be] };
  }
  const puts = patas.filter(p => p.item?.tipo === 'put'), calls = patas.filter(p => p.item?.tipo === 'call');
  if (patas.length === 4 && puts.length === 2 && calls.length === 2 && credito) {
    const lado = (ls, accion) => ls.find(p => p.accion === accion)?.item;
    const sp = lado(puts, 'sell'), lp = lado(puts, 'buy'), sc = lado(calls, 'sell'), lc = lado(calls, 'buy');
    if (!sp || !lp || !sc || !lc) return null;
    const ancho = Math.max(sp.strike - lp.strike, lc.strike - sc.strike);
    return { tipo: 'condor', maxPerdida: (ancho - precioNeto) * k, maxGanancia: precioNeto * k, breakevens: [sp.strike - precioNeto, sc.strike + precioNeto] };
  }
  return null;
}

/** Nombre legible de la orden. */
export function nombreOrden(simbolo, patas, codigo) {
  if (codigo === 'IRON_CONDOR') return `Iron Condor ${simbolo}`;
  if (patas.length === 1) {
    const { accion, item } = patas[0];
    return `${accion === 'sell' ? 'Venta' : 'Compra'} ${item?.tipo === 'put' ? 'Put' : 'Call'} ${simbolo} ${item?.strike ?? ''}`.trim();
  }
  return `Orden multi-pata ${simbolo}`;
}

/**
 * Contexto del análisis que respalda una orden.
 * datos = { seleccion, estrategiasById:Map(id→{codigo}), evaluaciones:{core→evaluación} }; codigo = estrategia a operar.
 */
export function contextoAnalisis(datos, codigo, ahora = Date.now()) {
  const sel = datos?.seleccion;
  if (!sel) return { sinAnalisis: true, codigo };
  const filas = [...(sel.resultados || [])]
    .map(r => ({ codigo: datos.estrategiasById?.get(r.estrategiaId)?.codigo, puntaje: r.puntaje, cobertura: r.cobertura }))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
  const top = filas[0];
  const fila = filas.find(f => f.codigo === codigo);
  const fecha = sel.createdAt;
  const t = Date.parse(fecha);
  const puntajes = Object.values(datos.evaluaciones || {}).map(e => e?.puntaje).filter(isNum);
  return {
    sinAnalisis: false,
    codigo,
    topCodigo: top?.codigo || null,
    esTop: !top || top.codigo === codigo,
    puntaje: fila?.puntaje ?? null,
    cobertura: fila?.cobertura ?? null,
    fecha,
    cores: sel.coresSeleccionados || [],
    antiguo: Number.isFinite(t) ? ahora - t > 24 * 3600000 : false,
    contradiccion: top?.codigo === 'IRON_CONDOR' && puntajes.some(p => p >= 70) && puntajes.some(p => p <= 30),
  };
}

/** Nombre de orden con contexto: «LONG_CALL AAPL · compat 69 · 2026-11-17». */
export function nombreConContexto(simbolo, codigo, ctx) {
  if (!ctx || ctx.sinAnalisis) return `${codigo} ${simbolo} · sin análisis`;
  const f = ctx.fecha ? String(ctx.fecha).slice(0, 10) : '';
  return `${codigo} ${simbolo} · compat ${isNum(ctx.puntaje) ? Math.round(ctx.puntaje) : '—'}${f ? ' · ' + f : ''}`;
}
