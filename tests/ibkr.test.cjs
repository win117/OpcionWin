// Interactive Brokers: contrato, solo cuentas simuladas, órdenes de una y varias patas, avisos, posiciones y mensajes claros.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIbkrClient, construirCuerpoOrden, leerOcc, aOcc, mapearEstadoOrden, fetchLocal } = require('../dist/integrations/ibkr.client');
const { exigirContratoBroker } = require('../dist/integrations/contrato-broker');

const occ = (d, k) => 'KO270115' + d + String(k * 1000).padStart(8, '0');
function gateway(extra = {}) {
  const llamadas = [];
  const rutas = { 'GET /iserver/accounts': () => ({ accounts: ['DU123'], selectedAccount: 'DU123', isPaper: true }), 'GET /portfolio/accounts': () => [{ accountId: 'DU123' }],
    'GET /portfolio/DU123/summary': () => ({ netliquidation: { amount: 1000000, currency: 'USD' }, totalcashvalue: { amount: 990000 }, buyingpower: { amount: 4000000 } }),
    'GET /iserver/secdef/search': () => [{ conid: '8894', symbol: 'KO', sections: [{ secType: 'OPT', months: 'DEC26;JAN27' }] }],
    'GET /iserver/secdef/info': u => ['20270115', '20270122'].map(maturityDate => ({ conid: Number(u.searchParams.get('strike')) * 10 + (u.searchParams.get('right') === 'C' ? 1 : 2), maturityDate, strike: Number(u.searchParams.get('strike')), right: u.searchParams.get('right') })),
    'POST /iserver/account/DU123/orders': () => [{ id: 'aviso1', message: ['¿Seguro?'] }], 'POST /iserver/reply/aviso1': () => [{ order_id: '77', order_status: 'Submitted' }],
    'GET /iserver/account/order/status/77': () => ({ order_id: 77, order_status: 'Filled', cum_fill: 1, average_price: '-2.36', total_size: 1 }), ...extra };
  const fetch = async (url, o) => {
    const u = new URL(url), k = `${o.method} ${u.pathname.replace('/v1/api', '')}`; llamadas.push({ k, body: o.body && JSON.parse(o.body), u });
    const r = rutas[k]; if (!r) return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' };
    const d = r(u); return d?.status >= 400 ? { ok: false, status: d.status, headers: new Headers(), text: async () => '{}' } : { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(d) };
  };
  return { llamadas, c: createIbkrClient({ gatewayUrl: 'https://localhost:5000', fetch, esperar: async () => {} }) };
}

test('IBKR: cumple el contrato, solo paper y sin gateway lo dice', async () => {
  exigirContratoBroker(createIbkrClient({}));
  assert.equal(createIbkrClient({}).configurado, false); await assert.rejects(createIbkrClient({}).cuenta(), e => e.codigo === 'SIN_CREDENCIALES');
  for (const u of ['http://ejemplo.com', 'ftp://localhost', 'https://u:p@localhost:5000', 'nada']) assert.equal(createIbkrClient({ gatewayUrl: u }).configurado, false, u);
  assert.equal((await gateway().c.cuenta()).patrimonio, 1000000);
  for (const real of [{ accounts: ['U123'], selectedAccount: 'U123' }, { accounts: ['DU1'], selectedAccount: 'DU1', isPaper: false }]) {
    const g = gateway({ 'GET /iserver/accounts': () => real });
    for (const f of [() => g.c.cuenta(), () => g.c.posiciones(), () => g.c.cancelarOrden('77'), () => g.c.enviarOrden({})]) await assert.rejects(f(), e => e.codigo === 'NO_PERMITIDO');
    assert.ok(g.llamadas.every(l => l.k === 'GET /iserver/accounts'), 'no toca la cuenta real');
  }
  await assert.rejects(gateway({ 'GET /iserver/accounts': () => ({ status: 401 }) }).c.cuenta(), /Inicia sesión/);
  await assert.rejects(createIbkrClient({ gatewayUrl: 'https://localhost:5000', fetch: async () => { throw new TypeError('x'); }, esperar: async () => {} }).cuenta(), /No responde/);
  await assert.rejects(fetchLocal('https://ejemplo.com'), /locales/);
});

