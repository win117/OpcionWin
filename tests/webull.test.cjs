// Adaptador Webull: firma, símbolos OCC, estados, cuerpos de orden y flujo con fetch simulado (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const { firmar, occAPataWebull, pataWebullAOcc, idClienteWebull, detectarEstrategia, construirCuerpoOrden, mapearEstadoOrden, createWebullClient } = require('../dist/integrations/webull.client');
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
  assert.throws(() => occAPataWebull('AAPL'), e => e.codigo === 'VALIDACION');
});

test('estados de orden y client_order_id', () => {
  const m = { PENDING: 'enviada', SUBMITTED: 'aceptada', PARTIAL_FILLED: 'parcial', FILLED: 'ejecutada', CANCELLED: 'cancelada', FAILED: 'rechazada' };
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
