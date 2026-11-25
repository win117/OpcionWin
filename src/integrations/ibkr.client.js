// Interactive Brokers por su Client Portal Gateway: un programa de IBKR que corre en tu equipo y en el que inicias sesión en el navegador.
// La aplicación nunca ve tu usuario ni tu contraseña: solo habla con ese programa. Únicamente cuentas simuladas (empiezan con DU o DF).
import https from 'node:https';
import http from 'node:http';
import { IntegrationError } from './errors';
import { createHttp } from './http';

const PROVEEDOR = 'ibkr';
const LOCALES = ['localhost', '127.0.0.1', '[::1]'];
const COMBO_USD = '28812380'; // identificador de IBKR para estructuras en dólares
const MAX_AVISOS = 6, MAX_PAGINAS = 10;
const MESES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ESTADOS = { PENDINGSUBMIT: 'enviada', PRESUBMITTED: 'aceptada', SUBMITTED: 'aceptada', PENDINGCANCEL: 'aceptada', FILLED: 'ejecutada', CANCELLED: 'cancelada', APICANCELLED: 'cancelada', INACTIVE: 'rechazada', REJECTED: 'rechazada', EXPIRED: 'expirada' };
export const mapearEstadoOrden = (estado, ejecutada = 0) => {
  const e = ESTADOS[String(estado || '').replace(/[^A-Za-z]/g, '').toUpperCase()] || 'enviada';
  return e === 'aceptada' && ejecutada > 0 ? 'parcial' : e;
};

const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const fallo = (codigo, mensaje, status = null) => new IntegrationError({ proveedor: PROVEEDOR, codigo, mensaje, status });
const validacion = m => fallo('VALIDACION', m);

const OCC = /^([A-Z]{1,6})\d?(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export const leerOcc = simbolo => {
  const m = OCC.exec(String(simbolo || '').trim().toUpperCase());
  if (!m) throw validacion('Símbolo OCC inválido: ' + String(simbolo).slice(0, 40));
  return { subyacente: m[1], mes: MESES[Number(m[3]) - 1] + m[2], vencimiento: `20${m[2]}${m[3]}${m[4]}`, derecho: m[5], strike: Number(m[6]) / 1000 };
};
export const aOcc = ({ simbolo, vencimiento, derecho, strike }) => {
  const s = String(simbolo || '').toUpperCase().replace(/[^A-Z]/g, ''), v = String(vencimiento || ''), d = String(derecho || '')[0], k = num(strike);
  return s && /^\d{8}$/.test(v) && ['C', 'P'].includes(d) && k > 0 ? `${s}${v.slice(2)}${d}${String(Math.round(k * 1000)).padStart(8, '0')}` : null;
};

/** Orden neutral → cuerpo de IBKR. `conids`: contrato de IBKR de cada componente. Las estructuras se compran; un crédito es un precio negativo. */
export function construirCuerpoOrden(orden, cuenta, conids) {
  const { clientOrderId, tipo, vigencia = 'day', cantidad, precioLimite, componentes, credito = false } = orden || {};
  if (typeof clientOrderId !== 'string' || !/^[\w-]{1,128}$/.test(clientOrderId)) throw validacion('clientOrderId requerido (máximo 128 caracteres).');
  if (!['market', 'limit'].includes(tipo)) throw validacion('tipo debe ser market o limit.');
  if (!['day', 'gtc'].includes(vigencia)) throw validacion('vigencia debe ser day o gtc.');
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) throw validacion('cantidad debe ser un entero positivo.');
  if (tipo === 'limit' && !(Number.isFinite(precioLimite) && precioLimite > 0)) throw validacion('precioLimite (positivo) requerido para orden limit.');
  if (tipo === 'market' && precioLimite != null) throw validacion('Una orden market no lleva precioLimite.');
  if (!Array.isArray(componentes) || componentes.length < 1 || componentes.length > 4) throw validacion('Se requieren de 1 a 4 componentes.');
  for (const c of componentes) {
    if (!['buy', 'sell'].includes(c?.accion)) throw validacion('accion debe ser buy o sell.');
    if (c.proporcion != null && (!Number.isSafeInteger(c.proporcion) || c.proporcion < 1)) throw validacion('proporcion debe ser un entero positivo.');
  }
  if (credito && componentes.length < 2) throw validacion('credito solo aplica a órdenes multi-pata.');
  if (new Set(componentes.map(c => leerOcc(c.simbolo).subyacente)).size > 1) throw validacion('Todas las patas deben compartir el subyacente.');
  const una = componentes.length === 1, [c] = componentes;
  return { orders: [{
    acctId: cuenta, cOID: clientOrderId, orderType: tipo === 'limit' ? 'LMT' : 'MKT', tif: vigencia.toUpperCase(),
    ...(tipo === 'limit' ? { price: credito ? -precioLimite : precioLimite } : {}),
    ...(una
      ? { conid: Number(conids[0]), side: c.accion.toUpperCase(), quantity: cantidad * (c.proporcion || 1) }
      : { conidex: `${COMBO_USD};;;${componentes.map((x, i) => `${conids[i]}/${(x.accion === 'sell' ? -1 : 1) * (x.proporcion || 1)}`).join(',')}`, side: 'BUY', quantity: cantidad }),
  }] };
}

