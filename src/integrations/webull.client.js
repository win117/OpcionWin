// Adaptador de Webull OpenAPI (ADR-004): solo TRADING en entorno de pruebas (paper/sandbox, ADR-005).
// Documentación consultada: developer.webull.com (autenticación/firma, Trading API: cuentas, órdenes, opciones, posiciones).
// - Host de pruebas: https://api.sandbox.webull.com (el host de producción api.webull.com está bloqueado en código).
// - Firma: HMAC-SHA1, clave = AppSecret + "&", ver `firmar`.
// - Datos de mercado (velas, cotizaciones, cadena, noticias) NO se implementan aquí: siguen viniendo de Alpaca.
// Soporte: cuenta/saldos, órdenes de opciones (el ticket de la app es solo de opciones; no se envían órdenes de acciones): una pata (SINGLE) y multi-pata
// (VERTICAL, STRADDLE, STRANGLE, CALENDAR, DIAGONAL, BUTTERFLY, CONDOR, IRON_BUTTERFLY, IRON_CONDOR), consulta y cancelación
// por client_order_id, posiciones. No soportado: replace, TP/SL (MASTER/STOP_*), OTO/OCO, eventos gRPC.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { IntegrationError } from './errors';
import { createHttp } from './http';

export const WEBULL_SANDBOX_URL = 'https://api.sandbox.webull.com';
const PROVEEDOR = 'webull';

const ESTADOS_ORDEN = {
  PENDING: 'enviada',
  SUBMITTED: 'aceptada',
  PARTIAL_FILLED: 'parcial',
  FILLED: 'ejecutada',
  CANCELLED: 'cancelada',
  CANCELED: 'cancelada',
  FAILED: 'rechazada',
};
export const mapearEstadoOrden = status => ESTADOS_ORDEN[String(status || '').toUpperCase()] || 'enviada';

const num = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const validacion = mensaje => new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje });
const noImplementado = metodo => new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_IMPLEMENTADO',
  mensaje: `Webull solo opera trading: ${metodo} no está disponible (los datos de mercado vienen de Alpaca).` });

// --- Firma (https://developer.webull.com/apis/docs/authentication/signature) ---
const SEP_FIRMA = '&';
export const firmar = ({ ruta, query = {}, encabezados = {}, cuerpo, appSecret }) => {
  const grupos = new Map();
  const agregar = (k, v) => { if (v === undefined || v === null || v === '') return; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(String(v)); };
  for (const [k, v] of Object.entries(query)) (Array.isArray(v) ? v : [v]).forEach(x => agregar(k, x));
  for (const [k, v] of Object.entries(encabezados)) agregar(k, v);
  const str1 = [...grupos.keys()].sort().map(k => `${k}=${grupos.get(k).sort().join(SEP_FIRMA)}`).join(SEP_FIRMA);
  let str3 = `${ruta}${SEP_FIRMA}${str1}`;
  if (cuerpo !== undefined && cuerpo !== null && cuerpo !== '') str3 += SEP_FIRMA + createHash('md5').update(cuerpo, 'utf8').digest('hex').toUpperCase();
  return createHmac('sha1', `${appSecret}&`).update(encodeURIComponent(str3), 'utf8').digest('base64');
};

