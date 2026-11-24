// Adaptador Webull: firma, símbolos OCC, estados, cuerpos de orden y flujo con fetch simulado (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, occAPataWebull, pataWebullAOcc, idClienteWebull, detectarEstrategia, construirCuerpoOrden, mapearEstadoOrden, normalizarOrden, normalizarPosiciones, createWebullClient } = require('../dist/integrations/webull.client');
const { createIntegrations } = require('../dist/integrations');

test('firma: vector oficial de la documentación', () => {
  const sig = firmar({
    ruta: '/trade/place_order', query: { a1: 'webull', a2: '123', a3: 'xxx', q1: 'yyy' },
    encabezados: { 'x-app-key': '776da210ab4a452795d74e726ebd74b6', 'x-timestamp': '2022-01-04T03:55:31Z', 'x-signature-version': '1.0', 'x-signature-algorithm': 'HMAC-SHA1', 'x-signature-nonce': '48ef5afed43d4d91ae514aaeafbc29ba', host: 'api.webull.com' },
    cuerpo: '{"k1":123,"k2":"this is the api request body","k3":true,"k4":{"foo":[1,2]}}', appSecret: '0f50a2e853334a9aae1a783bee120c1f',
  });
  assert.equal(sig, 'kvlS6opdZDhEBo5jq40nHYXaLvM=');
});

test('OCC ↔ pata de Webull', () => {
  const p = occAPataWebull('AAPL261120C00220500');
  assert.deepEqual(p, { symbol: 'AAPL', option_expire_date: '2026-11-20', option_type: 'CALL', strike_price: '220.50' });
  assert.equal(pataWebullAOcc('AAPL', { option_expire_date: '2026-11-20', option_type: 'CALL', option_exercise_price: '220.5' }), 'AAPL261120C00220500');
  assert.equal(pataWebullAOcc('AAPL', {}), null);
  assert.equal(pataWebullAOcc('BRK.B', { option_expire_date: '2026-11-20', option_type: 'PUT', option_exercise_price: '400' }), 'BRKB261120P00400000'); // la raíz OCC no lleva punto
  assert.equal(occAPataWebull('BRKB261120P00400000').symbol, 'BRKB');
  assert.throws(() => occAPataWebull('AAPL'), e => e.codigo === 'VALIDACION');
});

test('estados de orden y client_order_id', () => {
  const m = { PENDING: 'enviada', SUBMITTED: 'aceptada', PARTIAL_FILLED: 'parcial', FILLED: 'ejecutada', CANCELLED: 'cancelada', FAILED: 'rechazada', REJECTED: 'rechazada', EXPIRED: 'expirada' };
  for (const [k, v] of Object.entries(m)) assert.equal(mapearEstadoOrden(k), v);
  assert.equal(idClienteWebull('abc1234567'), 'abc1234567'); assert.equal(idClienteWebull('abc123').length, 32); // Webull exige al menos 10 caracteres
  const h = idClienteWebull('key-' + 'x'.repeat(40));
  assert.equal(h.length, 32); assert.equal(h, idClienteWebull('key-' + 'x'.repeat(40)));
});