export const normalizarOrden = o => {
  const ejecutada = num(o.filledQuantity ?? o.cum_fill) || 0, precio = num(o.avgPrice ?? o.average_price), estado = o.status ?? o.order_status;
  return {
    ordenExternaId: String(o.orderId ?? o.order_id), clientOrderId: o.order_ref ?? o.cOID ?? null, estado: mapearEstadoOrden(estado, ejecutada), estadoProveedor: estado,
    claseOrden: /;;;/.test(o.conidex || '') ? 'mleg' : 'simple', cantidad: num(o.totalSize ?? o.total_size), cantidadEjecutada: ejecutada,
    precioPromedioEjecucion: precio == null || !ejecutada ? null : Math.abs(precio), componentes: [],
  };
};

export const normalizarPosicion = p => {
  const q = num(p.position) ?? 0, opcion = p.assetClass === 'OPT';
  const occ = opcion ? aOcc({ simbolo: p.undSym || p.ticker, vencimiento: p.expiry, derecho: p.putOrCall, strike: p.strike }) : null;
  return { posicionExternaId: String(p.conid), grupoId: null, simbolo: occ || String(p.ticker || p.contractDesc || ''), lado: q < 0 ? 'short' : 'long', cantidad: Math.abs(q),
    precioPromedio: num(p.avgPrice), precioActual: num(p.mktPrice), valorMercado: num(p.mktValue), claseActivo: opcion ? 'us_option' : 'us_equity',
    plNoRealizado: num(p.unrealizedPnl), plPctNoRealizado: null, cerrable: Boolean(q && (!opcion || occ)) };
};

/** fetch mínimo para el programa local: su certificado es propio (autofirmado). Solo se usa con direcciones de este mismo equipo. */
export const fetchLocal = (url, { method = 'GET', headers = {}, body, signal } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  if (!LOCALES.includes(u.hostname)) { reject(new Error('Solo direcciones locales.')); return; }
  const seguro = u.protocol === 'https:', cuerpo = body ? Buffer.from(body) : null;
  const req = (seguro ? https : http).request(u, { method, signal, headers: { ...headers, 'User-Agent': 'AppRESTOpciones', 'Content-Length': cuerpo ? cuerpo.length : 0 }, ...(seguro ? { rejectUnauthorized: false } : {}) }, res => {
    const trozos = [];
    res.on('data', d => trozos.push(d)); res.on('error', reject);
    res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, headers: new Headers(Object.entries(res.headers).filter(([, v]) => typeof v === 'string')), text: async () => Buffer.concat(trozos).toString('utf8') }));
  });
  req.on('error', reject);
  req.end(cuerpo || undefined);
});

