// Adaptador de Alpaca: Market Data (acciones, opciones, noticias) y Trading PAPER.
// ADR-004/005/006. Credenciales solo en el servidor; nunca se devuelven ni se incluyen en errores.
// Documentación verificada: ver src/integrations/README.md.
import { IntegrationError } from './errors';
import { createHttp } from './http';

export const ALPACA_PAPER_URL = 'https://paper-api.alpaca.markets';
export const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const PROVEEDOR = 'alpaca';
const MAX_PAGINAS = 20;

const ESTADOS_ORDEN = {
  pending_new: 'enviada',
  held: 'enviada',
  accepted: 'aceptada',
  new: 'aceptada',
  accepted_for_bidding: 'aceptada',
  pending_cancel: 'aceptada',
  pending_replace: 'aceptada',
  stopped: 'aceptada',
  suspended: 'aceptada',
  done_for_day: 'aceptada',
  partially_filled: 'parcial',
  filled: 'ejecutada',
  calculated: 'ejecutada',
  canceled: 'cancelada',
  replaced: 'cancelada',
  rejected: 'rechazada',
  expired: 'expirada',
};
export const mapearEstadoOrden = (status, cantidadEjecutada = 0) => {
  if (status === 'done_for_day' && cantidadEjecutada > 0) return 'parcial';
  return ESTADOS_ORDEN[status] || 'enviada';
};

const num = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texto = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fechaIso = v => {
  if (!v) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};
const simboloValido = s => typeof s === 'string' && /^[A-Za-z0-9.\-/]{1,32}$/.test(s.trim());

const validacion = mensaje => new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje });

const normalizarUrl = u => String(u).trim().replace(/\/+$/, '').toLowerCase();

// --- Normalizadores (exportados para pruebas e integración) ---
export const normalizarVela = b => ({
  fecha: b.t, apertura: num(b.o), maximo: num(b.h), minimo: num(b.l), cierre: num(b.c), volumen: num(b.v),
});

export const normalizarContrato = c => ({
  proveedor: PROVEEDOR,
  contratoExternoId: c.symbol,
  simbolo: c.underlying_symbol || c.root_symbol,
  tipo: c.type,
  strike: num(c.strike_price),
  vencimiento: c.expiration_date,
  multiplicador: num(c.multiplier) || num(c.size) || 100,
  activo: c.status ? c.status === 'active' : true,
});

export const normalizarSnapshotOpcion = (simbolo, s = {}) => {
  const g = s.greeks || {};
  return {
    contratoExternoId: simbolo,
    bid: num(s.latestQuote?.bp),
    ask: num(s.latestQuote?.ap),
    ultimo: num(s.latestTrade?.p),
    volatilidadImplicita: num(s.impliedVolatility),
    griegas: { delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega), rho: num(g.rho) },
    fechaDato: s.latestQuote?.t || s.latestTrade?.t || null,
  };
};

export const normalizarNoticia = n => ({
  proveedor: PROVEEDOR,
  noticiaExternaId: String(n.id),
  titulo: n.headline,
  resumen: texto(n.summary),
  url: n.url,
  publicadaEn: n.created_at,
  simbolos: Array.isArray(n.symbols) ? n.symbols : [],
  fuenteOriginal: n.source || null,
});

export const normalizarOrden = o => {
  const cantidadEjecutada = num(o.filled_qty) || 0;
  return {
    ordenExternaId: o.id,
    clientOrderId: o.client_order_id,
    estado: mapearEstadoOrden(o.status, cantidadEjecutada),
    estadoProveedor: o.status,
    claseOrden: o.order_class || 'simple',
    cantidad: num(o.qty),
    cantidadEjecutada,
    precioPromedioEjecucion: num(o.filled_avg_price),
    creadaEn: o.created_at || null,
    actualizadaEn: o.updated_at || null,
    componentes: Array.isArray(o.legs)
      ? o.legs.map(l => ({ ordenExternaId: l.id, simbolo: l.symbol, accion: l.side, intencion: l.position_intent, proporcion: num(l.ratio_qty), estadoProveedor: l.status }))
      : [],
  };
};

export const normalizarPosicion = p => {
  const cantidad = num(p.qty);
  return {
    posicionExternaId: p.asset_id,
    simbolo: p.symbol,
    lado: p.side === 'short' || cantidad < 0 ? 'short' : 'long',
    cantidad: Math.abs(cantidad ?? 0),
    precioPromedio: num(p.avg_entry_price),
    precioActual: num(p.current_price),
    valorMercado: num(p.market_value),
    claseActivo: p.asset_class || null,
    plNoRealizado: num(p.unrealized_pl),
    plPctNoRealizado: num(p.unrealized_plpc), // fracción (0.05 = 5 %)
  };
};

