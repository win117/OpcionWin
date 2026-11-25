// Lógica pura para armar patas de orden a partir de la cadena de opciones y calcular costos/riesgos.
// Una pata es { accion:'buy'|'sell', intencion, contratoId }; para calcular se le añade `item` (fila de la cadena).
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400000;
export const MULTIPLICADOR = 100;

export const intencionPara = accion => (accion === 'sell' ? 'sell_to_open' : 'buy_to_open');

// Umbrales de spread relativo: aviso, confirmación explícita y «sin liquidez suficiente» (no se recomienda).
export const SPREAD_AVISO = 0.1;
export const SPREAD_CONFIRMAR = 0.2;
export const SPREAD_MAXIMO = 0.25;
// Menos contratos vivos que esto en una pata: pocas contrapartes para entrar y salir.
export const INTERES_MINIMO = 100;

/** Única definición de cotización válida: hay comprador (bid > 0) y el ask no está cruzado. */
export const cotizacionValida = item => isNum(item?.bid) && isNum(item?.ask) && item.bid > 0 && item.ask >= item.bid;

/** Spread relativo (ask-bid)/punto medio; null sin cotización válida. */
export function spreadPct(item) {
  return cotizacionValida(item) ? (item.ask - item.bid) / ((item.ask + item.bid) / 2) : null;
}

// Sesión regular de opciones en Nueva York (9:30 a 16:15, lunes a viernes); misma regla que el servidor.
const formatoHoraNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function enSesion(fechaDato) {
  const t = new Date(fechaDato ?? NaN);
  if (!Number.isFinite(t.getTime())) return true;
  const p = Object.fromEntries(formatoHoraNY.formatToParts(t).map(x => [x.type, x.value])), min = Number(p.hour) * 60 + Number(p.minute);
  return !['Sat', 'Sun'].includes(p.weekday) && min >= 570 && min <= 975;
}
/** Cotización que sirve para estimar un precio: válida y, si se tomó fuera de horario, sin un spread desmedido. */
export const cotizacionFiable = item => cotizacionValida(item) && (enSesion(item.fechaDato) || spreadPct(item) <= SPREAD_MAXIMO);

const DIAS_ULTIMO = 7; // un último precio más viejo ya no estima nada
const ultimoReciente = item => isNum(item?.ultimo) && item.ultimo > 0 && (!item.ultimoFecha || Date.now() - Date.parse(item.ultimoFecha) <= DIAS_ULTIMO * DAY);

/** Punto medio de una cotización fiable; si no la hay, el último precio operado en los últimos 7 días; si no, null. */
export function mid(item) {
  if (cotizacionFiable(item)) return (item.bid + item.ask) / 2;
  return ultimoReciente(item) ? item.ultimo : null;
}

/** La cadena tiene contratos, pero ninguno con un precio que mostrar (vencimiento recién listado). */
export const sinPrecios = (items = []) => items.length > 0 && !items.some(i => i.bid > 0 || i.ultimo > 0);
/** Vencimientos que sí tienen precios según `detalle` [{ vencimiento, conPrecio, conInteres }]; sin detalle, todos. */
export function vencimientosConPrecio(vencimientos = [], detalle = []) {
  const vacios = new Set(detalle.filter(d => d.conPrecio === 0).map(d => d.vencimiento));
  return vencimientos.filter(v => !vacios.has(v));
}

// Centavos válidos para una opción (0.05 desde 3.00), hacia el lado que facilita la ejecución: más al pagar, menos al cobrar.
const alTick = (x, paga) => { const t = Math.abs(x) >= 3 ? 0.05 : 0.01; return Math.max(0.01, Math.round((paga ? Math.ceil(x / t - 1e-9) : Math.floor(x / t + 1e-9)) * t * 100) / 100); };
/**
 * Precio neto por acción con el que la orden se ejecutaría de inmediato: se compra al ask y se vende al bid.
 * null si falta una cotización válida o si a ese precio la orden cambiaría de signo (un crédito que pasaría a costar).
 */
export function precioInmediato(patas, credito) {
  if (!patas.length || patas.some(p => !cotizacionFiable(p.item))) return null;
  const neto = patas.reduce((n, p) => n + (p.accion === 'sell' ? p.item.bid : -p.item.ask) * (p.proporcion || 1), 0);
  return (neto > 0) === Boolean(credito) && Math.abs(neto) >= 0.01 ? alTick(Math.abs(neto), !credito) : null;
}
/** Precio cediendo una fracción para facilitar el cierre: paga más o cobra menos. */
export const cederPrecio = (precio, fraccion, cobra) => alTick(precio * (cobra ? 1 - fraccion : 1 + fraccion), !cobra);

/** Costo en dólares de cruzar el spread (del punto medio al bid/ask) en todas las patas; null si alguna no tiene cotización válida. */
export function costoSpread(patas, cantidad = 1) {
  if (!patas.length || !patas.every(p => cotizacionFiable(p.item))) return null;
  return patas.reduce((a, p) => a + ((p.item.ask - p.item.bid) / 2) * (p.proporcion || 1), 0) * MULTIPLICADOR * cantidad;
}