const L = (t, k, v = '261120') => `AAPL${v}${t}${String(k * 1000).padStart(8, '0')}`;
test('cuerpo de orden: una pata y estrategias multi-pata', () => {
  const una = construirCuerpoOrden({ clientOrderId: 'k1', tipo: 'limit', precioLimite: 2.5, cantidad: 2, componentes: [{ simbolo: L('C', 200), accion: 'buy', intencion: 'buy_to_open' }] }, 'ACC');
  const o = una.new_orders[0];
  assert.equal(una.account_id, 'ACC'); assert.equal(o.option_strategy, 'SINGLE'); assert.equal(o.side, 'BUY'); assert.equal(o.quantity, '2');
  assert.equal(o.limit_price, '2.5'); assert.equal(o.position_intent, 'BUY_TO_OPEN');
  assert.equal(o.legs[0].strike_price, '200.00'); assert.equal(o.time_in_force, 'DAY'); assert.equal(o.combo_type, 'NORMAL');
  const ic = [['P', 90, 'buy'], ['P', 95, 'sell'], ['C', 110, 'sell'], ['C', 115, 'buy']].map(([t, k, a]) => ({ simbolo: L(t, k), accion: a }));
  const c = construirCuerpoOrden({ clientOrderId: 'k2', tipo: 'limit', precioLimite: 1.2, cantidad: 1, credito: true, vigencia: 'gtc', componentes: ic }).new_orders[0];
  assert.equal(c.option_strategy, 'IRON_CONDOR'); assert.equal(c.side, 'SELL'); assert.equal(c.legs.length, 4); assert.equal(c.time_in_force, 'GTC'); assert.equal(c.position_intent, undefined);
  assert.equal(detectarEstrategia([L('C', 100), L('C', 105)].map(occAPataWebull)), 'VERTICAL');
  assert.equal(detectarEstrategia([L('C', 100), L('P', 100)].map(occAPataWebull)), 'STRADDLE');
  assert.equal(detectarEstrategia([L('C', 100), L('C', 100, '261127')].map(occAPataWebull)), 'CALENDAR');
  assert.throws(() => detectarEstrategia([L('C', 100), L('C', 105), L('P', 90)].map(occAPataWebull)), e => e.codigo === 'VALIDACION');
  const bad = x => assert.throws(() => construirCuerpoOrden({ clientOrderId: 'k', tipo: 'limit', precioLimite: 1, cantidad: 1, componentes: [{ simbolo: L('C', 1), accion: 'buy' }], ...x }), e => e.codigo === 'VALIDACION');
  bad({ precioLimite: -1 }); bad({ credito: true }); bad({ cantidad: 0 }); bad({ tipo: 'market' });
});

test('sin credenciales: configurado false y errores claros sin red', async () => {
  let llamadas = 0;
  const fetch = async () => { llamadas++; throw new Error('red'); };
  const w = createWebullClient({ fetch });
  assert.equal(w.configurado, false);
  for (const m of ['cuenta', 'posiciones']) await assert.rejects(w[m](), e => e.codigo === 'SIN_CREDENCIALES' && e.proveedor === 'webull');
  await assert.rejects(w.enviarOrden({}), e => e.codigo === 'SIN_CREDENCIALES');
  await assert.rejects(w.velas('AAPL'), e => e.codigo === 'NO_IMPLEMENTADO');
  assert.equal(llamadas, 0);
  const live = createWebullClient({ appKey: 'kkkkkkkk', appSecret: 'ssssssss', entorno: 'live', fetch });
  assert.equal(live.configurado, false);
  await assert.rejects(live.cuenta(), e => e.codigo === 'NO_PERMITIDO');
  const prod = createWebullClient({ appKey: 'kkkkkkkk', appSecret: 'ssssssss', baseUrl: 'https://api.webull.com', fetch });
  await assert.rejects(prod.cuenta(), e => e.codigo === 'NO_PERMITIDO');
  assert.equal(llamadas, 0);
  assert.equal(createIntegrations({}, fetch).estado().webull.configurado, false);
  assert.equal(createIntegrations({ WEBULL_APP_KEY: 'kkkkkkkk', WEBULL_APP_SECRET: 'ssssssss' }, fetch).estado().webull.configurado, true);
});