export const createIbkrClient = ({ gatewayUrl, accountId, fetch, timeoutMs, esperar, ahora = Date.now } = {}) => {
  const limpio = v => (typeof v === 'string' ? v.trim() : '');
  let url = limpio(gatewayUrl).replace(/\/+$/, ''), bloqueo = null, local = false;
  if (url) {
    try {
      const u = new URL(url);
      local = LOCALES.includes(u.hostname);
      if (u.username || !(u.protocol === 'https:' || (local && u.protocol === 'http:'))) bloqueo = 'IBKR_GATEWAY_URL debe ser https (o una dirección de este equipo) y sin credenciales.';
      if (u.pathname === '/') url += '/v1/api';
    } catch { bloqueo = 'IBKR_GATEWAY_URL inválida.'; }
  }
  const configurado = Boolean(url) && !bloqueo, cuentaCfg = limpio(accountId).toUpperCase();
  const dormir = esperar || (ms => new Promise(r => { setTimeout(r, ms); }));
  const cliente = createHttp({ proveedor: PROVEEDOR, fetch: fetch || (local ? fetchLocal : globalThis.fetch), timeoutMs, reintentos: 0, secretos: [] });

  const pedir = async (ruta, { method = 'GET', query, body } = {}) => {
    if (bloqueo) throw fallo('NO_PERMITIDO', bloqueo);
    if (!configurado) throw fallo('SIN_CREDENCIALES', 'Falta IBKR_GATEWAY_URL en el servidor (el Client Portal Gateway de IBKR debe estar en marcha).');
    try { return await cliente.request({ url: url + ruta, method, query, body }); }
    catch (e) {
      if (e?.status === 401 || e?.status === 403) throw fallo('SIN_CREDENCIALES', 'Inicia sesión en el Client Portal Gateway de Interactive Brokers con tu usuario de paper y vuelve a intentar.', e.status);
      if (e?.codigo === 'RED' && method === 'GET') throw fallo('SIN_CREDENCIALES', 'No responde el Client Portal Gateway de Interactive Brokers: ábrelo e inicia sesión con tu usuario de paper.');
      throw e;
    }
  };

  // La cuenta se comprueba en cada arranque: si no es simulada, no se puede hacer nada con ella.
  let sesion = null;
  const idCuenta = async () => {
    if (sesion && ahora() - sesion.t < 60000) return sesion.id;
    const r = await pedir('/iserver/accounts'), lista = Array.isArray(r?.accounts) ? r.accounts : [];
    const id = cuentaCfg || (lista.length === 1 ? lista[0] : r?.selectedAccount);
    if (!id || !lista.includes(id)) throw validacion('La cuenta de Interactive Brokers no se pudo determinar: define IBKR_ACCOUNT_ID.');
    if (!/^D[UF]\w+$/.test(id) || r?.isPaper === false) throw fallo('NO_PERMITIDO', 'Solo se permite una cuenta simulada (paper) de Interactive Brokers; las reales están bloqueadas (ADR-005).');
    sesion = { id, t: ahora() };
    return id;
  };

  const contratos = new Map(); // OCC → conid y conid → OCC: no cambian
  const conidDe = async occ => {
    if (contratos.has(occ)) return contratos.get(occ);
    const c = leerOcc(occ), encontrados = await pedir('/iserver/secdef/search', { query: { symbol: c.subyacente, secType: 'STK' } });
    const s = (Array.isArray(encontrados) ? encontrados : []).find(x => String(x.symbol || c.subyacente).toUpperCase() === c.subyacente && (x.sections || []).some(y => y.secType === 'OPT' && String(y.months || '').includes(c.mes)));
    if (!s) throw validacion(`Interactive Brokers no tiene opciones de ${c.subyacente} para ese mes.`);
    const info = await pedir('/iserver/secdef/info', { query: { conid: s.conid, sectype: 'OPT', month: c.mes, strike: c.strike, right: c.derecho, exchange: 'SMART' } });
    const k = (Array.isArray(info) ? info : []).find(x => String(x.maturityDate) === c.vencimiento && num(x.strike) === c.strike && x.right === c.derecho);
    if (!k?.conid) throw validacion('Interactive Brokers no tiene ese contrato: ' + occ);
    contratos.set(occ, String(k.conid)); contratos.set(String(k.conid), occ);
    return String(k.conid);
  };
  const occDe = async conid => {
    const id = String(conid);
    if (contratos.has(id)) return contratos.get(id);
    const i = await pedir(`/iserver/contract/${encodeURIComponent(id)}/info`).catch(() => null);
    const occ = i && aOcc({ simbolo: i.symbol, vencimiento: i.maturity_date, derecho: i.right, strike: i.strike });
    if (occ) { contratos.set(id, occ); contratos.set(occ, id); }
    return occ;
  };

  const vivas = async () => {
    await idCuenta();
    // La primera consulta de una sesión solo activa la suscripción y puede llegar vacía.
    let r = await pedir('/iserver/account/orders', { query: { force: 'true' } });
    if (!r?.orders?.length && r?.snapshot === false) { await dormir(800); r = await pedir('/iserver/account/orders'); }
    return Array.isArray(r?.orders) ? r.orders : [];
  };
  const componentesDe = async o => {
    const partes = /;;;(.+)$/.exec(o.conidex || '')?.[1]?.split(',').map(x => x.split('/')) || (o.secType === 'OPT' || o.conid ? [[o.conid, 1]] : []);
    const lista = await Promise.all(partes.map(async ([conid, n]) => ({ simbolo: await occDe(conid), accion: (Number(n) < 0) !== (String(o.side || 'BUY').toUpperCase().startsWith('S')) ? 'sell' : 'buy', intencion: null })));
    return lista.filter(c => c.simbolo);
  };
  const exigirId = id => { if (!/^\d{1,20}$/.test(String(id))) throw validacion('Identificador de orden inválido.'); return String(id); };

  const consultarOrden = async id => {
    const oid = exigirId(id);
    await idCuenta();
    try { return { ...normalizarOrden(await pedir(`/iserver/account/order/status/${oid}`)), ordenExternaId: oid }; }
    catch (e) {
      const o = (await vivas().catch(() => [])).find(x => String(x.orderId) === oid);
      if (o) return normalizarOrden(o);
      throw e;
    }
  };

  return {
    proveedor: PROVEEDOR, configurado, entorno: 'paper',
    async cuenta() {
      const id = await idCuenta(), r = await pedir(`/portfolio/accounts`).then(() => pedir(`/portfolio/${id}/summary`));
      return { cuentaExternaId: id, numero: id, estado: 'ACTIVE', moneda: r?.netliquidation?.currency || 'USD', efectivo: num(r?.totalcashvalue?.amount), poderCompra: num(r?.buyingpower?.amount),
        patrimonio: num(r?.netliquidation?.amount), nivelOpciones: null, entorno: 'paper' };
    },
    async enviarOrden(orden) {
      const id = await idCuenta();
      construirCuerpoOrden(orden, id, (orden?.componentes || []).map(() => '0')); // valida antes de consultar nada
      const conids = await Promise.all(orden.componentes.map(c => conidDe(c.simbolo)));
      let r = await pedir(`/iserver/account/${id}/orders`, { method: 'POST', body: construirCuerpoOrden(orden, id, conids) });
      // IBKR pregunta («¿seguro?») antes de aceptar: la persona ya revisó y confirmó la orden en la pantalla.
      for (let i = 0; i < MAX_AVISOS && Array.isArray(r) && r[0]?.id && r[0]?.message && !r[0]?.order_id; i += 1) r = await pedir(`/iserver/reply/${encodeURIComponent(r[0].id)}`, { method: 'POST', body: { confirmed: true } });
      const o = Array.isArray(r) ? r[0] : r;
      if (o?.error) throw validacion('Interactive Brokers rechazó la orden: ' + String(o.error).slice(0, 300));
      if (!o?.order_id) throw fallo('PROVEEDOR', 'Interactive Brokers no devolvió el número de orden.', 502);
      return { ordenExternaId: String(o.order_id), clientOrderId: orden.clientOrderId, estado: mapearEstadoOrden(o.order_status), estadoProveedor: o.order_status || 'Submitted', claseOrden: conids.length > 1 ? 'mleg' : 'simple', cantidad: orden.cantidad, cantidadEjecutada: 0, componentes: [] };
    },
    consultarOrden,
    async consultarPorClientOrderId(clave) {
      const o = (await vivas()).find(x => x.order_ref === clave || x.cOID === clave);
      if (!o) throw fallo('NO_ENCONTRADO', 'Orden no encontrada en Interactive Brokers.', 404);
      return normalizarOrden(o);
    },
    async cancelarOrden(id) {
      const oid = exigirId(id), cuentaId = await idCuenta();
      await pedir(`/iserver/account/${cuentaId}/order/${oid}`, { method: 'DELETE' });
      let o = await consultarOrden(oid);
      for (let i = 0; i < 4 && !['cancelada', 'ejecutada', 'rechazada', 'expirada'].includes(o.estado); i += 1) { await dormir(700); o = await consultarOrden(oid); }
      return o;
    },
    async ordenesAbiertas() {
      const abiertas = (await vivas()).filter(o => ['enviada', 'aceptada', 'parcial'].includes(normalizarOrden(o).estado));
      return Promise.all(abiertas.map(async o => ({ ...normalizarOrden(o), componentes: await componentesDe(o) })));
    },
    async posiciones() {
      const id = await idCuenta(), out = [];
      await pedir('/portfolio/accounts');
      for (let p = 0; p < MAX_PAGINAS; p += 1) {
        const r = await pedir(`/portfolio/${id}/positions/${p}`);
        if (!Array.isArray(r)) throw fallo('PROVEEDOR', 'Interactive Brokers devolvió posiciones en un formato no reconocido.');
        out.push(...r.filter(x => num(x.position)).map(normalizarPosicion));
        if (r.length < 100) break;
      }
      return out;
    },
  };
};