/** Liquidez de las patas: { sinCotizacion, peorSpread, interesMinimo, pocoInteres, avisar, confirmar, insuficiente }. interesMinimo: null si ninguna pata lo informa. */
export function liquidez(patas) {
  const sinCotizacion = patas.filter(p => !cotizacionValida(p.item)).length;
  const peorSpread = Math.max(0, ...patas.map(p => spreadPct(p.item) ?? 0));
  const intereses = patas.map(p => p.item?.interesAbierto).filter(isNum), interesMinimo = intereses.length ? Math.min(...intereses) : null;
  return {
    sinCotizacion, peorSpread, interesMinimo, fueraDeHorario: patas.some(p => cotizacionValida(p.item) && !cotizacionFiable(p.item)), pocoInteres: interesMinimo != null && interesMinimo < INTERES_MINIMO,
    avisar: peorSpread > SPREAD_AVISO,
    confirmar: sinCotizacion > 0 || peorSpread > SPREAD_CONFIRMAR,
    insuficiente: sinCotizacion > 0 || peorSpread > SPREAD_MAXIMO,
  };
}

/** Antigüedad de la cotización más vieja de las patas: { fecha, horas, texto } o null si ninguna trae fecha. */
export function antiguedadCotizacion(patas, ahora = Date.now()) {
  const ts = patas.map(p => Date.parse(p.item?.fechaDato)).filter(Number.isFinite);
  if (!ts.length) return null;
  const t = Math.min(...ts);
  const min = Math.max(0, Math.round((ahora - t) / 60000));
  const texto = min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
  return { fecha: new Date(t).toISOString(), horas: min / 60, texto };
}

/** 'credito' | 'debito' | null (no se puede saber porque falta alguna cotización). Una sola pata no necesita cotización. */
export function signoNeto(patas, neto) {
  if (patas.length && patas.every(p => p.accion === 'sell')) return 'credito';
  if (patas.length && patas.every(p => p.accion === 'buy')) return 'debito';
  return isNum(neto) ? (neto > 0 ? 'credito' : 'debito') : null;
}

/** Campos de precio para POST /ordenes/ticket. El servidor solo admite `credito` en órdenes límite de varias patas. */
export function camposPrecio({ tipo, limite, credito, nPatas }) {
  if (tipo !== 'limit') return {};
  return { precioLimite: Math.round(limite * 100) / 100, ...(nPatas > 1 ? { credito: Boolean(credito) } : {}) };
}

/** Días (enteros) desde `hoy` hasta el vencimiento YYYY-MM-DD. */
export function diasHasta(venc, hoy = new Date()) {
  const t0 = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.parse(venc) - t0) / DAY);
}

// Días a vencimiento objetivo por estrategia (dentro de 30-45): las compras pagan menos theta con más plazo;
// el iron condor cobra theta más rápido con algo menos.
export const DIAS_OBJETIVO = { LONG_CALL: 45, LONG_PUT: 45, IRON_CONDOR: 35 };
const DIAS_OBJETIVO_DEFECTO = 35;

/** Vencimientos todavía vigentes (de hoy en adelante), ordenados. */
export function vencimientosVigentes(vencimientos = [], hoy = new Date()) {
  return [...new Set(vencimientos)].filter(v => diasHasta(v, hoy) >= 0).sort();
}

// Liquidez esperable por tipo de vencimiento, en días de «distancia» que se le suman: el mensual (tercer viernes) es el más negociado,
// luego los demás viernes; los de entre semana tienen spreads mucho mayores.
const RECARGO_SIN_INTERES = 10; // vencimiento recién listado: cotiza, pero nadie tiene contratos abiertos
const recargoLiquidez = v => {
  const d = new Date(v + 'T00:00:00Z');
  if (d.getUTCDay() !== 5) return 6;
  return d.getUTCDate() >= 15 && d.getUTCDate() <= 21 ? 0 : 2;
};

/**
 * Vencimiento sugerido para una estrategia: el más cercano a su objetivo de días dentro de [minDias, maxDias], prefiriendo los líquidos;
 * si ninguno cae en el rango, el futuro más cercano al objetivo. Nunca uno vencido: null si no queda ninguno.
 * Con `detalle` descarta los que no tienen ni un precio (salvo que ninguno tenga) y deja al final los que nadie ha negociado.
 */
export function elegirVencimiento(todos = [], hoy = new Date(), minDias = 7, maxDias = null, codigo = null, detalle = []) {
  const conPrecio = vencimientosConPrecio(todos, detalle), vencimientos = vencimientosVigentes(conPrecio, hoy).length ? conPrecio : todos;
  const hayInteres = detalle.some(d => d.conInteres > 0), nuevos = new Set(detalle.filter(d => hayInteres && d.conInteres === 0).map(d => d.vencimiento));
  const objetivo = DIAS_OBJETIVO[codigo] ?? DIAS_OBJETIVO_DEFECTO;
  const vigentes = vencimientosVigentes(vencimientos, hoy);
  const enRango = vigentes.filter(v => diasHasta(v, hoy) >= minDias && (!isNum(maxDias) || diasHasta(v, hoy) <= maxDias));
  // El que vence hoy solo se propone si no hay otro.
  const futuros = vigentes.filter(v => diasHasta(v, hoy) > 0);
  const lista = enRango.length ? enRango : futuros.length ? futuros : vigentes;
  return cercano(lista, objetivo, (v, o) => Math.abs(diasHasta(v, hoy) - o) + recargoLiquidez(v) + (nuevos.has(v) ? RECARGO_SIN_INTERES : 0));
}