test('flujo con fetch simulado: cuenta, orden, consulta, cancelación y posiciones', async () => {
  const reg = [];
  const resp = (json, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(json) });
  const fetch = async (url, init) => {
    const u = new URL(url);
    reg.push({ ruta: u.pathname, metodo: init.method, q: u.search, h: init.headers, b: init.body });
    switch (u.pathname) {
      case '/trading/accounts/list': return resp([{ account_id: 'ACC1', account_number: 'N1' }]);
      case '/trading/assets/balances/get': return resp({ total_asset_currency: 'USD', total_cash_balance: '1000', total_net_liquidation_value: '1500', account_currency_assets: [{ currency: 'USD', buying_power: '2000', option_buying_power: '1800' }] });
      case '/trading/orders/place': return resp({ client_order_id: JSON.parse(init.body).new_orders[0].client_order_id, order_id: 'O1' });
      case '/trading/orders/get': return resp({ combo_type: 'NORMAL', orders: [{ client_order_id: 'k1', order_id: 'O1', status: 'FILLED', total_quantity: '1', filled_quantity: '1', filled_price: '2.4', option_strategy: 'SINGLE' }] });
      case '/trading/orders/cancel': return resp({ client_order_id: 'k1' });
      case '/trading/assets/positions/list': return resp([
        { position_id: 'P1', symbol: 'AAPL', instrument_type: 'OPTION', quantity: '2', last_price: '3', cost_price: '2', unrealized_profit_loss: '200', legs: [{ leg_id: 'L1', symbol: 'AAPL', quantity: '2', option_type: 'CALL', option_expire_date: '2026-11-20', option_exercise_price: '200', option_contract_multiplier: '100' }] },
        { position_id: 'P2', symbol: 'MSFT', instrument_type: 'EQUITY', quantity: '10', last_price: '400', cost_price: '390', unrealized_profit_loss: '100' }]);
      default: return resp({}, 404);
    }
  };
  const w = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', fetch, ahora: () => new Date('2026-11-19T10:00:00.123Z'), nonce: () => 'nonce1' });
  assert.equal(w.configurado, true);
  const c = await w.cuenta();
  assert.equal(c.cuentaExternaId, 'ACC1'); assert.equal(c.efectivo, 1000); assert.equal(c.poderCompra, 1800); assert.equal(c.patrimonio, 1500); assert.equal(c.entorno, 'paper');
  const h = reg[0].h;
  assert.equal(h['x-app-key'], 'APPKEY123'); assert.equal(h['x-timestamp'], '2026-11-19T10:00:00Z'); assert.equal(h['x-signature-algorithm'], 'HMAC-SHA1'); assert.ok(h['x-signature']); assert.equal(h['x-version'], 'v3');
  assert.ok(!JSON.stringify(reg).includes('SECRET456'));
  const esperada = firmar({ ruta: '/trading/accounts/list', encabezados: { 'x-app-key': 'APPKEY123', 'x-timestamp': '2026-11-19T10:00:00Z', 'x-signature-version': '1.0', 'x-signature-algorithm': 'HMAC-SHA1', 'x-signature-nonce': 'nonce1', host: 'api.sandbox.webull.com' }, appSecret: 'SECRET456' });
  assert.equal(h['x-signature'], esperada);
  const o = await w.enviarOrden({ clientOrderId: 'key-largo-1234', tipo: 'limit', precioLimite: 2.4, cantidad: 1, componentes: [{ simbolo: L('C', 200), accion: 'buy', intencion: 'buy_to_open' }] });
  assert.equal(o.estado, 'enviada'); assert.equal(o.ordenExternaId.length, 32);
  const post = reg.find(r => r.ruta === '/trading/orders/place');
  assert.equal(post.metodo, 'POST'); assert.equal(JSON.parse(post.b).account_id, 'ACC1');
  const q = await w.consultarOrden('k1');
  assert.equal(q.estado, 'ejecutada'); assert.equal(q.precioPromedioEjecucion, 2.4); assert.equal(q.cantidadEjecutada, 1);
  const x = await w.cancelarOrden('k1');
  assert.equal(x.ordenExternaId, 'k1');
  assert.equal(JSON.parse(reg.find(r => r.ruta === '/trading/orders/cancel').b).client_order_id, 'k1');
  const p = await w.posiciones();
  assert.equal(p.length, 2); assert.equal(p[0].simbolo, L('C', 200)); assert.equal(p[0].cantidad, 2); assert.equal(p[0].lado, 'long'); assert.equal(p[0].valorMercado, 600); assert.equal(p[1].simbolo, 'MSFT');
  await assert.rejects(w.consultarOrden('../x'), e => e.codigo === 'VALIDACION');
});