// Convención de precio límite (única traducción, aquí):
// - Nuestra API: `precioLimite` es SIEMPRE el precio neto positivo por unidad; `credito: true` marca una orden multi-pata de crédito neto.
// - Alpaca (referencia POST /v2/orders, CreateOrderRequest.limit_price, orden mleg): valor positivo = débito neto; valor NEGATIVO = crédito neto.
//   Por eso un crédito (p. ej. iron condor vendido) se envía como limit_price negativo. Órdenes de una pata: siempre positivo.
// - Alpaca exige 2 decimales si |precio| >= 1 y hasta 4 si < 1.
const formatearPrecio = n => String(Number(n.toFixed(Math.abs(n) >= 1 ? 2 : 4)));
export const precioLimiteAlpaca = (precioLimite, credito, multipata) => {
  if (!Number.isFinite(precioLimite) || precioLimite === 0) throw validacion('precioLimite debe ser un número distinto de cero.');
  if (credito && !multipata) throw validacion('credito solo aplica a órdenes multi-pata.');
  if (precioLimite < 0) { // compatibilidad: valor ya expresado en la convención de Alpaca (crédito negativo), solo multi-pata
    if (credito || !multipata) throw validacion('precioLimite debe ser positivo; usa credito: true para crédito neto.');
    return formatearPrecio(precioLimite);
  }
  return formatearPrecio(credito ? -precioLimite : precioLimite);
};

// Construye el cuerpo de POST /v2/orders a partir de una orden neutral.
export const construirCuerpoOrden = orden => {
  if (!orden || typeof orden !== 'object') throw validacion('Orden requerida.');
  const { clientOrderId, tipo, vigencia = 'day', cantidad, precioLimite, componentes, credito = false } = orden;
  if (typeof clientOrderId !== 'string' || !clientOrderId.trim() || clientOrderId.length > 128) throw validacion('clientOrderId requerido (máximo 128 caracteres).');
  if (!['market', 'limit'].includes(tipo)) throw validacion('tipo debe ser market o limit.');
  if (!['day', 'gtc'].includes(vigencia)) throw validacion('vigencia debe ser day o gtc.');
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) throw validacion('cantidad debe ser un entero positivo.');
  if (tipo === 'limit' && !Number.isFinite(precioLimite)) throw validacion('precioLimite requerido para orden limit.');
  if (credito && tipo !== 'limit') throw validacion('credito requiere una orden limit.');
  if (tipo === 'market' && precioLimite != null) throw validacion('Una orden market no lleva precioLimite.');
  if (!Array.isArray(componentes) || componentes.length < 1 || componentes.length > 4) throw validacion('Se requieren de 1 a 4 componentes.');
  for (const c of componentes) {
    if (!simboloValido(c?.simbolo)) throw validacion('Símbolo de componente inválido.');
    if (!['buy', 'sell'].includes(c.accion)) throw validacion('accion debe ser buy o sell.');
    if (c.intencion != null && !String(c.intencion).startsWith(`${c.accion}_`)) throw validacion('La intención debe corresponder a la acción.');
    if (c.proporcion != null && (!Number.isSafeInteger(c.proporcion) || c.proporcion < 1)) throw validacion('proporcion debe ser un entero positivo.');
  }
  const base = {
    type: tipo,
    time_in_force: vigencia,
    client_order_id: clientOrderId,
    ...(tipo === 'limit' ? { limit_price: precioLimiteAlpaca(precioLimite, credito === true, Array.isArray(componentes) && componentes.length > 1) } : {}),
  };
  if (componentes.length === 1) {
    const [c] = componentes;
    return {
      ...base,
      symbol: c.simbolo,
      qty: String(cantidad * (c.proporcion || 1)),
      side: c.accion,
      ...(c.intencion ? { position_intent: c.intencion } : {}),
    };
  }
  // Multi-pata: symbol y side se omiten en el nivel superior; qty = unidades de estrategia.
  return {
    ...base,
    order_class: 'mleg',
    qty: String(cantidad),
    legs: componentes.map(c => ({
      symbol: c.simbolo,
      ratio_qty: String(c.proporcion || 1),
      side: c.accion,
      ...(c.intencion ? { position_intent: c.intencion } : {}),
    })),
  };
};