const delta = it => it?.griegas?.delta;
const cercano = (lista, valor, medida) => lista.reduce((a, b) => (a == null || medida(b, valor) < medida(a, valor) ? b : a), null);

const conDeltaUtil = it => isNum(delta(it)) && Math.abs(delta(it)) > 0.02 && Math.abs(delta(it)) < 0.98;

/**
 * Construye las patas recomendadas de una estrategia (misma regla que la tabla de strikes). Devuelve { legs } o { error }.
 * items: cadena de UN vencimiento; precio: subyacente.
 */
export function construirPatas(codigo, items = [], precio) {
  const roles = rolesEstrategia(codigo);
  if (!roles.length) return { error: 'Estrategia sin armado automático: ' + codigo };
  if (!items.some(i => i.contratoId && isNum(i.strike))) return { error: 'La cadena no tiene contratos disponibles en un vencimiento vigente. Sincroniza los contratos.' };
  if (!isNum(precio)) return { error: 'No hay precio del subyacente para armar la estrategia.' };
  const sel = seleccionRecomendada(codigo, items, precio);
  const falta = roles.find(r => !sel[r.clave]);
  if (falta) return { error: `No hay ${falta.tipo}s disponibles en el vencimiento para «${falta.etiqueta}».` };
  return { legs: roles.map(r => ({ accion: r.accion, intencion: intencionPara(r.accion), contratoId: sel[r.clave].contratoId })) };
}

/**
 * Roles (patas) de cada estrategia para que el usuario elija el strike de cada una.
 * delta = |Δ| objetivo; fb = strike de respaldo (× precio) si no hay griegas; ala = pata protectora de otra.
 */
export function rolesEstrategia(codigo) {
  if (codigo === 'LONG_CALL') return [{ clave: 'call', etiqueta: 'Comprar Call', tipo: 'call', accion: 'buy', delta: 0.5, fb: 1, ayuda: 'Δ ≈ 0,50 (en el dinero): equilibrio entre costo y sensibilidad al alza.' }];
  if (codigo === 'LONG_PUT') return [{ clave: 'put', etiqueta: 'Comprar Put', tipo: 'put', accion: 'buy', delta: 0.5, fb: 1, ayuda: 'Δ ≈ 0,50 (en el dinero): equilibrio entre costo y sensibilidad a la baja.' }];
  if (codigo === 'IRON_CONDOR') {
    return [
      { clave: 'sp', etiqueta: 'Vender Put', tipo: 'put', accion: 'sell', delta: 0.2, fb: 0.95, ayuda: 'Δ ≈ 0,20: límite inferior del rango esperado (≈80 % por lado; ≈60 % ambos lados).' },
      { clave: 'lp', etiqueta: 'Comprar Put (protección)', tipo: 'put', accion: 'buy', ala: { de: 'sp', dir: -1 }, ayuda: 'Por debajo del put vendido; ancho ≈ 2,5 % del precio. Limita la pérdida.' },
      { clave: 'sc', etiqueta: 'Vender Call', tipo: 'call', accion: 'sell', delta: 0.2, fb: 1.05, ayuda: 'Δ ≈ 0,20: límite superior del rango esperado.' },
      { clave: 'lc', etiqueta: 'Comprar Call (protección)', tipo: 'call', accion: 'buy', ala: { de: 'sc', dir: +1 }, ayuda: 'Por encima del call vendido; ancho ≈ 2,5 % del precio. Limita la pérdida.' },
    ];
  }
  return [];
}

/**
 * Candidatos de strike para un rol. Idoneidad (0–100) = 70 % ajuste (Δ objetivo o ancho del ala) + 30 % liquidez (spread).
 * Orden: primero los recomendables (cotización válida, spread ≤ 25 % y ajuste razonable), luego los que tienen cotización
 * y al final los que solo tienen último precio o nada; dentro de cada grupo, por idoneidad.
 * `elegidos` = { clave → item } de las demás patas (las alas dependen de su pata vendida).
 * Devuelve [{ item, idoneidad, ajuste, liquidez, motivo, recomendable }]; sin ninguno recomendable no hay recomendación.
 */
export function candidatosStrike(rol, items = [], precio, elegidos = {}) {
  const base = rol.ala ? elegidos[rol.ala.de] : null;
  let lista = items.filter(i => i.contratoId && isNum(i.strike) && i.tipo === rol.tipo);
  if (rol.ala) {
    if (!base) return [];
    lista = lista.filter(i => (rol.ala.dir < 0 ? i.strike < base.strike : i.strike > base.strike));
  }
  const ancho = isNum(precio) ? precio * 0.025 : 1;
  const hayDelta = lista.some(conDeltaUtil);
  const out = lista.map(item => {
    let ajuste, motivo;
    if (rol.ala) {
      const dist = Math.abs(item.strike - base.strike);
      ajuste = 1 - Math.min(1, Math.abs(dist - ancho) / (ancho * 2));
      motivo = `Ancho ${dist.toFixed(2)} (objetivo ≈ ${ancho.toFixed(2)})`;
    } else if (hayDelta && isNum(delta(item))) {
      const d = Math.abs(delta(item));
      ajuste = 1 - Math.min(1, Math.abs(d - rol.delta) / 0.3);
      motivo = `|Δ| ${d.toFixed(2)} (objetivo ${rol.delta.toFixed(2)})`;
    } else {
      const ref = isNum(precio) ? precio * rol.fb : item.strike;
      ajuste = 1 - Math.min(1, Math.abs(item.strike - ref) / (Math.abs(ref) * 0.1 || 1));
      motivo = hayDelta ? 'Sin griegas en este strike' : `Distancia al strike de referencia ${ref.toFixed(2)}`;
    }
    const sp = spreadPct(item);
    const liq = sp == null ? 0 : 1 - Math.min(1, sp / 0.3);
    if (sp == null) motivo += ' · sin cotización bid/ask';
    else if (sp > SPREAD_MAXIMO) motivo += ' · sin liquidez suficiente';
    const recomendable = sp != null && sp <= SPREAD_MAXIMO && (Boolean(rol.ala) || ajuste >= 0.5);
    return { item, ajuste, liquidez: liq, motivo, recomendable, idoneidad: Math.round(100 * (0.7 * ajuste + 0.3 * liq)) };
  });
  const grupo = c => (c.recomendable ? 2 : cotizacionValida(c.item) ? 1 : 0);
  return out.sort((a, b) => grupo(b) - grupo(a) || b.idoneidad - a.idoneidad || a.item.strike - b.item.strike);
}