test('WEBULL_ACCOUNT_ID acepta account_id o número de cuenta; uno desconocido no llega a operar', async () => {
  const rutas = [];
  const fetch = async u => { const url = new URL(u); rutas.push(url.pathname + ':' + (url.searchParams.get('account_id') || ''));
    return new Response(JSON.stringify(url.pathname === '/trading/accounts/list' ? [{ account_id: 'OTRA', account_number: 'N0' }, { account_id: 'IDLARGO', account_number: 'N1' }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const nuevo = accountId => createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', accountId, fetch });
  for (const valor of ['IDLARGO', 'N1']) { await nuevo(valor).posiciones(); assert.equal(rutas.at(-1), '/trading/assets/positions/list:IDLARGO'); }
  const antes = rutas.length;
  await assert.rejects(nuevo('N9').posiciones(), e => e.codigo === 'VALIDACION');
  assert.deepEqual(rutas.slice(antes), ['/trading/accounts/list:']);
  await assert.rejects(nuevo('').posiciones(), e => e.codigo === 'VALIDACION');
});

test('errores del proveedor se normalizan sin filtrar secretos', async () => {
  const fetch = async () => ({ ok: false, status: 417, headers: { get: () => null }, text: async () => JSON.stringify({ error_code: 'X', message: 'bad SECRET456' }) });
  const w = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', accountId: 'A', fetch });
  await assert.rejects(w.posiciones(), e => e.proveedor === 'webull' && e.codigo === 'PROVEEDOR' && !e.mensaje.includes('SECRET456'));
});

test('normalizarOrden no devuelve otra orden de la lista', () => {
  const cuerpo = { orders: [{ client_order_id: 'otra', status: 'FILLED' }, { client_order_id: 'mia', status: 'EXPIRED' }] };
  assert.equal(normalizarOrden(cuerpo, 'mia').estado, 'expirada');
  assert.throws(() => normalizarOrden(cuerpo, 'nada'), e => e.codigo === 'NO_ENCONTRADO');
});

const pataPos = (id, t, k, quantity, extra = {}) => ({ leg_id: id, symbol: 'AAPL', quantity, option_type: t, option_expire_date: '2026-11-20', option_exercise_price: String(k), ...extra });
// Respuesta real de Webull paper (2026-11-24) para un Iron Condor vendido: las patas no traen side ni quantity.
const condorReal = () => ({ currency: 'USD', quantity: '-1', cost: '-41.00', position_id: 'PX', symbol: 'AAPL', option_strategy: 'IRON_CONDOR', instrument_type: 'OPTION', cost_price: '0.41', last_price: '0.82', unrealized_profit_loss: '-40.50',
  legs: [['1.45', '1.40', '-5.00', 'PUT', '340'], ['1.67', '1.79', '-12.00', 'PUT', '342.5'], ['0.81', '0.93', '-12.00', 'CALL', '365'], ['0.62', '0.505', '-11.50', 'CALL', '367.5']].map(([cost, last, pl, t, k]) => ({
    symbol: 'AAPL', cost, leg_id: 'PX', instrument_type: 'OPTION', last_price: last, unrealized_profit_loss: pl, option_type: t, option_expire_date: '2026-12-02', option_exercise_price: k, option_contract_multiplier: '100' })) });

test('posiciones: los lados de un Iron Condor real se deducen con evidencia y, si falta, no se suponen', () => {
  const r = normalizarPosiciones(condorReal());
  assert.deepEqual(r.map(x => [x.simbolo, x.lado, x.cantidad, x.cerrable]), [['AAPL261202P00340000', 'long', 1, true], ['AAPL261202P00342500', 'short', 1, true], ['AAPL261202C00365000', 'short', 1, true], ['AAPL261202C00367500', 'long', 1, true]]);
  assert.deepEqual(r.map(x => x.precioPromedio), [1.45, 1.67, 0.81, 0.62]); assert.deepEqual(r.map(x => Math.sign(x.valorMercado)), [1, -1, -1, 1]); assert.equal(new Set(r.map(x => x.posicionExternaId)).size, 4); assert.ok(r.every(x => x.grupoId === 'PX'));
  // Condor comprado (todo al revés).
  const inv = condorReal(); inv.quantity = '1'; inv.cost = '41.00'; inv.legs.forEach(l => { l.unrealized_profit_loss = String(-Number(l.unrealized_profit_loss)); });
  assert.deepEqual(normalizarPosiciones(inv).map(x => x.lado), ['short', 'long', 'long', 'short']);
  // Recién abierta (sin P/L): basta la suma de costos si solo una combinación cuadra.
  const nueva = condorReal(); nueva.legs.forEach(l => { l.last_price = l.cost; l.unrealized_profit_loss = '0'; });
  assert.deepEqual(normalizarPosiciones(nueva).map(x => x.lado), ['long', 'short', 'short', 'long']);
  const malo = cambio => { const c = condorReal(); cambio(c); return normalizarPosiciones(c).every(x => x.cerrable === false); };
  assert.ok(malo(c => { c.cost = '-60.00'; }), 'los costos no cuadran');
  assert.ok(malo(c => { c.legs[0].unrealized_profit_loss = '-10.00'; }), 'el resultado indica otra cantidad por pata');
  assert.ok(malo(c => { c.legs[0].unrealized_profit_loss = '5.00'; }), 'resultado y costos se contradicen');
  assert.ok(malo(c => { c.legs.forEach(l => { l.cost = '1.00'; l.last_price = '1.00'; l.unrealized_profit_loss = '0'; }); c.cost = '0'; }), 'varias combinaciones posibles');
  assert.ok(malo(c => { delete c.legs[1].cost; }), 'falta un costo');
});

test('Webull: estructuras a mercado se rechazan con mensaje claro y la cancelación espera la confirmación', async () => {
  const ic = [['P', 90, 'buy'], ['P', 95, 'sell'], ['C', 110, 'sell'], ['C', 115, 'buy']].map(([t, k, a]) => ({ simbolo: L(t, k), accion: a }));
  assert.throws(() => construirCuerpoOrden({ clientOrderId: 'abcdefghij1', tipo: 'market', cantidad: 1, componentes: ic }), e => e.codigo === 'VALIDACION' && /límite/.test(e.mensaje));
  let n = 0;
  const fetch = async u => { const ruta = new URL(u).pathname; const cuerpo = ruta.endsWith('accounts/list') ? [{ account_id: 'A', account_number: 'N' }] : ruta.endsWith('orders/get') ? { orders: [{ client_order_id: 'abcdefghij1', status: ++n < 3 ? 'SUBMITTED' : 'CANCELLED' }] } : {};
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const w = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', accountId: 'A', fetch, esperar: async () => {} });
  assert.equal((await w.cancelarOrden('abcdefghij1')).estado, 'cancelada'); assert.equal(n, 3);
});

test('posiciones multi-pata: lado por pata, id único, sin repartir costo ni resultado del conjunto', () => {
  const padre = { position_id: 'P9', symbol: 'AAPL', instrument_type: 'OPTION', quantity: '1', last_price: '1.2', cost_price: '1', unrealized_profit_loss: '20' };
  const conSide = normalizarPosiciones({ ...padre, legs: [pataPos('L1', 'PUT', 90, '1', { side: 'BUY' }), pataPos(null, 'PUT', 95, '1', { side: 'SELL' })] });
  assert.deepEqual(conSide.map(p => [p.posicionExternaId, p.lado, p.cantidad, p.cerrable, p.grupoId]), [['P9:AAPL261120P00090000', 'long', 1, true, 'P9'], ['P9:' + L('P', 95), 'short', 1, true, 'P9']]);
  for (const p of conSide) assert.deepEqual([p.precioPromedio, p.precioActual, p.valorMercado, p.plNoRealizado], [null, null, null, null]);
  const conSigno = normalizarPosiciones({ ...padre, quantity: '-2', legs: [pataPos('L1', 'CALL', 100, '-2'), pataPos('L2', 'CALL', 105, '2')] });
  assert.deepEqual(conSigno.map(p => [p.lado, p.cantidad, p.cerrable]), [['short', 2, true], ['long', 2, true]]);
  const sinLado = normalizarPosiciones({ ...padre, legs: [pataPos('L1', 'CALL', 100, '1'), pataPos('L2', 'CALL', 105, '1', { side: 'SELL' })] });
  assert.deepEqual(sinLado.map(p => [p.lado, p.cerrable]), [[null, false], ['short', true]]);
  const contradice = normalizarPosiciones({ ...padre, legs: [pataPos('L1', 'CALL', 100, '-1', { side: 'BUY' }), pataPos('L2', 'CALL', 105, '1', { side: 'BUY' })] });
  assert.deepEqual(contradice.map(p => p.cerrable), [false, true]);
  const proporcion = normalizarPosiciones({ ...padre, quantity: '5', legs: [pataPos('L1', 'CALL', 100, '1', { side: 'BUY' }), pataPos('L2', 'CALL', 105, '1', { side: 'SELL' })] });
  assert.ok(proporcion.every(p => !p.cerrable)); // ¿1 contrato o proporción 1 de 5 estructuras?
  const [una] = normalizarPosiciones({ ...padre, quantity: '3', legs: [pataPos('L1', 'CALL', 100, '3', { side: 'SELL' })] });
  assert.deepEqual([una.posicionExternaId, una.lado, una.cantidad, una.plNoRealizado, una.grupoId, una.cerrable], ['P9:AAPL261120C00100000', 'short', 3, 20, null, true]);
});

test('reintentos: firma y nonce nuevos en cada intento; un POST con 5xx no se repite', async () => {
  const vistos = []; let n = 0;
  const fetch = async (url, init) => { vistos.push([init.method, init.headers['x-signature-nonce'], init.headers['x-signature']]);
    return vistos.length <= 2 ? new Response('{}', { status: vistos.length === 1 ? 429 : 503 }) : new Response('[]', { status: 200 }); };
  const esperas = [];
  const w = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', fetch, nonce: () => 'n' + (++n), esperar: async ms => { esperas.push(ms); } });
  await assert.rejects(w.posiciones(), e => e.codigo === 'VALIDACION'); // sin cuentas: ya pasó los reintentos
  assert.deepEqual(vistos.map(v => v[1]), ['n1', 'n2', 'n3']); assert.equal(new Set(vistos.map(v => v[2])).size, 3); assert.deepEqual(esperas, [500, 1000]);
  let posts = 0;
  const f2 = async (url, init) => { if (init.method === 'POST') { posts++; return new Response('{}', { status: 503 }); } return new Response(JSON.stringify([{ account_id: 'A' }]), { status: 200 }); };
  const w2 = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', fetch: f2, esperar: async () => {} });
  await assert.rejects(w2.enviarOrden({ clientOrderId: 'clave-1234567', tipo: 'market', cantidad: 1, componentes: [{ simbolo: L('C', 200), accion: 'buy' }] }), e => e.status === 503);
  assert.equal(posts, 1);
});

test('hosts: solo los de pruebas exactos', async () => {
  for (const baseUrl of ['https://sandbox.evil.com', 'https://api.webull.com/?x=sandbox', 'https://test-api.webull.com', 'https://api.sandbox.webull.com.evil.com', 'https://api.sandbox.webull.com:8443', 'https://u:p@api.sandbox.webull.com', 'http://api.sandbox.webull.com'])
    await assert.rejects(createWebullClient({ appKey: 'kkkkkkkk', appSecret: 'ssssssss', baseUrl, fetch: async () => { throw new Error('red'); } }).cuenta(), e => e.codigo === 'NO_PERMITIDO', baseUrl);
  assert.equal(createWebullClient({ appKey: 'kkkkkkkk', appSecret: 'ssssssss', baseUrl: 'https://api.sandbox.webull.com/' }).configurado, true);
});

test('búsqueda por Idempotency-Key y formato de posiciones no reconocido', async () => {
  const consultas = []; let ordenes = { orders: [] }, status = 200, posiciones = [];
  const fetch = async u => { const url = new URL(u);
    if (url.pathname === '/trading/accounts/list') return new Response(JSON.stringify([{ account_id: 'A' }]));
    if (url.pathname === '/trading/orders/get') { consultas.push(url.searchParams.get('client_order_id')); return new Response(JSON.stringify(ordenes), { status }); }
    return new Response(JSON.stringify(posiciones)); };
  const w = createWebullClient({ appKey: 'APPKEY123', appSecret: 'SECRET456', fetch, esperar: async () => {} });
  await assert.rejects(w.consultarPorClientOrderId('key-123456789'), e => e.codigo === 'NO_ENCONTRADO');
  const id = idClienteWebull('key-123456789'); assert.equal(consultas[0], id);
  ordenes = { orders: [{ client_order_id: id, status: 'SUBMITTED' }] };
  assert.equal((await w.consultarPorClientOrderId('key-123456789')).estado, 'aceptada');
  status = 417; ordenes = { message: 'Order does not exist' };
  await assert.rejects(w.consultarPorClientOrderId('key-123456789'), e => e.codigo === 'NO_ENCONTRADO');
  ordenes = { message: 'internal' };
  await assert.rejects(w.consultarPorClientOrderId('key-123456789'), e => e.codigo === 'PROVEEDOR');
  for (const raro of [{}, { data: [] }, null]) { posiciones = raro; await assert.rejects(w.posiciones(), e => e.codigo === 'PROVEEDOR'); }
  posiciones = { positions: [] }; assert.deepEqual(await w.posiciones(), []);
});

test('órdenes abiertas: patas a OCC aunque no repitan el subyacente; formato irreconocible no es "ninguna"', async () => {
  let cuerpo = { data: [{ client_order_id: 'cid1234567', orders: [{ client_order_id: 'cid1234567', symbol: 'MDB', side: 'BUY', status: 'SUBMITTED', option_strategy: 'VERTICAL',
    legs: [{ side: 'BUY', quantity: '1', option_type: 'CALL', option_expire_date: '2026-12-11', strike_price: '300' }, { side: 'SELL', quantity: '1', option_type: 'CALL', option_expire_date: '2026-12-11', strike_price: '310' }] }] },
  { client_order_id: 'cid7654321', orders: [{ client_order_id: 'cid7654321', symbol: 'MDB', side: 'SELL', status: 'SUBMITTED', option_strategy: 'SINGLE', position_intent: 'SELL_TO_CLOSE',
    legs: [{ side: 'SELL', quantity: '1', option_type: 'PUT', option_expire_date: '2026-12-11', strike_price: '250.5' }] }] }] };
  const w = createWebullClient({ appKey: 'K', appSecret: 'S', accountId: 'ID', fetch: async u => new Response(JSON.stringify(String(u).includes('/accounts/list') ? [{ account_id: 'ID' }] : cuerpo), { status: 200, headers: { 'content-type': 'application/json' } }) });
  const [a, b] = await w.ordenesAbiertas();
  assert.deepEqual(a.componentes, [{ simbolo: 'MDB261211C00300000', accion: 'buy', intencion: null }, { simbolo: 'MDB261211C00310000', accion: 'sell', intencion: null }]);
  assert.equal(a.estado, 'aceptada'); assert.deepEqual(b.componentes, [{ simbolo: 'MDB261211P00250500', accion: 'sell', intencion: 'sell_to_close' }]);
  cuerpo = { data: [] }; assert.deepEqual(await w.ordenesAbiertas(), []);
  cuerpo = {}; await assert.rejects(w.ordenesAbiertas(), e => e.codigo === 'PROVEEDOR');
});