// --- Símbolos OCC (Alpaca: AAPL261125C00200000) → pata de Webull ---
const OCC = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export const occAPataWebull = simbolo => {
  const m = OCC.exec(String(simbolo || '').trim().toUpperCase());
  if (!m) throw validacion('Símbolo OCC inválido: ' + String(simbolo).slice(0, 40));
  return { symbol: m[1], option_expire_date: `20${m[2]}-${m[3]}-${m[4]}`, option_type: m[5] === 'C' ? 'CALL' : 'PUT', strike_price: (Number(m[6]) / 1000).toFixed(2) };
};
// Inverso: pata de posición de Webull → símbolo OCC (para casar con los contratos sincronizados de Alpaca).
export const pataWebullAOcc = (simbolo, pata) => {
  const strike = num(pata?.option_exercise_price ?? pata?.strike_price);
  const f = /^(\d{4})-(\d{2})-(\d{2})/.exec(pata?.option_expire_date || '');
  if (!f || strike == null || !['CALL', 'PUT'].includes(pata?.option_type)) return null;
  return `${String(simbolo).toUpperCase()}${f[1].slice(2)}${f[2]}${f[3]}${pata.option_type === 'CALL' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
};

// client_order_id de Webull: máx. 32 caracteres. Se conserva si es alfanumérico ≤32; si no, hash determinista (idempotencia).
export const idClienteWebull = clave => {
  const c = String(clave || '');
  if (/^[A-Za-z0-9]{1,32}$/.test(c)) return c;
  if (!c) throw validacion('clientOrderId requerido.');
  return createHash('sha256').update(c).digest('hex').slice(0, 32);
};

const formatearPrecio = n => String(Number(n.toFixed(Math.abs(n) >= 1 ? 2 : 4)));

// Deduce option_strategy a partir de las patas (ya convertidas).
export const detectarEstrategia = patas => {
  const n = patas.length;
  if (n === 1) return 'SINGLE';
  const tipos = new Set(patas.map(p => p.option_type)), venc = new Set(patas.map(p => p.option_expire_date)), strikes = new Set(patas.map(p => p.strike_price));
  const mismoVenc = venc.size === 1;
  if (n === 2) {
    if (tipos.size === 1 && mismoVenc && strikes.size === 2) return 'VERTICAL';
    if (tipos.size === 2 && mismoVenc) return strikes.size === 1 ? 'STRADDLE' : 'STRANGLE';
    if (tipos.size === 1 && venc.size === 2) return strikes.size === 1 ? 'CALENDAR' : 'DIAGONAL';
  }
  if (n === 3 && tipos.size === 1 && mismoVenc && strikes.size === 3) return 'BUTTERFLY';
  if (n === 4 && mismoVenc) {
    if (tipos.size === 2 && strikes.size === 4) return 'IRON_CONDOR';
    if (tipos.size === 2 && strikes.size === 3) return 'IRON_BUTTERFLY';
    if (tipos.size === 1 && strikes.size === 4) return 'CONDOR';
  }
  throw validacion('Webull: combinación de patas no reconocida como estrategia soportada (vertical, straddle, strangle, calendar, diagonal, butterfly, condor, iron condor, iron butterfly).');
};

// Cuerpo de POST /trading/orders/place a partir de una orden neutral (misma forma que Alpaca).
// Convención: precioLimite positivo; `credito:true` en multi-pata → side SELL (crédito neto), si no BUY (débito).
// (La documentación de Webull no define precio negativo; se asume side del combo = SELL para crédito.)
export const construirCuerpoOrden = (orden, accountId) => {
  if (!orden || typeof orden !== 'object') throw validacion('Orden requerida.');
  const { clientOrderId, tipo, vigencia = 'day', cantidad, precioLimite, componentes, credito = false } = orden;
  if (typeof clientOrderId !== 'string' || !clientOrderId.trim() || clientOrderId.length > 128) throw validacion('clientOrderId requerido (máximo 128 caracteres).');
  if (!['market', 'limit'].includes(tipo)) throw validacion('tipo debe ser market o limit.');
  if (!['day', 'gtc'].includes(vigencia)) throw validacion('vigencia debe ser day o gtc.');
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) throw validacion('cantidad debe ser un entero positivo.');
  if (tipo === 'limit' && !(Number.isFinite(precioLimite) && precioLimite > 0)) throw validacion('precioLimite (positivo) requerido para orden limit.');
  if (tipo === 'market' && precioLimite != null) throw validacion('Una orden market no lleva precioLimite.');
  if (credito && tipo !== 'limit') throw validacion('credito requiere una orden limit.');
  if (!Array.isArray(componentes) || componentes.length < 1 || componentes.length > 4) throw validacion('Se requieren de 1 a 4 componentes.');
  for (const c of componentes) {
    if (!['buy', 'sell'].includes(c?.accion)) throw validacion('accion debe ser buy o sell.');
    if (c.intencion != null && !String(c.intencion).startsWith(`${c.accion}_`)) throw validacion('La intención debe corresponder a la acción.');
    if (c.proporcion != null && (!Number.isSafeInteger(c.proporcion) || c.proporcion < 1)) throw validacion('proporcion debe ser un entero positivo.');
  }
  if (credito && componentes.length < 2) throw validacion('credito solo aplica a órdenes multi-pata.');
  const patasOcc = componentes.map(c => occAPataWebull(c.simbolo));
  const subyacentes = new Set(patasOcc.map(p => p.symbol));
  if (subyacentes.size !== 1) throw validacion('Todas las patas deben compartir el subyacente.');
  const base = {
    client_order_id: idClienteWebull(clientOrderId),
    combo_type: 'NORMAL',
    order_type: tipo === 'limit' ? 'LIMIT' : 'MARKET',
    ...(tipo === 'limit' ? { limit_price: formatearPrecio(precioLimite) } : {}),
    time_in_force: vigencia.toUpperCase(),
    entrust_type: 'QTY',
    instrument_type: 'OPTION',
    market: 'US',
    symbol: patasOcc[0].symbol,
  };
  const pata = (p, c, qty) => ({ side: c.accion.toUpperCase(), quantity: String(qty), symbol: p.symbol, strike_price: p.strike_price,
    option_expire_date: p.option_expire_date, instrument_type: 'OPTION', option_type: p.option_type, market: 'US' });
  let nuevaOrden;
  if (componentes.length === 1) {
    const [c] = componentes, qty = cantidad * (c.proporcion || 1);
    nuevaOrden = { ...base, option_strategy: 'SINGLE', side: c.accion.toUpperCase(), quantity: String(qty),
      ...(c.intencion ? { position_intent: c.intencion.toUpperCase() } : {}), legs: [pata(patasOcc[0], c, qty)] };
  } else {
    nuevaOrden = { ...base, option_strategy: detectarEstrategia(patasOcc), side: credito ? 'SELL' : 'BUY', quantity: String(cantidad),
      legs: componentes.map((c, i) => pata(patasOcc[i], c, c.proporcion || 1)) };
  }
  return { ...(accountId ? { account_id: accountId } : {}), new_orders: [nuevaOrden] };
};

// --- Normalizadores ---
export const normalizarOrden = (cuerpo, clientOrderId) => {
  const lista = Array.isArray(cuerpo?.orders) ? cuerpo.orders : [];
  const o = lista.find(x => x.client_order_id === clientOrderId) || lista[0];
  if (!o) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: 'Orden no encontrada en Webull.' });
  return {
    ordenExternaId: o.client_order_id,
    clientOrderId: o.client_order_id,
    ordenInternaId: o.order_id ?? null,
    estado: mapearEstadoOrden(o.status),
    estadoProveedor: o.status,
    claseOrden: o.option_strategy && o.option_strategy !== 'SINGLE' ? 'mleg' : 'simple',
    cantidad: num(o.total_quantity),
    cantidadEjecutada: num(o.filled_quantity) || 0,
    precioPromedioEjecucion: num(o.filled_price),
    creadaEn: o.place_time_at || null,
    actualizadaEn: o.filled_time_at || null,
    componentes: Array.isArray(o.legs) ? o.legs.map(l => ({ ordenExternaId: l.id, simbolo: pataWebullAOcc(l.symbol, l) || l.symbol, accion: String(l.side || '').toLowerCase(), proporcion: num(l.quantity) })) : [],
  };
};

const normalizarPosiciones = p => {
  const cantidad = num(p.quantity) ?? 0, precioActual = num(p.last_price), costo = num(p.cost_price), lado = cantidad < 0 ? 'short' : 'long';
  const comunes = { lado, precioPromedio: costo, precioActual, plNoRealizado: num(p.unrealized_profit_loss) };
  if (p.instrument_type === 'OPTION' && Array.isArray(p.legs) && p.legs.length) {
    return p.legs.map(l => ({ ...comunes, posicionExternaId: l.leg_id || p.position_id, simbolo: pataWebullAOcc(p.symbol, l) || p.symbol,
      cantidad: Math.abs(num(l.quantity) ?? cantidad), valorMercado: precioActual != null ? precioActual * Math.abs(num(l.quantity) ?? cantidad) * (num(l.option_contract_multiplier) || 100) : null,
      claseActivo: 'us_option', plPctNoRealizado: null }));
  }
  const esOpcion = p.instrument_type === 'OPTION';
  return [{ ...comunes, posicionExternaId: p.position_id, simbolo: p.symbol, cantidad: Math.abs(cantidad),
    valorMercado: precioActual != null ? precioActual * Math.abs(cantidad) * (esOpcion ? 100 : 1) : null,
    claseActivo: esOpcion ? 'us_option' : 'us_equity', plPctNoRealizado: null }];
};

const normalizarUrl = u => String(u).trim().replace(/\/+$/, '');

export const createWebullClient = ({
  appKey, appSecret, accountId, entorno = 'paper', baseUrl, accessToken,
  fetch: fetchFn = globalThis.fetch, ahora = () => new Date(), nonce = () => randomUUID().replace(/-/g, ''),
  timeoutMs, esperar,
} = {}) => {
  const limpio = v => (typeof v === 'string' ? v.trim() : '');
  const key = limpio(appKey), secreto = limpio(appSecret), cuentaCfg = limpio(accountId), token = limpio(accessToken);
  const entornoOk = (limpio(entorno) || 'paper').toLowerCase() === 'paper';
  // ADR-005: solo paper. Un entorno distinto o un host que no sea de pruebas deja el cliente inoperante.
  let url = WEBULL_SANDBOX_URL, bloqueo = null;
  if (!entornoOk) bloqueo = 'Solo se permite Webull paper (entorno de pruebas); el entorno live está bloqueado (ADR-005).';
  else if (limpio(baseUrl)) {
    try {
      const u = new URL(normalizarUrl(baseUrl));
      if (u.protocol !== 'https:' || !/sandbox|uat|test/i.test(u.hostname)) bloqueo = 'WEBULL_BASE_URL debe ser https y de un entorno de pruebas (sandbox); producción está bloqueada (ADR-005).';
      else url = normalizarUrl(baseUrl);
    } catch { bloqueo = 'WEBULL_BASE_URL inválida.'; }
  }
  const configurado = Boolean(key && secreto) && !bloqueo;
  const host = new URL(url).host;

  const http = createHttp({ proveedor: PROVEEDOR, fetch: fetchFn, timeoutMs, esperar, secretos: [key, secreto, token] });

  const exigir = () => {
    if (bloqueo) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_PERMITIDO', mensaje: bloqueo });
    if (!configurado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'SIN_CREDENCIALES', mensaje: 'Faltan WEBULL_APP_KEY / WEBULL_APP_SECRET en el servidor.' });
  };

  const trading = (ruta, { method = 'GET', query, body } = {}) => {
    exigir();
    const marca = ahora().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const firmados = { 'x-app-key': key, 'x-signature-algorithm': 'HMAC-SHA1', 'x-signature-version': '1.0', 'x-signature-nonce': nonce(), 'x-timestamp': marca, host };
    const cuerpo = body !== undefined ? JSON.stringify(body) : undefined;
    const limpioQ = Object.fromEntries(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const firma = firmar({ ruta, query: limpioQ, encabezados: firmados, cuerpo, appSecret: secreto });
    const { host: _h, ...enviar } = firmados; void _h;
    return http.request({ url: `${url}${ruta}`, method, query: limpioQ, body,
      headers: { ...enviar, 'x-signature': firma, 'x-version': 'v3', ...(token ? { 'x-access-token': token } : {}) } });
  };

  let cuentaIdCache = cuentaCfg || null;
  const listaCuentas = async () => { const l = await trading('/trading/accounts/list'); return Array.isArray(l) ? l : (Array.isArray(l?.accounts) ? l.accounts : []); };
  const idCuenta = async () => {
    if (cuentaIdCache) return cuentaIdCache;
    const l = await listaCuentas();
    if (l.length !== 1) throw validacion('Define WEBULL_ACCOUNT_ID: la cuenta de Webull no se pudo determinar de forma única.');
    cuentaIdCache = l[0].account_id;
    return cuentaIdCache;
  };

  const cuenta = async () => {
    exigir();
    const id = await idCuenta();
    const [lista, b] = await Promise.all([listaCuentas().catch(() => []), trading('/trading/assets/balances/get', { query: { account_id: id } })]);
    const info = lista.find(a => a.account_id === id) || {};
    const m = (b?.account_currency_assets || []).find(x => x.currency === 'USD') || b?.account_currency_assets?.[0] || {};
    return {
      cuentaExternaId: id,
      numero: info.account_number ?? null,
      estado: 'ACTIVE',
      moneda: b?.total_asset_currency || m.currency || 'USD',
      efectivo: num(b?.total_cash_balance ?? m.cash_balance),
      poderCompra: num(m.option_buying_power ?? m.buying_power),
      patrimonio: num(b?.total_net_liquidation_value ?? m.net_liquidation_value),
      nivelOpciones: null, // Webull no expone el nivel de opciones en este endpoint
      entorno: 'paper',
    };
  };

  const enviarOrden = async orden => {
    exigir();
    const cuerpo = construirCuerpoOrden(orden, await idCuenta());
    const r = await trading('/trading/orders/place', { method: 'POST', body: cuerpo });
    const clientOrderId = cuerpo.new_orders[0].client_order_id;
    // La respuesta solo trae identificadores: el estado inicial es "enviada" (se refresca con consultarOrden / sincronización).
    return { ordenExternaId: r?.client_order_id || clientOrderId, clientOrderId, ordenInternaId: r?.order_id ?? null, estado: 'enviada', estadoProveedor: 'SUBMITTED_REQUEST',
      claseOrden: cuerpo.new_orders[0].option_strategy === 'SINGLE' ? 'simple' : 'mleg', cantidad: Number(cuerpo.new_orders[0].quantity), cantidadEjecutada: 0, componentes: [] };
  };

  const exigirId = id => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw validacion('Identificador de orden inválido.');
    return id;
  };
  const consultarOrden = async id => {
    exigir();
    const cid = exigirId(id);
    return normalizarOrden(await trading('/trading/orders/get', { query: { account_id: await idCuenta(), client_order_id: cid } }), cid);
  };
  const cancelarOrden = async id => {
    exigir();
    const cid = exigirId(id);
    await trading('/trading/orders/cancel', { method: 'POST', body: { account_id: await idCuenta(), client_order_id: cid } });
    return consultarOrden(cid);
  };
  const posiciones = async () => {
    exigir();
    const l = await trading('/trading/assets/positions/list', { query: { account_id: await idCuenta() } });
    return (Array.isArray(l) ? l : (Array.isArray(l?.positions) ? l.positions : [])).flatMap(normalizarPosiciones);
  };

  const cliente = { proveedor: PROVEEDOR, configurado, entorno: 'paper', cuenta, enviarOrden, consultarOrden, cancelarOrden, posiciones };
  for (const m of ['buscarActivo', 'listarActivos', 'velas', 'cotizacion', 'contratos', 'snapshotsOpciones', 'noticias']) cliente[m] = async () => { throw noImplementado(m); };
  return cliente;
};