/** Selección recomendada { clave → item } para todos los roles (las alas se calculan tras su pata vendida). */
export function seleccionRecomendada(codigo, items = [], precio) {
  const sel = {};
  for (const rol of rolesEstrategia(codigo)) {
    const c = candidatosStrike(rol, items, precio, sel)[0];
    if (c) sel[rol.clave] = c.item;
  }
  return sel;
}

/** Errores de coherencia de la selección del usuario (strikes cruzados, patas faltantes). */
export function validarSeleccion(codigo, sel = {}) {
  const roles = rolesEstrategia(codigo);
  const errores = roles.filter(r => !sel[r.clave]).map(r => `Falta elegir el strike de «${r.etiqueta}».`);
  if (codigo === 'IRON_CONDOR' && !errores.length) {
    const { sp, lp, sc, lc } = sel;
    if (lp.strike >= sp.strike) errores.push('El put comprado debe tener un strike menor que el put vendido.');
    if (lc.strike <= sc.strike) errores.push('El call comprado debe tener un strike mayor que el call vendido.');
    if (sp.strike >= sc.strike) errores.push('El put vendido debe quedar por debajo del call vendido (si no, no hay rango de ganancia).');
  }
  return errores;
}

/** Comprueba que las patas (con `item`) formen la estrategia: tipo, acción, número de patas y orden de strikes. */
export function validarPatas(codigo, patas) {
  const roles = rolesEstrategia(codigo);
  if (!roles.length) return [];
  const libres = [...patas], sel = {};
  for (const r of roles) {
    const i = libres.findIndex(p => p.item?.tipo === r.tipo && p.accion === r.accion);
    if (i >= 0) sel[r.clave] = libres.splice(i, 1)[0].item;
  }
  if (libres.length || roles.some(r => !sel[r.clave])) return [`Las patas ya no forman la estrategia elegida. Se requiere: ${roles.map(r => r.etiqueta).join(', ')}.`];
  return validarSeleccion(codigo, sel);
}

/**
 * Pasa las patas a otro vencimiento conservando tipo, acción y el strike más cercano al anterior.
 * Si con esos strikes la estrategia deja de ser válida, se arma de nuevo. `previas` = [{accion,intencion,item}].
 * Devuelve { legs, aviso } (aviso = texto para el usuario) o { error }.
 */
