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
// Únicos hosts de pruebas admitidos (ADR-005): lista exacta, sin coincidencias parciales.
const HOSTS_PRUEBAS = ['api.sandbox.webull.com', 'us-openapi-alb.uat.webullbroker.com'];
const PROVEEDOR = 'webull';

const ESTADOS_ORDEN = {
  PENDING: 'enviada',
  SUBMITTED: 'aceptada',
  PARTIAL_FILLED: 'parcial',
  FILLED: 'ejecutada',
  CANCELLED: 'cancelada',
  CANCELED: 'cancelada',
  FAILED: 'rechazada',
  REJECTED: 'rechazada',
  EXPIRED: 'expirada',
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

// --- Símbolos OCC (Alpaca: AAPL261125C00200000) → pata de Webull. La raíz OCC no lleva punto (BRK.B → BRKB). ---
const OCC = /^([A-Z]{1,6}\d?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
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
  return `${String(simbolo).toUpperCase().replace(/[^A-Z0-9]/g, '')}${f[1].slice(2)}${f[2]}${f[3]}${pata.option_type === 'CALL' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
};

// client_order_id de Webull: el servidor exige de 10 a 40 y la documentación, máx. 32. Se conserva si es alfanumérico de 10 a 32; si no, hash determinista (idempotencia).
export const idClienteWebull = clave => {
  const c = String(clave || '');
  if (/^[A-Za-z0-9]{10,32}$/.test(c)) return c;
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
// Convención: precioLimite positivo; `credito:true` en multi-pata (limit o market) → side SELL (crédito neto), si no BUY (débito).
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
  const o = lista.find(x => x.client_order_id === clientOrderId); // nunca otra orden de la lista
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

// Lado de una posición: solo con evidencia explícita (side) o cantidad negativa; dos evidencias opuestas → null.
const ladoExplicito = x => {
  const v = String(x?.side ?? x?.position_side ?? x?.direction ?? '').trim().toUpperCase();
  return ['BUY', 'LONG'].includes(v) ? 'long' : ['SELL', 'SHORT', 'SELL_SHORT'].includes(v) ? 'short' : null;
};
const negativo = n => (n < 0 ? 'short' : null);
const ladoDe = (evidencias, porDefecto) => {
  const vistas = new Set(evidencias.filter(Boolean));
  if (vistas.size > 1) return null;
  return vistas.size ? [...vistas][0] : porDefecto;
};

// Posición → una entrada por pata. La forma real de la respuesta multi-pata no está documentada: lo que no se pueda
// determinar (lado o cantidad) queda con cerrable:false, nunca supuesto.
export const normalizarPosiciones = p => {
  const total = num(p.quantity), patas = Array.isArray(p.legs) ? p.legs : [];
  const esOpcion = p.instrument_type === 'OPTION';
  const valor = (precio, cantidad, l) => (precio != null && cantidad != null ? precio * cantidad * (esOpcion ? num(l?.option_contract_multiplier) || 100 : 1) : null);
  const idDe = (l, occ, i) => `${p.position_id}:${l.leg_id || occ || i}`;

  if (esOpcion && patas.length > 1) {
    const hayNegativas = patas.some(l => num(l.quantity) < 0);
    const unidades = Math.abs(total ?? 0);
    // Si una pata no es múltiplo del total, su "quantity" parece una proporción y no contratos.
    const cantidadesFiables = patas.every(l => num(l.quantity) && (!unidades || Math.abs(num(l.quantity)) % unidades === 0));
    // Precio, costo y resultado del padre son del conjunto: cada pata solo lleva los suyos (o null).
    return patas.map((l, i) => {
      const occ = pataWebullAOcc(p.symbol, l), q = num(l.quantity), cantidad = q ? Math.abs(q) : null, precioActual = num(l.last_price);
      const lado = ladoDe([ladoExplicito(l), negativo(q)], hayNegativas ? 'long' : null);
      return { posicionExternaId: idDe(l, occ, i), grupoId: p.position_id ?? null, simbolo: occ || String(p.symbol || ''), lado, cantidad,
        precioPromedio: num(l.cost_price), precioActual, valorMercado: valor(precioActual, cantidad, l), claseActivo: 'us_option',
        plNoRealizado: num(l.unrealized_profit_loss), plPctNoRealizado: null, cerrable: Boolean(occ && lado && cantidadesFiables) };
    });
  }
  const [l] = patas, occ = esOpcion && l ? pataWebullAOcc(p.symbol, l) : null;
  const q = total ?? num(l?.quantity), cantidad = q == null ? null : Math.abs(q), precioActual = num(p.last_price);
  const lado = ladoDe([ladoExplicito(l), ladoExplicito(p), negativo(q)], 'long');
  return [{ posicionExternaId: esOpcion && l ? idDe(l, occ, 0) : p.position_id, grupoId: null, simbolo: occ || String(p.symbol || ''), lado, cantidad,
    precioPromedio: num(p.cost_price), precioActual, valorMercado: valor(precioActual, cantidad, l), claseActivo: esOpcion ? 'us_option' : 'us_equity',
    plNoRealizado: num(p.unrealized_profit_loss), plPctNoRealizado: null, cerrable: Boolean(lado && cantidad) }];
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
      if (u.protocol !== 'https:' || u.username || !HOSTS_PRUEBAS.includes(u.host)) bloqueo = 'WEBULL_BASE_URL debe ser https y de un entorno de pruebas (sandbox); producción está bloqueada (ADR-005).';
      else url = normalizarUrl(baseUrl);
    } catch { bloqueo = 'WEBULL_BASE_URL inválida.'; }
  }
  const configurado = Boolean(key && secreto) && !bloqueo;
  const host = new URL(url).host;

  // Sin reintentos en la capa HTTP: cada intento necesita su propia firma (nonce y hora), ver `trading`.
  const http = createHttp({ proveedor: PROVEEDOR, fetch: fetchFn, timeoutMs, reintentos: 0, secretos: [key, secreto, token] });
  const pausar = esperar || (ms => new Promise(resolve => { setTimeout(resolve, ms); }));

  const exigir = () => {
    if (bloqueo) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_PERMITIDO', mensaje: bloqueo });
    if (!configurado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'SIN_CREDENCIALES', mensaje: 'Faltan WEBULL_APP_KEY / WEBULL_APP_SECRET en el servidor.' });
  };

  const intento = (ruta, { method, query, body }) => {
    const marca = ahora().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const firmados = { 'x-app-key': key, 'x-signature-algorithm': 'HMAC-SHA1', 'x-signature-version': '1.0', 'x-signature-nonce': nonce(), 'x-timestamp': marca, host };
    const cuerpo = body !== undefined ? JSON.stringify(body) : undefined;
    const limpioQ = Object.fromEntries(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const firma = firmar({ ruta, query: limpioQ, encabezados: firmados, cuerpo, appSecret: secreto });
    const { host: _h, ...enviar } = firmados; void _h;
    return http.request({ url: `${url}${ruta}`, method, query: limpioQ, body,
      headers: { ...enviar, 'x-signature': firma, 'x-version': 'v3', ...(token ? { 'x-access-token': token } : {}) } });
  };
  // 429 (no procesada) se reintenta siempre; 5xx solo en lecturas, para no duplicar órdenes.
  const trading = async (ruta, { method = 'GET', query, body } = {}) => {
    exigir();
    for (let n = 0; ; n += 1) {
      try { return await intento(ruta, { method, query, body }); }
      catch (e) {
        const reintentable = e?.status === 429 || (e?.status >= 500 && method === 'GET');
        if (!reintentable || n >= 2) throw e;
        await pausar(500 * 2 ** n);
      }
    }
  };

  const listaCuentas = async () => { const l = await trading('/trading/accounts/list'); return Array.isArray(l) ? l : (Array.isArray(l?.accounts) ? l.accounts : []); };
  // WEBULL_ACCOUNT_ID admite el account_id de la API o el número de cuenta que muestra la web (account_number).
  let cuentaIdCache = null;
  const idCuenta = async () => {
    if (cuentaIdCache) return cuentaIdCache;
    const l = await listaCuentas();
    if (cuentaCfg) {
      const c = l.find(x => x.account_id === cuentaCfg) || l.find(x => x.account_number === cuentaCfg);
      if (!c) throw validacion('WEBULL_ACCOUNT_ID no coincide con ninguna cuenta de pruebas de Webull (usa el account_id o el número de cuenta).');
      cuentaIdCache = c.account_id;
    } else {
      if (l.length !== 1) throw validacion('Define WEBULL_ACCOUNT_ID: la cuenta de Webull no se pudo determinar de forma única.');
      cuentaIdCache = l[0].account_id;
    }
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
  // Recupera una orden por la Idempotency-Key con la que se envió (NO_ENCONTRADO si nunca llegó).
  const consultarPorClientOrderId = async clave => {
    try { return await consultarOrden(idClienteWebull(clave)); }
    catch (e) {
      // El código HTTP de "no existe" no está documentado: se reconoce también por el mensaje.
      if (e?.status >= 400 && e.status < 500 && /not.?(found|exist)|no existe/i.test(e.mensaje || '')) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: 'Orden no encontrada en Webull.' });
      throw e;
    }
  };
  const cancelarOrden = async id => {
    exigir();
    const cid = exigirId(id);
    await trading('/trading/orders/cancel', { method: 'POST', body: { account_id: await idCuenta(), client_order_id: cid } });
    return consultarOrden(cid);
  };
  const posiciones = async () => {
    exigir();
    const r = await trading('/trading/assets/positions/list', { query: { account_id: await idCuenta() } });
    const lista = Array.isArray(r) ? r : r?.positions;
    // Nunca tratar una respuesta irreconocible como "sin posiciones": cerraría las guardadas.
    if (!Array.isArray(lista)) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'PROVEEDOR', mensaje: 'Webull devolvió posiciones en un formato no reconocido.' });
    return lista.flatMap(normalizarPosiciones);
  };

  const cliente = { proveedor: PROVEEDOR, configurado, entorno: 'paper', cuenta, enviarOrden, consultarOrden, consultarPorClientOrderId, cancelarOrden, posiciones };
  for (const m of ['buscarActivo', 'listarActivos', 'velas', 'cotizacion', 'contratos', 'snapshotsOpciones', 'noticias']) cliente[m] = async () => { throw noImplementado(m); };
  return cliente;
};