test('IBKR: orden simple y cóndor a crédito; los avisos se confirman y la clave viaja como cOID', async () => {
  const { c, llamadas } = gateway();
  const r = await c.enviarOrden({ clientOrderId: 'clave-1', tipo: 'limit', precioLimite: 1.98, cantidad: 2, componentes: [{ simbolo: occ('C', 100), accion: 'buy' }] });
  assert.deepEqual([r.ordenExternaId, r.estado, r.claseOrden], ['77', 'aceptada', 'simple']);
  const env = () => llamadas.filter(l => l.k === 'POST /iserver/account/DU123/orders').at(-1).body.orders[0];
  assert.deepEqual(env(), { acctId: 'DU123', cOID: 'clave-1', orderType: 'LMT', tif: 'DAY', price: 1.98, conid: 1001, side: 'BUY', quantity: 2 });
  await c.enviarOrden({ clientOrderId: 'clave-2', tipo: 'limit', precioLimite: 2.36, cantidad: 1, credito: true, vigencia: 'gtc', componentes: [[occ('P', 90), 'sell'], [occ('P', 85), 'buy'], [occ('C', 105), 'sell'], [occ('C', 110), 'buy']].map(([simbolo, accion]) => ({ simbolo, accion })) });
  assert.deepEqual(env(), { acctId: 'DU123', cOID: 'clave-2', orderType: 'LMT', tif: 'GTC', price: -2.36, conidex: '28812380;;;902/-1,852/1,1051/-1,1101/1', side: 'BUY', quantity: 1 });
  assert.equal((await c.consultarOrden('77')).precioPromedioEjecucion, 2.36);
  await assert.rejects(c.enviarOrden({ clientOrderId: 'k', tipo: 'market', precioLimite: 1, cantidad: 1, componentes: [{ simbolo: occ('C', 100), accion: 'buy' }] }), e => e.codigo === 'VALIDACION');
  await assert.rejects(gateway({ 'POST /iserver/account/DU123/orders': () => ({ error: 'sin permisos' }) }).c.enviarOrden({ clientOrderId: 'k', tipo: 'market', cantidad: 1, componentes: [{ simbolo: occ('C', 100), accion: 'buy' }] }), /sin permisos/);
  await assert.rejects(c.enviarOrden({ clientOrderId: 'k', tipo: 'market', cantidad: 1, componentes: [{ simbolo: 'KO270219C00100000', accion: 'buy' }] }), /ese mes/);
  assert.throws(() => construirCuerpoOrden({ clientOrderId: 'k', tipo: 'market', cantidad: 1, componentes: [{ simbolo: occ('C', 1), accion: 'buy' }, { simbolo: 'PEP270115C00001000', accion: 'buy' }] }, 'DU1', []), /subyacente/);
});

test('IBKR: órdenes vivas, por clave, posiciones y conversiones', async () => {
  const ordenes = [{ orderId: 5, order_ref: 'clave-5', status: 'Submitted', totalSize: 1, filledQuantity: 0, side: 'BUY', conidex: '28812380;;;902/-1,1051/1' }, { orderId: 6, status: 'Filled', filledQuantity: 1, avgPrice: 1.5, side: 'SELL', conid: 902 }];
  const info = { 902: ['P', 90], 1051: ['C', 105] };
  const extra = { 'GET /iserver/account/orders': () => ({ orders: ordenes, snapshot: true }) };
  for (const [id, [right, strike]] of Object.entries(info)) extra[`GET /iserver/contract/${id}/info`] = () => ({ symbol: 'KO', maturity_date: '20270115', right, strike: String(strike) });
  extra['GET /portfolio/DU123/positions/0'] = () => [{ conid: 902, assetClass: 'OPT', undSym: 'KO', expiry: '20270115', putOrCall: 'P', strike: '90', position: -2, avgPrice: 1.5, mktPrice: 1.2, mktValue: -240, unrealizedPnl: 60 }, { conid: 1, position: 0 }];
  const { c } = gateway(extra);
  const [o, ...resto] = await c.ordenesAbiertas(); assert.equal(resto.length, 0);
  assert.deepEqual([o.ordenExternaId, o.clientOrderId, o.claseOrden, o.componentes.map(x => [x.simbolo, x.accion])], ['5', 'clave-5', 'mleg', [[occ('P', 90), 'sell'], [occ('C', 105), 'buy']]]);
  assert.equal((await c.consultarPorClientOrderId('clave-5')).ordenExternaId, '5'); await assert.rejects(c.consultarPorClientOrderId('otra'), e => e.codigo === 'NO_ENCONTRADO');
  const [p, ...mas] = await c.posiciones(); assert.equal(mas.length, 0);
  assert.deepEqual([p.simbolo, p.lado, p.cantidad, p.precioPromedio, p.plNoRealizado, p.cerrable], [occ('P', 90), 'short', 2, 1.5, 60, true]);
  assert.deepEqual(leerOcc(occ('C', 97.5)), { subyacente: 'KO', mes: 'JAN27', vencimiento: '20270115', derecho: 'C', strike: 97.5 }); assert.equal(aOcc({ simbolo: 'KO', vencimiento: '20270115', derecho: 'Call', strike: '97.5' }), occ('C', 97.5));
  assert.equal(mapearEstadoOrden('Submitted', 1), 'parcial'); assert.equal(mapearEstadoOrden('Inactive'), 'rechazada'); await assert.rejects(c.consultarOrden('a/b'), e => e.codigo === 'VALIDACION');
});