export function reconstruirPatas(codigo, previas, items = [], precio) {
  const validos = items.filter(i => i.contratoId && isNum(i.strike));
  const patas = [];
  for (const p of previas) {
    const tipo = p.item?.tipo || 'call';
    const ref = p.item?.strike ?? precio;
    const libres = validos.filter(i => i.tipo === tipo && !patas.some(x => x.item === i));
    const it = cercano(libres, ref, (i, v) => Math.abs(i.strike - v));
    if (!it) return { error: `No hay ${tipo}s en el vencimiento elegido.` };
    patas.push({ accion: p.accion, intencion: p.intencion || intencionPara(p.accion), item: it, antes: p.item?.strike });
  }
  if (codigo && validarPatas(codigo, patas).length && !validarPatas(codigo, previas).length) {
    const r = construirPatas(codigo, items, precio);
    return r.error ? r : { ...r, aviso: 'En este vencimiento no hay strikes equivalentes: se armó de nuevo con los recomendados. Revísalos antes de operar.' };
  }
  const cambios = patas.filter(p => isNum(p.antes) && p.antes !== p.item.strike);
  const aviso = cambios.length
    ? `Vencimiento cambiado. Strikes ajustados al más cercano: ${cambios.map(p => `${p.item.tipo === 'put' ? 'Put' : 'Call'} ${p.antes} → ${p.item.strike}`).join(', ')}.`
    : 'Vencimiento cambiado; se conservaron los strikes. Las primas y griegas son las del nuevo vencimiento.';
  return { legs: patas.map(({ accion, intencion, item }) => ({ accion, intencion, contratoId: item.contratoId })), aviso };
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

// ---- Riesgo al vencimiento (sirve para cualquier conjunto de patas del MISMO vencimiento) ----
const CERO = 1e-6;
const signo = leg => (leg.accion === 'sell' ? -1 : 1);

/**
 * P/L al vencimiento. legs: [{ tipo, strike, accion, cantidad, multiplicador, prima }] (prima por acción).
 * P/L(S) = Σ signo · cantidad · multiplicador · (intrínseco(S) − prima).
 */
export function payoffAt(legs, S) {
  return legs.reduce((sum, leg) => {
    const intrinseco = leg.tipo === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
    return sum + signo(leg) * leg.cantidad * leg.multiplicador * (intrinseco - leg.prima);
  }, 0);
}

/**
 * Ganancia y pérdida máximas y breakevens. El payoff es lineal por tramos: se evalúa en 0, en cada strike y con la pendiente
 * a la derecha del último. null = ilimitada; maxPerdida es positiva (0 si nunca se pierde). null si falta alguna prima.
 */
export function riesgoGenerico(legs) {
  if (!legs?.length || legs.some(l => !isNum(l.strike) || !isNum(l.prima) || !isNum(l.cantidad) || !isNum(l.multiplicador))) return null;
  const nodos = [0, ...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const v = nodos.map(x => payoffAt(legs, x));
  const pendiente = legs.filter(l => l.tipo === 'call').reduce((a, l) => a + signo(l) * l.cantidad * l.multiplicador, 0);
  const cero = x => Math.abs(x) < CERO;
  const breakevens = [];
  nodos.forEach((x, i) => {
    const ultimo = i === nodos.length - 1;
    const derecha = ultimo ? v[i] + pendiente : v[i + 1]; // a la derecha del último strike basta el signo de la pendiente
    // Un vértice en cero es breakeven salvo dentro de una meseta de cero.
    if (cero(v[i])) { if (x > 0 && !(cero(v[i - 1]) && cero(derecha))) breakevens.push(x); return; }
    if (ultimo) { if (pendiente !== 0 && Math.sign(v[i]) !== Math.sign(pendiente)) breakevens.push(x - v[i] / pendiente); return; }
    if (!cero(v[i + 1]) && Math.sign(v[i]) !== Math.sign(v[i + 1])) breakevens.push(x + ((nodos[i + 1] - x) * -v[i]) / (v[i + 1] - v[i]));
  });
  const red = x => Math.round(x * 1e4) / 1e4; // quita ruido de coma flotante
  return {
    maxGanancia: pendiente > 0 ? null : red(Math.max(...v)),
    maxPerdida: pendiente < 0 ? null : red(Math.max(0, -Math.min(...v))),
    breakevens: breakevens.map(red),
  };
}

// Patas del ticket → legs de payoff. Las primas individuales se reparten para que sumen el precio neto de la orden.
function legsConNeto(patas, precioNeto, credito, cantidad) {
  const legs = patas.map(p => ({ tipo: p.item?.tipo, strike: p.item?.strike, accion: p.accion, cantidad: (p.proporcion || 1) * cantidad, multiplicador: MULTIPLICADOR, prima: 0 }));
  if (!legs.length || !isNum(precioNeto)) return null;
  const neto = (credito ? 1 : -1) * precioNeto; // >0 se recibe
  legs[0].prima = (-signo(legs[0]) * neto) / (patas[0].proporcion || 1);
  return legs;
}

/** Perfil de riesgo total de la orden. `patas` = [{accion,item,proporcion?}], `precioNeto` = precio positivo por unidad. Ver riesgoGenerico. */
export function perfilRiesgo(patas, precioNeto, credito, cantidad = 1) {
  return riesgoGenerico(legsConNeto(patas, precioNeto, credito, cantidad));
}

/** Curva para PayoffChart más el riesgo exacto. null si falta alguna prima (no se dibuja con ceros). */
export function analyzePayoff(legs, samples = 240) {
  const riesgo = riesgoGenerico(legs);
  if (!riesgo) return null;
  const strikes = legs.map(l => l.strike);
  const hitos = [...strikes, ...riesgo.breakevens]; // los breakevens siempre quedan dentro de la gráfica
  const lo = Math.min(...hitos), hi = Math.max(...hitos);
  const pad = Math.max((hi - lo) * 0.6, hi * 0.15, 1);
  const min = Math.max(0, lo - pad), max = hi + pad;
  const xs = [...Array.from({ length: samples + 1 }, (_, i) => min + ((max - min) * i) / samples), ...strikes].sort((a, b) => a - b);
  return {
    points: xs.map(S => [S, payoffAt(legs, S)]), min, max, strikes,
    breakevens: riesgo.breakevens, maxGain: riesgo.maxGanancia, maxLoss: riesgo.maxPerdida == null ? null : -riesgo.maxPerdida,
    gainUnbounded: riesgo.maxGanancia == null, lossUnbounded: riesgo.maxPerdida == null,
  };
}

// ---- Probabilidad (mismo modelo que src/cores/blackscholes.js: lognormal, neutral al riesgo, días naturales/365) ----
// r (Tesoro) y q (dividendos) los obtiene el servidor; sin dato se usa 0. Mismas fórmulas que src/cores/tasa.js.
export function tasaParaPlazo(puntos, dias) {
  const p = (Array.isArray(puntos) ? puntos : []).filter(x => isNum(x?.dias) && x.dias > 0 && isNum(x?.tasa)).sort((a, b) => a.dias - b.dias);
  if (!p.length || !isNum(dias) || dias <= 0) return null;
  const i = p.findIndex(x => x.dias >= dias);
  const simple = i === 0 ? p[0].tasa : i < 0 ? p.at(-1).tasa : p[i - 1].tasa + ((p[i].tasa - p[i - 1].tasa) * (dias - p[i - 1].dias)) / (p[i].dias - p[i - 1].dias);
  const T = dias / 365;
  return Math.log(1 + simple * T) / T;
}
export const rendimientoDividendo = (anual, precio) => (isNum(anual) && anual > 0 && isNum(precio) && precio > 0 ? Math.log(1 + anual / precio) : 0);
const HORA_VENCIMIENTO_UTC = 20;
/** N(x), Abramowitz & Stegun 26.2.17. */
export function cdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poli = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cola = (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poli;
  return x >= 0 ? 1 - cola : cola;
}
/** P(S_T > X) = N(d2). */
export function probabilidadSobre({ S, X, T, sigma, r = 0, q = 0 }) {
  if (X <= 0) return 1;
  if (![S, X, T, sigma].every(v => isNum(v) && v > 0)) return null;
  return cdf((Math.log(S / X) + (r - q - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T)));
}
/** Años hasta el cierre del día de vencimiento; null si ya pasó. */
export function aniosHasta(vencimiento, ahora = new Date()) {
  const T = (Date.parse(String(vencimiento).slice(0, 10)) + HORA_VENCIMIENTO_UTC * 3600000 - ahora.getTime()) / (365 * DAY);
  return T > 0 ? T : null;
}

/** Probabilidad de ganar al vencimiento: suma de las zonas con P/L > 0. Cada breakeven usa la IV de la pata vendida más cercana (o de la más cercana). */
function probabilidadGanancia(legs, ivs, riesgo, S, T, r, q) {
  const vendidas = legs.map((l, i) => i).filter(i => legs[i].accion === 'sell');
  const usar = vendidas.length ? vendidas : legs.map((_, i) => i);
  const cortes = [...riesgo.breakevens].sort((a, b) => a - b);
  const sobre = cortes.map(X => probabilidadSobre({ S, X, T, r, q, sigma: ivs[cercano(usar, X, (i, x) => Math.abs(legs[i].strike - x))] }));
  if (!T || !isNum(S) || sobre.some(p => p == null)) return null;
  let total = 0;
  for (let i = 0; i <= cortes.length; i++) {
    const desde = i ? cortes[i - 1] : 0;
    const prueba = i < cortes.length ? (desde + cortes[i]) / 2 : Math.max(desde, ...legs.map(l => l.strike)) + 1;
    if (payoffAt(legs, prueba) > CERO) total += (i ? sobre[i - 1] : 1) - (i < cortes.length ? sobre[i] : 0);
  }
  return Math.min(1, Math.max(0, total));
}

/** IV en el dinero: promedio de los contratos del strike más cercano al subyacente. */
export function ivATM(items = [], S) {
  const conIv = items.filter(i => isNum(i.volatilidadImplicita) && i.volatilidadImplicita > 0 && isNum(i.strike));
  if (!conIv.length || !isNum(S)) return null;
  const k = cercano(conIv, S, (i, v) => Math.abs(i.strike - v)).strike;
  const ivs = conIv.filter(i => i.strike === k).map(i => i.volatilidadImplicita);
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

export const CREDITO_ANCHO_MINIMO = 0.2;

/**
 * Cifras de la revisión de la orden (totales en dólares; null = no se puede calcular):
 * riesgo, probabilidad, delta ($ por cada $1 del subyacente), theta ($ por día), vega ($ por punto de IV), retornoRiesgo,
 * creditoAncho (condor), movimiento esperado ±1σ con su P/L y pctCuenta (pérdida máxima / patrimonio).
 */
export function metricasOrden({ patas, precioNeto, credito, cantidad = 1, S, items = [], vencimiento, patrimonio, tasa = null, dividendoAnual = null, ahora = new Date() }) {
  const legs = legsConNeto(patas, precioNeto, credito, cantidad);
  const riesgo = legs && riesgoGenerico(legs);
  const griega = nombre => (patas.length && patas.every(p => isNum(p.item?.griegas?.[nombre]))
    ? patas.reduce((a, p) => a + (p.accion === 'sell' ? -1 : 1) * p.item.griegas[nombre] * (p.proporcion || 1), 0) * MULTIPLICADOR * cantidad : null);
  const T = vencimiento ? aniosHasta(vencimiento, ahora) : null;
  const iv = ivATM(items, S);
  const r = (T && tasaParaPlazo(tasa, Math.max(1, Math.round(T * 365)))) ?? 0, q = rendimientoDividendo(dividendoAnual, S);
  const em = isNum(iv) && T ? S * iv * Math.sqrt(T) : null;
  let creditoAncho = null;
  if (riesgo && credito && patas.length === 4) {
    const k = (tipo, accion) => patas.find(p => p.item.tipo === tipo && p.accion === accion)?.item.strike;
    const ancho = Math.max(k('put', 'sell') - k('put', 'buy'), k('call', 'buy') - k('call', 'sell'));
    if (ancho > 0) creditoAncho = precioNeto / ancho;
  }
  return {
    riesgo,
    probabilidad: riesgo ? probabilidadGanancia(legs, patas.map(p => p.item?.volatilidadImplicita), riesgo, S, T, r || 0, q) : null,
    tasa: r || null, dividendo: q,
    delta: griega('delta'), theta: griega('theta'), vega: griega('vega'),
    retornoRiesgo: riesgo && riesgo.maxGanancia > 0 && riesgo.maxPerdida > 0 ? riesgo.maxGanancia / riesgo.maxPerdida : null,
    creditoAncho,
    movimiento: isNum(em) && riesgo ? { monto: em, abajo: Math.max(0, S - em), arriba: S + em, plAbajo: payoffAt(legs, Math.max(0, S - em)), plArriba: payoffAt(legs, S + em) } : null,
    pctCuenta: isNum(riesgo?.maxPerdida) && isNum(patrimonio) && patrimonio > 0 ? riesgo.maxPerdida / patrimonio : null,
  };
}

/**
 * Avisos por eventos anunciados o estimados antes del vencimiento. `eventos`: respuesta de /mercado/eventos. Devuelve [{ tipo, texto }].
 * Dividendo: solo importa para la asignación de calls vendidos; el riesgo es alto si el call está dentro del dinero y lo que le queda de
 * valor extra es menor que el dividendo.
 */
export function avisosEventos(patas, S, vencimiento, eventos, fmtFecha = f => f) {
  if (!eventos || !vencimiento) return [];
  const avisos = [], antes = f => f && f <= vencimiento;
  const r = eventos.reportes?.proximo;
  if (r && antes(r.desde)) {
    const seguro = antes(r.hasta);
    avisos.push({ tipo: 'resultados', texto: `Reporte de resultados estimado entre el ${fmtFecha(r.desde)} y el ${fmtFecha(r.hasta)}${seguro ? ', antes de que venza tu opción' : ': puede caer antes de que venza tu opción'}. El precio puede saltar y la volatilidad implícita caer de golpe${patas.some(p => p.accion === 'sell') && patas.length === 4 ? '; en un Iron Condor un salto puede costarte la pérdida máxima' : ''}.` });
  }
  const calls = patas.filter(p => p.accion === 'sell' && p.item?.tipo === 'call');
  for (const d of eventos.dividendos?.proximos || []) {
    if (!antes(d.exFecha) || !calls.length) continue;
    const alto = calls.some(p => isNum(S) && p.item.strike < S && isNum(mid(p.item)) && mid(p.item) - (S - p.item.strike) < d.monto);
    avisos.push({ tipo: 'dividendo', texto: `Dividendo de ${d.monto.toFixed(2)} por acción el ${fmtFecha(d.exFecha)} (fecha ex), antes del vencimiento. ${alto ? 'Riesgo alto: a quien compró tu call le conviene ejercerlo el día anterior para cobrarlo.' : 'Si tu call vendido queda dentro del dinero, pueden ejercerlo el día anterior para cobrarlo.'}` });
  }
  for (const d of eventos.divisiones || []) if (antes(d.exFecha)) avisos.push({ tipo: 'division', texto: `División de acciones el ${fmtFecha(d.exFecha)}${d.de && d.a ? ` (${d.a} por ${d.de})` : ''}: el contrato se ajustará.` });
  return avisos;
}

/** Notas sobre asignación y vencimiento, en lenguaje llano. */
export function notasVencimiento(patas, S, dias) {
  const notas = [];
  const ventas = patas.filter(p => p.accion === 'sell' && p.item);
  const compras = patas.filter(p => p.accion === 'buy' && p.item);
  const dentro = p => isNum(S) && (p.item.tipo === 'call' ? p.item.strike < S : p.item.strike > S);
  if (ventas.length) {
    notas.push('Asignación anticipada: quien compró la opción que vendes puede ejercerla cualquier día. Es más probable si está dentro del dinero, cerca del vencimiento o (en calls) justo antes de un dividendo; tendrías que entregar o recibir 100 acciones por contrato.');
    if (ventas.some(dentro)) notas.push('Una de las opciones que vendes ya está dentro del dinero: el riesgo de asignación es real desde hoy.');
  }
  if (ventas.length && compras.length) notas.push('Si al vencer el precio queda entre el strike vendido y el comprado, puedes acabar con acciones y sin protección: conviene cerrar antes del último día.');
  if (compras.length && !ventas.length) notas.push('Si vence fuera del dinero se pierde toda la prima. Si vence dentro del dinero por 0.01 o más, el broker normalmente la ejerce y necesitas dinero para 100 acciones por contrato; puedes venderla antes.');
  if (isNum(dias) && dias <= 7) notas.push(`Quedan ${dias} días: el valor cambia muy rápido con cada movimiento del precio.`);
  return notas;
}

// ---- Puntajes: se clasifican y se muestran con el mismo redondeo (un decimal) ----
export const puntaje1 = v => (isNum(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 evita «-0»
/** Texto del puntaje con un decimal fijo. */
export const textoPuntaje = v => (isNum(v) ? puntaje1(v).toFixed(1) : '—');

/** Lectura direccional de un core: ≤ 40 bajista, ≥ 60 alcista. */
export function direccion(puntaje) {
  const p = puntaje1(puntaje);
  if (p == null) return { texto: 'Sin datos', tono: 'neutral' };
  if (p <= 40) return { texto: 'Bajista', tono: 'down' };
  if (p >= 60) return { texto: 'Alcista', tono: 'up' };
  return { texto: 'En rango', tono: 'flat' };
}

/** Veredicto según la compatibilidad (0–100). */
export function veredicto(puntaje) {
  const p = puntaje1(puntaje);
  if (p == null) return { texto: 'SIN DATOS', tono: 'neutral' };
  if (p >= 60) return { texto: 'COMPATIBLE', tono: 'success' };
  if (p >= 40) return { texto: 'NEUTRAL', tono: 'warning' };
  return { texto: 'NO RECOM.', tono: 'danger' };
}

/** Calificación (0–100) de un core para la estrategia: alcista favorece Call, bajista Put, neutralidad Condor. */
export function calificacionPara(codigo, puntajeCore) {
  if (!isNum(puntajeCore)) return null;
  if (codigo === 'LONG_PUT') return 100 - puntajeCore;
  if (codigo === 'IRON_CONDOR') return 100 - Math.abs(puntajeCore - 50) * 2;
  return puntajeCore;
}

/**
 * Desglose que cuadra con el puntaje final: filas por core (peso efectivo × calificación), subtotal y ajustes.
 * Long Call/Put descuentan la dispersión; el Iron Condor no, solo suma el ajuste IV/HV (confluencia.core).
 * `pesos` = ponderaciones efectivas de la confluencia; `evaluaciones` = { core → evaluación de esa confluencia }.
 */
export function desglosePuntaje(codigo, cores, pesos = [], evaluaciones = {}, puntajeFinal = null, motivos = []) {
  const filas = cores.map(core => {
    const ev = evaluaciones[core];
    const peso = pesos.find(p => p.core === core)?.peso;
    const calif = calificacionPara(codigo, ev?.puntaje);
    return { core, ev, peso, calif, puntos: isNum(peso) && isNum(calif) ? puntaje1(peso * calif) : null };
  });
  const usadas = filas.filter(f => f.puntos != null && f.peso > 0);
  if (!usadas.length || !isNum(puntajeFinal)) return { filas, subtotal: null, dispersion: null, ajusteIv: null, final: puntaje1(puntajeFinal) };
  const subtotal = puntaje1(usadas.reduce((a, f) => a + f.peso * f.calif, 0));
  // El redondeo de las filas se absorbe en la mayor para que la columna sume exactamente el subtotal.
  const mayor = usadas.reduce((a, f) => (f.puntos > a.puntos ? f : a));
  mayor.puntos = puntaje1(mayor.puntos + subtotal - usadas.reduce((a, f) => a + f.puntos, 0));
  const final = puntaje1(puntajeFinal);
  const resto = puntaje1(final - subtotal);
  const condor = codigo === 'IRON_CONDOR';
  const motivoIv = motivos.map(m => /^Ajuste por volatilidad [^(]*\((.+)\)\.$/.exec(m)?.[1]).find(Boolean) || null;
  return { filas, subtotal, dispersion: condor ? null : resto, ajusteIv: condor ? resto : null, motivoIv, final };
}

/** Estadísticos de la confluencia (misma fórmula que confluencia.core) a partir de sus evaluaciones y los pesos del usuario. */
export function estadisticosConfluencia(evaluaciones = [], ponderaciones = [], cores = []) {
  const met = (e, n) => e.metricas?.find(m => m.nombre === n)?.valor;
  const usados = cores.map(core => {
    const e = evaluaciones.find(x => x?.core === core);
    const s = e ? met(e, 'sesgo') : null;
    if (!isNum(s)) return null;
    const p = ponderaciones.find(x => x.core === core)?.peso;
    const w = isNum(p) && p >= 0 ? p : 1, c = met(e, 'confianza') ?? 0;
    return { s, w, c, e: w * c };
  }).filter(Boolean);
  const sumaE = usados.reduce((a, u) => a + u.e, 0), sumaW = usados.reduce((a, u) => a + u.w, 0);
  if (!(sumaE > 0)) return null;
  const sesgo = usados.reduce((a, u) => a + u.e * u.s, 0) / sumaE;
  const dispersion = Math.min(1, Math.sqrt(usados.reduce((a, u) => a + u.e * (u.s - sesgo) ** 2, 0) / sumaE));
  return { sesgo, dispersion, confianza: (usados.reduce((a, u) => a + u.w * u.c, 0) / sumaW) * (usados.length / cores.length) * (1 - dispersion) };
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
    .map(r => ({ codigo: datos.estrategiasById?.get(r.estrategiaId)?.codigo, puntaje: r.puntaje, cobertura: r.cobertura, confluenciaId: r.confluenciaId }))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
  const top = filas[0];
  const fila = filas.find(f => f.codigo === codigo);
  const fecha = sel.createdAt;
  const t = Date.parse(fecha);
  // Solo cuentan los cores que entraron en la selección (los apagados no influyen).
  const usados = sel.coresSeleccionados || [];
  const puntajes = Object.entries(datos.evaluaciones || {}).filter(([core]) => !usados.length || usados.includes(core)).map(([, e]) => e?.puntaje).filter(isNum);
  return {
    sinAnalisis: false,
    codigo,
    topCodigo: top?.codigo || null,
    esTop: !top || top.codigo === codigo,
    puntaje: fila?.puntaje ?? null,
    cobertura: fila?.cobertura ?? null,
    confluenciaId: fila?.confluenciaId ?? null,
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
  return `${codigo} ${simbolo} · compat ${textoPuntaje(ctx.puntaje)}${f ? ' · ' + f : ''}`;
}