export const createAlpacaClient = ({
  keyId,
  secretKey,
  feed = 'iex',
  opcionesFeed = 'indicative',
  fetch: fetchFn = globalThis.fetch,
  dataUrl = ALPACA_DATA_URL,
  tradingUrl = ALPACA_PAPER_URL,
  timeoutMs,
  intervaloMs = 100,
  esperar,
  ahora,
  maxPaginas = MAX_PAGINAS,
} = {}) => {
  // ADR-005: solo paper. Cualquier otra URL de trading se rechaza al construir.
  if (normalizarUrl(tradingUrl) !== ALPACA_PAPER_URL) {
    throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_PERMITIDO', mensaje: `Solo se permite Alpaca paper (${ALPACA_PAPER_URL}); el entorno live está bloqueado.` });
  }
  if (!/^https:\/\//i.test(String(dataUrl))) throw validacion('dataUrl debe usar https.');
  const baseDatos = String(dataUrl).replace(/\/+$/, '');
  const id = typeof keyId === 'string' ? keyId.trim() : '';
  const secreto = typeof secretKey === 'string' ? secretKey.trim() : '';
  const configurado = Boolean(id && secreto);

  const http = createHttp({
    proveedor: PROVEEDOR, fetch: fetchFn, timeoutMs, intervaloMs, esperar, ahora,
    secretos: [id, secreto],
    headers: configurado ? { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secreto } : {},
  });

  const exigirCredenciales = () => {
    if (!configurado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'SIN_CREDENCIALES', mensaje: 'Faltan ALPACA_KEY_ID / ALPACA_SECRET_KEY en el servidor.' });
  };
  const exigirSimbolo = s => {
    if (!simboloValido(s)) throw validacion('Símbolo inválido.');
    return s.trim().toUpperCase();
  };
  const datos = (ruta, query) => { exigirCredenciales(); return http.request({ url: `${baseDatos}${ruta}`, query }); };
  const trading = (ruta, opciones = {}) => { exigirCredenciales(); return http.request({ url: `${ALPACA_PAPER_URL}${ruta}`, ...opciones }); };

  // Recorre páginas con next_page_token hasta agotar, alcanzar `tope` elementos o maxPaginas.
  const paginar = async (llamar, extraer, tope = Infinity) => {
    const items = [];
    let token;
    for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
      const cuerpo = await llamar(token);
      items.push(...extraer(cuerpo || {}));
      token = cuerpo?.next_page_token;
      if (!token || items.length >= tope) break;
    }
    return Number.isFinite(tope) ? items.slice(0, tope) : items;
  };

  const buscarActivo = async simbolo => {
    const s = exigirSimbolo(simbolo);
    const a = await trading(`/v2/assets/${encodeURIComponent(s)}`);
    return {
      activoExternoId: a.id,
      simbolo: a.symbol,
      nombre: a.name,
      mercado: a.exchange,
      clase: a.class,
      estado: a.status,
      negociable: Boolean(a.tradable),
      opcionable: Array.isArray(a.attributes) ? a.attributes.includes('has_options') : null,
    };
  };

  // Lista de activos negociables de EE. UU. (para búsqueda). Una sola llamada: la respuesta no se pagina.
  const listarActivos = async () => {
    const lista = await trading('/v2/assets', { query: { status: 'active', asset_class: 'us_equity' } });
    return (Array.isArray(lista) ? lista : []).filter(a => a && texto(a.symbol)).map(a => ({
      simbolo: a.symbol,
      nombre: texto(a.name) || a.symbol,
      mercado: a.exchange || null,
      negociable: Boolean(a.tradable),
      opciones: Array.isArray(a.attributes) ? (a.attributes.includes('has_options') || a.attributes.includes('options_enabled')) : false,
    }));
  };

  const velas = async (simbolo, { intervalo = '1Day', desde, hasta, limite = 1000, ajuste = 'split' } = {}) => {
    const s = exigirSimbolo(simbolo);
    const tope = Math.max(1, Math.min(Number(limite) || 1000, 10000));
    return paginar(
      token => datos('/v2/stocks/bars', {
        symbols: s, timeframe: intervalo, start: desde, end: hasta,
        limit: Math.min(tope, 10000), feed, adjustment: ajuste, sort: 'asc', page_token: token,
      }),
      cuerpo => (cuerpo.bars?.[s] || []).map(normalizarVela),
      tope,
    );
  };

  const cotizacion = async simbolo => {
    const s = exigirSimbolo(simbolo);
    const cuerpo = await datos('/v2/stocks/snapshots', { symbols: s, feed });
    const snap = cuerpo?.[s];
    if (!snap) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: `Sin cotización para ${s}.` });
    return {
      simbolo: s,
      bid: num(snap.latestQuote?.bp),
      ask: num(snap.latestQuote?.ap),
      ultimo: num(snap.latestTrade?.p),
      apertura: num(snap.dailyBar?.o),
      maximo: num(snap.dailyBar?.h),
      minimo: num(snap.dailyBar?.l),
      cierre: num(snap.dailyBar?.c),
      volumen: num(snap.dailyBar?.v),
      cierreAnterior: num(snap.prevDailyBar?.c),
      fechaDato: snap.latestTrade?.t || snap.latestQuote?.t || snap.dailyBar?.t || null,
      feed,
    };
  };

  const contratos = async ({ subyacente, vencimientoDesde, vencimientoHasta, tipo, strikeMin, strikeMax, estado = 'active' } = {}) => {
    const s = exigirSimbolo(subyacente);
    if (tipo != null && !['call', 'put'].includes(tipo)) throw validacion('tipo debe ser call o put.');
    return paginar(
      token => trading('/v2/options/contracts', {
        query: {
          underlying_symbols: s,
          expiration_date_gte: fechaIso(vencimientoDesde),
          expiration_date_lte: fechaIso(vencimientoHasta),
          type: tipo, strike_price_gte: strikeMin, strike_price_lte: strikeMax,
          status: estado, limit: 1000, page_token: token,
        },
      }),
      cuerpo => (cuerpo.option_contracts || []).map(normalizarContrato),
    );
  };

  // Acepta un subyacente (cadena completa) o una lista de símbolos OCC.
  const snapshotsOpciones = async (subyacenteOSimbolos, { tipo, vencimiento, vencimientoDesde, vencimientoHasta, strikeMin, strikeMax } = {}) => {
    const extraer = cuerpo => Object.entries(cuerpo.snapshots || {}).map(([sim, snap]) => normalizarSnapshotOpcion(sim, snap));
    if (Array.isArray(subyacenteOSimbolos)) {
      const simbolos = subyacenteOSimbolos.map(exigirSimbolo);
      if (!simbolos.length) return [];
      const resultado = [];
      for (let i = 0; i < simbolos.length; i += 100) {
        const lote = simbolos.slice(i, i + 100);
        resultado.push(...await paginar(
          token => datos('/v1beta1/options/snapshots', { symbols: lote, feed: opcionesFeed, limit: 1000, page_token: token }),
          extraer,
        ));
      }
      return resultado;
    }
    const s = exigirSimbolo(subyacenteOSimbolos);
    return paginar(
      token => datos(`/v1beta1/options/snapshots/${encodeURIComponent(s)}`, {
        feed: opcionesFeed, type: tipo,
        expiration_date: fechaIso(vencimiento),
        expiration_date_gte: fechaIso(vencimientoDesde),
        expiration_date_lte: fechaIso(vencimientoHasta),
        strike_price_gte: strikeMin, strike_price_lte: strikeMax,
        limit: 1000, page_token: token,
      }),
      extraer,
    );
  };

  const noticias = async ({ simbolos, desde, hasta, limite = 50 } = {}) => {
    const lista = simbolos == null ? [] : (Array.isArray(simbolos) ? simbolos : [simbolos]).map(exigirSimbolo);
    const tope = Math.max(1, Math.min(Number(limite) || 50, 1000));
    return paginar(
      token => datos('/v1beta1/news', {
        symbols: lista, start: desde, end: hasta, limit: Math.min(tope, 50), sort: 'desc', page_token: token,
      }),
      cuerpo => (cuerpo.news || []).map(normalizarNoticia),
      tope,
    );
  };

  // --- Trading (solo paper) ---
  const cuenta = async () => {
    const c = await trading('/v2/account');
    return {
      cuentaExternaId: c.id,
      numero: c.account_number,
      estado: c.status,
      moneda: c.currency,
      efectivo: num(c.cash),
      poderCompra: num(c.buying_power),
      patrimonio: num(c.equity),
      nivelOpciones: num(c.options_trading_level),
      entorno: 'paper',
    };
  };

  const enviarOrden = async orden => {
    const cuerpo = construirCuerpoOrden(orden);
    return normalizarOrden(await trading('/v2/orders', { method: 'POST', body: cuerpo }));
  };

  const exigirId = idOrden => {
    if (typeof idOrden !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(idOrden)) throw validacion('Identificador de orden inválido.');
    return encodeURIComponent(idOrden);
  };

  const consultarOrden = async idOrden => normalizarOrden(await trading(`/v2/orders/${exigirId(idOrden)}`, { query: { nested: true } }));

  // DELETE responde 204 sin cuerpo; luego se consulta el estado vigente.
  const cancelarOrden = async idOrden => {
    await trading(`/v2/orders/${exigirId(idOrden)}`, { method: 'DELETE' });
    return consultarOrden(idOrden);
  };

  const posiciones = async () => {
    const lista = await trading('/v2/positions');
    return (Array.isArray(lista) ? lista : []).map(normalizarPosicion);
  };

  return {
    proveedor: PROVEEDOR,
    feed,
    opcionesFeed,
    configurado,
    buscarActivo, listarActivos, velas, cotizacion, contratos, snapshotsOpciones, noticias,
    cuenta, enviarOrden, consultarOrden, cancelarOrden, posiciones,
  };
};
