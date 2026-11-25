// Pruebas de adaptadores externos sin red: fetch falso con respuestas de forma real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlpacaClient, construirCuerpoOrden, mapearEstadoOrden } = require('../dist/integrations/alpaca.client');
const { createSecClient, parsearTabla13F, leerTablaPorTrozos, normalizarEmisor } = require('../dist/integrations/sec.client');
const { createWebullClient } = require('../dist/integrations/webull.client');
const { createIntegrations } = require('../dist/integrations');
const { IntegrationError } = require('../dist/integrations/errors');
const { claveEmisor, fraseEmisor, cortesTrimestrales, rankingDesdeTablas } = require('../dist/integrations/institucionales');
const { deflateRawSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const KEY = 'PKTESTKEYID1234567';
const SECRET = 'supersecretvalue-abcdef-987654';
const UA = 'AppRESTOpciones pruebas contacto@example.com';

// Fake fetch: `rutas` es una función (url, init) => {status, json|text, headers} o un arreglo en secuencia.
const fakeFetch = rutas => {
  const llamadas = [];
  let i = 0;
  const fn = async (url, init = {}) => {
    llamadas.push({ url: new URL(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const r = Array.isArray(rutas) ? rutas[Math.min(i++, rutas.length - 1)] : rutas(new URL(url), init);
    if (r instanceof Error) throw r;
    const cuerpo = r.text !== undefined ? r.text : r.json === undefined ? null : JSON.stringify(r.json);
    return new Response(r.status === 204 ? null : cuerpo, { status: r.status || 200, headers: r.headers || {} });
  };
  fn.llamadas = llamadas;
  return fn;
};
const sinEspera = { esperar: async () => {}, intervaloMs: 0 };
const alpaca = (fetch, extra = {}) => createAlpacaClient({ keyId: KEY, secretKey: SECRET, fetch, ...sinEspera, ...extra });
const sinSecretos = e => {
  const texto = JSON.stringify(e) + String(e.message) + String(e.stack);
  return !texto.includes(KEY) && !texto.includes(SECRET);
};

test('Alpaca: velas con encabezados, query, paginación y normalización', async () => {
  const fetch = fakeFetch([
    { json: { bars: { AAPL: [{ t: '2026-01-02T05:00:00Z', o: 1, h: 3, l: 0.5, c: 2, v: 100, n: 5, vw: 1.5 }] }, next_page_token: 'tok1' } },
    { json: { bars: { AAPL: [{ t: '2026-01-03T05:00:00Z', o: 2, h: 4, l: 1, c: 3, v: 200 }] }, next_page_token: null } },
  ]);
  const velas = await alpaca(fetch).velas('aapl', { intervalo: '1Day', desde: '2026-01-01', hasta: '2026-01-31', limite: 500 });
  assert.equal(fetch.llamadas.length, 2);
  const [primera, segunda] = fetch.llamadas;
  assert.equal(primera.url.origin + primera.url.pathname, 'https://data.alpaca.markets/v2/stocks/bars');
  assert.equal(primera.headers['APCA-API-KEY-ID'], KEY);
  assert.equal(primera.headers['APCA-API-SECRET-KEY'], SECRET);
  const q = primera.url.searchParams;
  assert.equal(q.get('symbols'), 'AAPL');
  assert.equal(q.get('timeframe'), '1Day');
  assert.equal(q.get('start'), '2026-01-01');
  assert.equal(q.get('feed'), 'iex');
  assert.equal(q.get('limit'), '500');
  assert.equal(q.get('page_token'), null);
  assert.equal(segunda.url.searchParams.get('page_token'), 'tok1');
  assert.deepEqual(velas[0], { fecha: '2026-01-02T05:00:00Z', apertura: 1, maximo: 3, minimo: 0.5, cierre: 2, volumen: 100 });
  assert.equal(velas.length, 2);
});

test('Alpaca: la paginación respeta el tope de páginas', async () => {
  const fetch = fakeFetch(() => ({ json: { news: [{ id: 1, headline: 'h', summary: '', url: 'https://x.test/a', created_at: '2026-01-01T00:00:00Z', symbols: ['AAPL'] }], next_page_token: 'siempre' } }));
  const noticias = await alpaca(fetch, { maxPaginas: 3 }).noticias({ simbolos: ['AAPL', 'MSFT'], limite: 1000 });
  assert.equal(fetch.llamadas.length, 3);
  assert.equal(fetch.llamadas[0].url.pathname, '/v1beta1/news');
  assert.equal(fetch.llamadas[0].url.searchParams.get('symbols'), 'AAPL,MSFT');
  assert.equal(fetch.llamadas[0].url.searchParams.get('limit'), '50');
  assert.deepEqual(noticias[0], { proveedor: 'alpaca', noticiaExternaId: '1', titulo: 'h', resumen: null, url: 'https://x.test/a', publicadaEn: '2026-01-01T00:00:00Z', simbolos: ['AAPL'], fuenteOriginal: null });
});

test('Alpaca: contratos y snapshots de opciones normalizados', async () => {
  const fetch = fakeFetch(url => {
    if (url.pathname === '/v2/options/contracts') return { json: { option_contracts: [{ id: 'u1', symbol: 'AAPL260116C00200000', status: 'active', underlying_symbol: 'AAPL', type: 'call', strike_price: '200', expiration_date: '2026-01-16', size: '100', multiplier: '100' }], next_page_token: null } };
    return { json: { snapshots: { AAPL260116C00200000: { latestQuote: { t: '2026-01-05T15:00:00Z', bp: 1.1, ap: 1.3 }, latestTrade: { t: '2026-01-05T14:59:00Z', p: 1.2 }, greeks: { delta: 0.45, gamma: 0.02, theta: -0.05, vega: 0.1, rho: 0.01 }, impliedVolatility: 0.31 } }, next_page_token: null } };
  });
  const cliente = alpaca(fetch);
  const contratos = await cliente.contratos({ subyacente: 'AAPL', vencimientoDesde: '2026-01-01', vencimientoHasta: new Date('2026-02-01T00:00:00Z'), tipo: 'call', strikeMin: 150, strikeMax: 250 });
  const q = fetch.llamadas[0].url.searchParams;
  assert.equal(fetch.llamadas[0].url.origin, 'https://paper-api.alpaca.markets');
  assert.equal(q.get('underlying_symbols'), 'AAPL');
  assert.equal(q.get('expiration_date_lte'), '2026-02-01');
  assert.equal(q.get('strike_price_gte'), '150');
  assert.deepEqual(contratos[0], { proveedor: 'alpaca', contratoExternoId: 'AAPL260116C00200000', simbolo: 'AAPL', tipo: 'call', strike: 200, vencimiento: '2026-01-16', multiplicador: 100, activo: true });

  const snaps = await cliente.snapshotsOpciones('AAPL', { tipo: 'call', vencimiento: '2026-01-16' });
  const s = fetch.llamadas[1];
  assert.equal(s.url.pathname, '/v1beta1/options/snapshots/AAPL');
  assert.equal(s.url.searchParams.get('feed'), 'indicative');
  assert.equal(s.url.searchParams.get('expiration_date'), '2026-01-16');
  assert.deepEqual(snaps[0], {
    contratoExternoId: 'AAPL260116C00200000', bid: 1.1, ask: 1.3, ultimo: 1.2, ultimoFecha: '2026-01-05T14:59:00Z', volatilidadImplicita: 0.31,
    griegas: { delta: 0.45, gamma: 0.02, theta: -0.05, vega: 0.1, rho: 0.01 }, fechaDato: '2026-01-05T15:00:00Z',
  });
  await cliente.snapshotsOpciones(['AAPL260116C00200000', 'AAPL260116P00200000']);
  assert.equal(fetch.llamadas[2].url.pathname, '/v1beta1/options/snapshots');
  assert.equal(fetch.llamadas[2].url.searchParams.get('symbols'), 'AAPL260116C00200000,AAPL260116P00200000');
});

test('Alpaca: cotización desde snapshot de acción', async () => {
  const fetch = fakeFetch(() => ({ json: { MSFT: { latestTrade: { t: '2026-01-05T15:00:00Z', p: 410.5 }, latestQuote: { t: '2026-01-05T15:00:01Z', bp: 410.4, ap: 410.6 }, dailyBar: { o: 405, h: 412, l: 404, c: 410, v: 1000 }, prevDailyBar: { c: 404 } } } }));
  const c = await alpaca(fetch, { feed: 'sip' }).cotizacion('MSFT');
  assert.equal(fetch.llamadas[0].url.pathname, '/v2/stocks/snapshots');
  assert.equal(fetch.llamadas[0].url.searchParams.get('feed'), 'sip');
  assert.equal(c.ultimo, 410.5); assert.equal(c.bid, 410.4); assert.equal(c.cierreAnterior, 404); assert.equal(c.feed, 'sip');
  await assert.rejects(alpaca(fakeFetch(() => ({ json: {} }))).cotizacion('ZZZZ'), e => e.codigo === 'NO_ENCONTRADO');
});

test('Alpaca: sin credenciales falla antes de cualquier solicitud', async () => {
  const fetch = fakeFetch(() => ({ json: {} }));
  const cliente = createAlpacaClient({ keyId: '', secretKey: '  ', fetch });
  assert.equal(cliente.configurado, false);
  for (const llamada of [() => cliente.velas('AAPL'), () => cliente.cuenta(), () => cliente.posiciones(), () => cliente.noticias({})]) {
    await assert.rejects(llamada(), e => e instanceof IntegrationError && e.codigo === 'SIN_CREDENCIALES');
  }
  assert.equal(fetch.llamadas.length, 0);
});

test('Alpaca: URL live rechazada; trading siempre contra paper', async () => {
  for (const url of ['https://api.alpaca.markets', 'https://api.alpaca.markets/', 'http://paper-api.alpaca.markets', 'https://evil.test']) {
    assert.throws(() => createAlpacaClient({ keyId: KEY, secretKey: SECRET, tradingUrl: url }), e => e.codigo === 'NO_PERMITIDO');
  }
  assert.doesNotThrow(() => createAlpacaClient({ keyId: KEY, secretKey: SECRET, tradingUrl: 'https://paper-api.alpaca.markets/' }));
  const fetch = fakeFetch(() => ({ json: { id: 'acc', account_number: 'PA1', status: 'ACTIVE', currency: 'USD', cash: '1000.5', buying_power: '2000', equity: '1000.5', options_trading_level: 3 } }));
  const cuenta = await alpaca(fetch).cuenta();
  assert.equal(fetch.llamadas[0].url.href, 'https://paper-api.alpaca.markets/v2/account');
  assert.deepEqual(cuenta, { cuentaExternaId: 'acc', numero: 'PA1', estado: 'ACTIVE', moneda: 'USD', efectivo: 1000.5, poderCompra: 2000, patrimonio: 1000.5, nivelOpciones: 3, entorno: 'paper' });
});

test('Alpaca: orden mleg de iron condor', async () => {
  const orden = {
    clientOrderId: 'idem-123', tipo: 'limit', vigencia: 'day', cantidad: 2, precioLimite: -1.25,
    componentes: [
      { simbolo: 'SPY260116P00550000', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 },
      { simbolo: 'SPY260116P00560000', accion: 'sell', intencion: 'sell_to_open', proporcion: 1 },
      { simbolo: 'SPY260116C00600000', accion: 'sell', intencion: 'sell_to_open', proporcion: 1 },
      { simbolo: 'SPY260116C00610000', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 },
    ],
  };
  const fetch = fakeFetch(() => ({ json: { id: 'ord-1', client_order_id: 'idem-123', status: 'accepted', order_class: 'mleg', qty: '2', filled_qty: '0', legs: [{ id: 'l1', symbol: 'SPY260116P00550000', side: 'buy', ratio_qty: '1', position_intent: 'buy_to_open', status: 'accepted' }] } }));
  const r = await alpaca(fetch).enviarOrden(orden);
  const req = fetch.llamadas[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.url.href, 'https://paper-api.alpaca.markets/v2/orders');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.deepEqual(req.body, {
    type: 'limit', time_in_force: 'day', client_order_id: 'idem-123', limit_price: '-1.25', order_class: 'mleg', qty: '2',
    legs: [
      { symbol: 'SPY260116P00550000', ratio_qty: '1', side: 'buy', position_intent: 'buy_to_open' },
      { symbol: 'SPY260116P00560000', ratio_qty: '1', side: 'sell', position_intent: 'sell_to_open' },
      { symbol: 'SPY260116C00600000', ratio_qty: '1', side: 'sell', position_intent: 'sell_to_open' },
      { symbol: 'SPY260116C00610000', ratio_qty: '1', side: 'buy', position_intent: 'buy_to_open' },
    ],
  });
  assert.equal(req.body.symbol, undefined); assert.equal(req.body.side, undefined);
  assert.equal(r.ordenExternaId, 'ord-1'); assert.equal(r.estado, 'aceptada'); assert.equal(r.estadoProveedor, 'accepted');
  assert.equal(r.componentes[0].intencion, 'buy_to_open');
});

test('Alpaca: orden de una pata y validaciones', () => {
  const cuerpo = construirCuerpoOrden({ clientOrderId: 'k1', tipo: 'market', vigencia: 'gtc', cantidad: 3, componentes: [{ simbolo: 'AAPL260116C00200000', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 }] });
  assert.deepEqual(cuerpo, { type: 'market', time_in_force: 'gtc', client_order_id: 'k1', symbol: 'AAPL260116C00200000', qty: '3', side: 'buy', position_intent: 'buy_to_open' });
  const base = { clientOrderId: 'k', tipo: 'limit', cantidad: 1, precioLimite: 1, componentes: [{ simbolo: 'X', accion: 'buy' }] };
  for (const malo of [
    { ...base, clientOrderId: '' }, { ...base, tipo: 'stop' }, { ...base, precioLimite: undefined },
    { ...base, tipo: 'market' }, { ...base, cantidad: 0 }, { ...base, componentes: [] },
    { ...base, componentes: [{ simbolo: 'X', accion: 'buy', intencion: 'sell_to_open' }] },
    { ...base, vigencia: 'ioc' },
  ]) assert.throws(() => construirCuerpoOrden(malo), e => e.codigo === 'VALIDACION');
});

test('Alpaca: mapeo de estados, consulta, cancelación y posiciones', async () => {
  assert.equal(mapearEstadoOrden('new'), 'aceptada');
  assert.equal(mapearEstadoOrden('pending_new'), 'enviada');
  assert.equal(mapearEstadoOrden('partially_filled'), 'parcial');
  assert.equal(mapearEstadoOrden('filled'), 'ejecutada');
  assert.equal(mapearEstadoOrden('canceled'), 'cancelada');
  assert.equal(mapearEstadoOrden('rejected'), 'rechazada');
  assert.equal(mapearEstadoOrden('expired'), 'expirada');
  assert.equal(mapearEstadoOrden('desconocido'), 'enviada');

  const fetch = fakeFetch((url, init) => {
    if (init.method === 'DELETE') return { status: 204 };
    if (url.pathname === '/v2/positions') return { json: [{ asset_id: 'a1', symbol: 'AAPL260116C00200000', qty: '-2', side: 'short', avg_entry_price: '1.5', current_price: '1.2', market_value: '-240', asset_class: 'us_option' }] };
    return { json: { id: 'ord-9', client_order_id: 'c', status: 'canceled', qty: '1', filled_qty: '0' } };
  });
  const cliente = alpaca(fetch);
  const cancelada = await cliente.cancelarOrden('ord-9');
  assert.equal(fetch.llamadas[0].method, 'DELETE');
  assert.equal(fetch.llamadas[0].url.pathname, '/v2/orders/ord-9');
  assert.equal(fetch.llamadas[1].method, 'GET');
  assert.equal(cancelada.estado, 'cancelada');
  await assert.rejects(cliente.consultarOrden('../v2/account'), e => e.codigo === 'VALIDACION');
  const [p] = await cliente.posiciones();
  assert.deepEqual(p, { posicionExternaId: 'a1', simbolo: 'AAPL260116C00200000', lado: 'short', cantidad: 2, precioPromedio: 1.5, precioActual: 1.2, valorMercado: -240, claseActivo: 'us_option', plNoRealizado: null, plPctNoRealizado: null });
});

test('Alpaca: búsqueda por client_order_id y posiciones en formato no reconocido', async () => {
  let posiciones = {};
  const fetch = fakeFetch(url => (url.pathname === '/v2/positions' ? { json: posiciones } : { json: { id: 'ord-1', client_order_id: 'key 1', status: 'new', qty: '1', filled_qty: '0' } }));
  const cliente = alpaca(fetch);
  assert.equal((await cliente.consultarPorClientOrderId('key 1')).ordenExternaId, 'ord-1');
  assert.equal(fetch.llamadas[0].url.pathname, '/v2/orders:by_client_order_id'); assert.equal(fetch.llamadas[0].url.searchParams.get('client_order_id'), 'key 1');
  await assert.rejects(cliente.consultarPorClientOrderId(''), e => e.codigo === 'VALIDACION');
  await assert.rejects(cliente.posiciones(), e => e.codigo === 'PROVEEDOR');
  posiciones = []; assert.deepEqual(await cliente.posiciones(), []);
});

test('HTTP: 429 se reintenta con espera y luego tiene éxito', async () => {
  const esperas = [];
  const fetch = fakeFetch([
    { status: 429, json: { message: 'too many requests' }, headers: { 'Retry-After': '1' } },
    { status: 503, text: 'oops' },
    { json: { MSFT: { latestTrade: { p: 1 } } } },
  ]);
  const c = await alpaca(fetch, { esperar: async ms => { esperas.push(ms); } }).cotizacion('MSFT');
  assert.equal(c.ultimo, 1);
  assert.equal(fetch.llamadas.length, 3);
  assert.deepEqual(esperas, [1000, 1000]);
});

test('HTTP: errores mapeados sin filtrar secretos', async () => {
  const casos = [
    [{ status: 401, json: { message: `invalid key ${KEY}` } }, 'SIN_CREDENCIALES', 401],
    [{ status: 404, json: { message: 'asset not found' } }, 'NO_ENCONTRADO', 404],
    [{ status: 429, json: { message: 'rate limit' } }, 'LIMITE', 429],
    [{ status: 500, json: { message: `boom ${SECRET}` } }, 'PROVEEDOR', 500],
    [{ status: 403, json: { message: 'subscription does not permit querying recent SIP data' } }, 'PROVEEDOR', 403],
    [{ status: 200, text: '<html>no json</html>' }, 'PROVEEDOR', 200],
    [new TypeError(`fetch failed ${SECRET}`), 'RED', null],
  ];
  for (const [respuesta, codigo, status] of casos) {
    const fetch = fakeFetch([respuesta]);
    await assert.rejects(alpaca(fetch).buscarActivo('AAPL'), e => {
      assert.ok(e instanceof IntegrationError);
      assert.equal(e.codigo, codigo); assert.equal(e.status, status); assert.equal(e.proveedor, 'alpaca');
      assert.ok(sinSecretos(e), 'El error no debe contener credenciales');
      return true;
    });
  }
  // 429 y 5xx: GET agota 2 reintentos (3 llamadas); POST no reintenta 5xx.
  const f429 = fakeFetch([{ status: 429, json: {} }]);
  await assert.rejects(alpaca(f429).cuenta(), e => e.codigo === 'LIMITE');
  assert.equal(f429.llamadas.length, 3);
  const fPost = fakeFetch([{ status: 502, json: {} }]);
  await assert.rejects(alpaca(fPost).enviarOrden({ clientOrderId: 'k', tipo: 'market', cantidad: 1, componentes: [{ simbolo: 'AAPL', accion: 'buy' }] }), e => e.codigo === 'PROVEEDOR');
  assert.equal(fPost.llamadas.length, 1);
});

test('HTTP: tiempo de espera agotado → RED', async () => {
  const fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(createAlpacaClient({ keyId: KEY, secretKey: SECRET, fetch, timeoutMs: 20, ...sinEspera }).cuenta(), e => e.codigo === 'RED' && /agotado/.test(e.mensaje));
});

// --- SEC ---
const companyfacts = {
  cik: 320193, entityName: 'Apple Inc.',
  facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
      { start: '2025-06-29', end: '2025-09-27', val: 102000, accn: '0000320193-25-000079', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31', frame: 'CY2025Q3' },
      { start: '2024-09-29', end: '2025-09-27', val: 416000, accn: '0000320193-25-000079', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31', frame: 'CY2025' },
      { start: '2025-03-30', end: '2025-06-28', val: 94000, accn: '0000320193-25-000073', fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-08-01', frame: 'CY2025Q2' },
      { start: '2025-03-30', end: '2025-06-28', val: 94000, accn: '0000320193-26-000010', fy: 2026, fp: 'Q3', form: '10-Q', filed: '2026-08-01' },
      { start: '2024-09-29', end: '2025-06-28', val: 313000, accn: '0000320193-25-000073', fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-08-01' },
    ] } },
    Revenues: { units: { USD: [{ start: '2014-01-01', end: '2014-03-31', val: 1, accn: 'x', form: '8-K', filed: '2014-05-01', frame: 'CY2014Q1' }] } },
    NetIncomeLoss: { units: { USD: [
      { start: '2025-03-30', end: '2025-06-28', val: 23000, accn: '0000320193-25-000073', form: '10-Q', filed: '2025-08-01', frame: 'CY2025Q2' },
      { start: '2024-09-29', end: '2025-09-27', val: 112000, accn: '0000320193-25-000079', form: '10-K', filed: '2025-10-31', frame: 'CY2025' },
    ] } },
    Assets: { units: { USD: [
      { end: '2025-06-28', val: 331000, accn: '0000320193-25-000073', form: '10-Q', filed: '2025-08-01', frame: 'CY2025Q2I' },
      { end: '2025-09-27', val: 359000, accn: '0000320193-25-000079', form: '10-K', filed: '2025-10-31', frame: 'CY2025Q3I' },
    ] } },
    EarningsPerShareDiluted: { units: { 'USD/shares': [{ start: '2025-03-30', end: '2025-06-28', val: 1.57, accn: '0000320193-25-000073', form: '10-Q', filed: '2025-08-01', frame: 'CY2025Q2' }] } },
  } },
};

const xml13F = (filas, prefijo = '') => `<?xml version="1.0"?><${prefijo}informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${filas.map(f => `
  <${prefijo}infoTable><${prefijo}nameOfIssuer>${f.n}</${prefijo}nameOfIssuer><${prefijo}titleOfClass>COM</${prefijo}titleOfClass><${prefijo}cusip>${f.c}</${prefijo}cusip><${prefijo}value>${f.v}</${prefijo}value>
  <${prefijo}shrsOrPrnAmt><${prefijo}sshPrnamt>${f.s}</${prefijo}sshPrnamt><${prefijo}sshPrnamtType>${f.t || 'SH'}</${prefijo}sshPrnamtType></${prefijo}shrsOrPrnAmt>${f.pc ? `<${prefijo}putCall>${f.pc}</${prefijo}putCall>` : ''}
  <${prefijo}investmentDiscretion>SOLE</${prefijo}investmentDiscretion></${prefijo}infoTable>`).join('')}</${prefijo}informationTable>`;

const rutasSec = url => {
  const p = url.pathname;
  if (url.href === 'https://www.sec.gov/files/company_tickers.json') return { json: { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' } } };
  if (p === '/api/xbrl/companyfacts/CIK0000320193.json') return { json: companyfacts };
  if (p === '/submissions/CIK0000000111.json') return { json: { cik: '111', name: 'FONDO UNO', filings: { recent: {
    accessionNumber: ['0000000111-26-000003', '0000000111-26-000002', '0000000111-26-000001', '0000000111-25-000009'],
    filingDate: ['2026-11-10', '2026-09-01', '2026-08-12', '2026-05-14'],
    reportDate: ['2026-09-30', '', '2026-06-30', '2026-03-31'],
    form: ['13F-HR', 'SC 13G', '13F-HR', '13F-HR'],
    primaryDocument: ['xslForm13F_X02/primary_doc.xml', 'x.htm', 'xslForm13F_X02/primary_doc.xml', 'xslForm13F_X02/primary_doc.xml'],
  } } } };
  if (p === '/submissions/CIK0000000222.json') return { json: { cik: '222', name: 'FONDO DOS', filings: { recent: {
    accessionNumber: ['0000000222-26-000007'], filingDate: ['2026-11-14'], reportDate: ['2026-09-30'], form: ['13F-HR'], primaryDocument: ['primary_doc.xml'],
  } } } };
  if (p === '/submissions/CIK0000000333.json') return { status: 404, text: 'Not Found' };
  const indice = /^\/Archives\/edgar\/data\/(\d+)\/(\d+)\/index\.json$/.exec(p);
  if (indice) return { json: { directory: { item: [{ name: 'primary_doc.xml' }, { name: `${indice[2]}-index.html` }, { name: 'infotable.xml' }] } } };
  if (p.endsWith('/000000011126000003/infotable.xml')) return { text: xml13F([{ n: 'APPLE INC', c: '037833100', v: 1000, s: 10 }, { n: 'APPLE INC', c: '037833100', v: 500, s: 5 }, { n: 'APPLE INC', c: '037833100', v: 99, s: 1, pc: 'Call' }, { n: 'MICROSOFT CORP', c: '594918104', v: 7, s: 1 }]) };
  if (p.endsWith('/000000011126000001/infotable.xml')) return { text: xml13F([{ n: 'Apple Inc.', c: '037833100', v: 800, s: 9 }]) };
  if (p.endsWith('/000000022226000007/infotable.xml')) return { text: xml13F([{ n: 'APPLE INC', c: '037833100', v: 300, s: 3 }, { n: 'APPLE INC', c: '037833100', v: 50, s: 50, t: 'PRN' }], 'ns1:') };
  return { status: 404, text: 'Not Found' };
};

test('SEC: User-Agent obligatorio antes de cualquier solicitud', async () => {
  const fetch = fakeFetch(rutasSec);
  for (const ua of [undefined, '', '   ']) {
    const sec = createSecClient({ userAgent: ua, fetch, esperar: async () => {} });
    await assert.rejects(sec.cikDeSimbolo('AAPL'), e => e.codigo === 'SIN_CREDENCIALES' && e.proveedor === 'sec');
  }
  assert.equal(fetch.llamadas.length, 0);
});

test('SEC: CIK desde tickers en caché, encabezado User-Agent y ritmo', async () => {
  const esperas = [];
  let reloj = 0;
  const fetch = fakeFetch(rutasSec);
  const sec = createSecClient({ userAgent: UA, fetch, esperaMs: 120, ahora: () => reloj, esperar: async ms => { esperas.push(ms); } });
  assert.deepEqual(await sec.cikDeSimbolo('aapl'), { cik: '0000320193', nombre: 'Apple Inc.', simbolo: 'AAPL' });
  assert.equal((await sec.cikDeSimbolo('BRK.B')).cik, '0001067983');
  await assert.rejects(sec.cikDeSimbolo('NOPE'), e => e.codigo === 'NO_ENCONTRADO');
  assert.equal(fetch.llamadas.length, 1, 'company_tickers.json se descarga una sola vez');
  assert.equal(fetch.llamadas[0].headers['User-Agent'], UA);
  await sec.fundamentales('320193');
  assert.deepEqual(esperas, [120], 'Segunda solicitud inmediata espera el intervalo mínimo');
});

test('SEC: fundamentales por frame con alternativas de conceptos', async () => {
  const fetch = fakeFetch(rutasSec);
  const sec = createSecClient({ userAgent: UA, fetch, esperar: async () => {} });
  const periodos = await sec.fundamentales(320193);
  assert.equal(fetch.llamadas[0].url.href, 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
  assert.deepEqual(periodos.map(p => [p.periodoInicio, p.periodoFin, p.forma]), [
    ['2025-06-29', '2025-09-27', '10-Q'],
    ['2024-09-29', '2025-09-27', '10-K'],
    ['2025-03-30', '2025-06-28', '10-Q'],
  ], 'Sin duplicados por comparativos, sin YTD sin frame y sin formas 8-K');
  const q2 = periodos.find(p => p.periodoFin === '2025-06-28');
  assert.deepEqual(q2.fuente, { proveedor: 'sec', fechaDato: '2025-08-01', referencia: '0000320193-25-000073' });
  assert.deepEqual(q2.metricas, [
    { nombre: 'ingresos', valor: 94000, unidad: 'USD', periodo: 'CY2025Q2' },
    { nombre: 'utilidad_neta', valor: 23000, unidad: 'USD', periodo: 'CY2025Q2' },
    { nombre: 'activos', valor: 331000, unidad: 'USD', periodo: 'CY2025Q2I' },
    { nombre: 'eps_diluido', valor: 1.57, unidad: 'USD/shares', periodo: 'CY2025Q2' },
  ]);
  const anual = periodos.find(p => p.forma === '10-K');
  assert.equal(anual.metricas.find(m => m.nombre === 'activos').valor, 359000);
  assert.equal(anual.metricas.find(m => m.nombre === 'utilidad_neta').valor, 112000);
});

test('SEC: tenencias 13F agrupadas por corte, por CUSIP y por nombre', async () => {
  const fetch = fakeFetch(rutasSec);
  const sec = createSecClient({ userAgent: UA, fetch, esperar: async () => {} });
  const filers = [{ cik: '111', nombre: 'Fondo Uno' }, { cik: 222, nombre: 'Fondo Dos' }, { cik: '333', nombre: 'Sin datos' }];
  const reportes = await sec.tenencias13F({ filers, nombreEmisor: 'Apple Inc.', cusip: '037833100', cortes: 2 });
  assert.ok(fetch.llamadas.some(l => l.url.href === 'https://www.sec.gov/Archives/edgar/data/111/000000011126000003/index.json'));
  assert.ok(fetch.llamadas.every(l => l.headers['User-Agent'] === UA));
  assert.deepEqual(reportes.map(r => r.fechaCorte), ['2026-09-30', '2026-06-30']);
  const [ultimo, previo] = reportes;
  assert.equal(ultimo.fechaPublicacion, '2026-11-14');
  assert.deepEqual(ultimo.fuente, { proveedor: 'sec', fechaDato: '2026-11-14', referencia: '0000000111-26-000003,0000000222-26-000007' });
  assert.deepEqual(ultimo.tenencias, [
    { institucion: 'Fondo Uno', identificadorInstitucion: '0000000111', acciones: 15, valorReportado: 1500, unidad: 'USD' },
    { institucion: 'Fondo Dos', identificadorInstitucion: '0000000222', acciones: 3, valorReportado: 300, unidad: 'USD' },
  ]);
  assert.deepEqual(previo.tenencias.map(t => t.acciones), [9]);
  assert.equal(ultimo.omitidos[0].cik, '0000000333');

  const porNombre = await createSecClient({ userAgent: UA, fetch: fakeFetch(rutasSec), esperar: async () => {} })
    .tenencias13F({ filers: [{ cik: '111', nombre: 'Fondo Uno' }], nombreEmisor: 'Apple Inc', cortes: 1 });
  assert.equal(porNombre.length, 1);
  assert.equal(porNombre[0].tenencias[0].valorReportado, 1500);
  await assert.rejects(sec.tenencias13F({ filers: [], nombreEmisor: 'x' }), e => e.codigo === 'VALIDACION');
});

test('SEC: parser 13F y normalización de nombres', () => {
  const filas = parsearTabla13F(xml13F([{ n: 'AT&amp;T INC', c: '00206r102', v: 10, s: 2 }], 'n1:'));
  assert.deepEqual(filas[0], { nombreEmisor: 'AT&T INC', clase: 'COM', cusip: '00206R102', valor: 10, cantidad: 2, tipoCantidad: 'SH', putCall: null });
  assert.equal(normalizarEmisor('Apple Inc.'), normalizarEmisor('APPLE INC'));
  assert.equal(normalizarEmisor('MICROSOFT CORP'), 'MICROSOFT');
});

// --- Descubrimiento de instituciones 13F: zip oficial por rangos + búsqueda de EDGAR (formas reales, sin red).
function zip(archivos) {
  const locales = [], central = [];
  let posicion = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const n = Buffer.from(nombre), datos = deflateRawSync(Buffer.from(texto));
    const local = Buffer.alloc(30 + 4); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(4, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(datos.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(posicion, 42);
    locales.push(local.subarray(0, 30), n, local.subarray(30), datos); central.push(c, n);
    posicion += 34 + n.length + datos.length;
  }
  const dir = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 10); fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(posicion, 16);
  return Buffer.concat([...locales, Buffer.alloc(0), dir, fin]);
}
const AHORA_13F = Date.UTC(2026, 10, 23);
// Cuatro fondos (111 el mayor); cada uno reporta LLY con 10× su número en el corte reciente. 333 falla al leer su tabla.
function redSec({ ranking = true, recientes = ['111', '222', '333', '444'], rango = 206 } = {}) {
  const llamadas = [];
  const datos = zip({
    'DATA/SUBMISSION.tsv': 'ACCESSION_NUMBER\tFILING_DATE\tSUBMISSIONTYPE\tCIK\tPERIODOFREPORT\n' + ['444', '111', '333', '222'].map(c => `a${c}\t14-AUG-2026\t13F-HR\t${c}\t30-JUN-2026`).join('\n') + '\nviejo\t01-JUL-2026\t13F-HR\t999\t31-MAR-2026\nnt\t14-AUG-2026\t13F-NT\t888\t30-JUN-2026\n',
    'DATA/INFOTABLE.tsv': 'x'.repeat(1000),
    'DATA/SUMMARYPAGE.tsv': 'ACCESSION_NUMBER\tTABLEENTRYTOTAL\tTABLEVALUETOTAL\na111\t9\t900\na222\t9\t800\na333\t9\t700\na444\t9\t600\nviejo\t9\t99999\n',
  });
  const hit = (cik, corte, fecha, extra = {}) => ({ _id: `000${cik}-26-${corte.slice(5, 7)}:tabla.xml`, _source: { ciks: [cik.padStart(10, '0')], period_ending: corte, display_names: [`FONDO ${cik}, Inc.  (F${cik === '111' ? 'A, FB' : 'A'})  (CIK ${cik.padStart(10, '0')})`], file_date: fecha, form: '13F-HR', file_type: 'INFORMATION TABLE', ...extra } });
  const fn = async (url, init = {}) => {
    const u = new URL(url); llamadas.push({ u, rango: init.headers?.Range });
    const r = (cuerpo, o = {}) => new Response(cuerpo, { status: 200, ...o });
    if (u.pathname.endsWith('/form-13f-data-sets')) return ranking ? r('<a href="/files/x/01jun2026-31aug2026_form13f.zip">') : r('', { status: 404 });
    if (u.pathname.endsWith('_form13f.zip')) {
      if (rango !== 206) return r(datos);
      const m = /bytes=(\d*)-(\d+)/.exec(init.headers.Range);
      const [a, b] = m[1] === '' ? [Math.max(0, datos.length - Number(m[2])), datos.length] : [Number(m[1]), Math.min(datos.length, Number(m[2]) + 1)];
      return r(datos.subarray(a, b), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b - 1}/${datos.length}` } });
    }
    if (u.host === 'efts.sec.gov') {
      const q = u.searchParams.get('q'), ciks = (u.searchParams.get('ciks') || '').split(',').filter(Boolean).map(Number).map(String), desde = u.searchParams.get('startdt');
      let hits;
      if (q === '"ELI LILLY"') hits = [hit('555', '2026-09-30', '2026-11-01', { form: '13F-HR/A' }), hit('555', '2026-09-30', '2026-11-01'), hit('666', '2026-09-30', '2026-11-01')];
      else if (desde === '2026-10-01') hits = [...recientes.map(c => hit(c, '2026-09-30', '2026-11-13')), hit('111', '2024-03-31', '2026-11-10', { form: '13F-HR/A' })];
      else if (desde === '2026-07-01') hits = ['111', '222', '333', '444'].map(c => hit(c, '2026-06-30', '2026-08-14'));
      else hits = ['111', '222'].map(c => hit(c, '2026-03-31', '2026-05-14'));
      if (ciks.length) hits = hits.filter(h => ciks.includes(String(Number(h._source.ciks[0]))));
      return r(JSON.stringify({ hits: { total: { value: hits.length }, hits } }));
    }
    const portada = /\/data\/(\d+)\/\d+\/primary_doc\.xml$/.exec(u.pathname);
    if (portada) return r(`<edgarSubmission><ns1:tableValueTotal>${1000 - Number(portada[1])}</ns1:tableValueTotal></edgarSubmission>`, portada[1] === '444' ? { status: 404 } : {});
    const m = /\/data\/(\d+)\/\d+?(\d\d)\/tabla\.xml$/.exec(u.pathname);
    if (m && m[1] === '333') return r('', { status: 404 });
    if (m) return r(xml13F([{ n: 'LILLY ELI &amp; CO', c: '532457108', v: 5, s: Number(m[1]) * (m[2] === '09' ? 10 : 9) }, { n: 'LILLY ELI &amp; CO', c: '532457AA1', v: 1, s: 1, t: 'PRN' }, { n: 'OTRA', c: '000000000', v: 1, s: 1 }, ...(m[1] === '666' ? [{ n: 'ELI LILLY AND CO', c: '532457108', v: 1, s: 1 }] : [])]));
    return r('', { status: 404 });
  };
  return { llamadas, sec: createSecClient({ userAgent: UA, fetch: fn, esperar: async () => {}, ahora: () => AHORA_13F }) };
}

test('13F: instituciones descubiertas en la SEC; un fondo que falla no detiene a los demás', async () => {
  const { sec, llamadas } = redSec();
  const [reciente, previo] = await sec.tenencias13F({ nombreEmisor: 'ELI LILLY & Co', cortes: 2 });
  assert.deepEqual([reciente.fechaCorte, reciente.fechaPublicacion, previo.fechaCorte], ['2026-09-30', '2026-11-13', '2026-06-30']);
  assert.deepEqual(reciente.tenencias.map(t => [t.institucion, t.identificadorInstitucion, t.acciones]), [['FONDO 111, Inc.', '0000000111', 1110], ['FONDO 222, Inc.', '0000000222', 2220], ['FONDO 444, Inc.', '0000000444', 4440]]);
  assert.deepEqual(previo.tenencias.map(t => t.acciones), [999, 1998, 3996]);
  assert.deepEqual(reciente.omitidos.map(o => o.cik), ['0000000333']); assert.deepEqual(reciente.datosFaltantes, ['1 institución(es) sin leer']);
  const ciks = llamadas.filter(l => l.u.searchParams.get('ciks'));
  assert.ok(ciks.every(l => l.u.searchParams.get('q') === '"532457108"' && l.u.searchParams.get('ciks') === '0000000111,0000000222,0000000333,0000000444'), 'ordenadas por valor, sin otros trimestres ni avisos 13F-NT');
  assert.equal(llamadas.filter(l => l.rango).length, 3, 'del zip solo se piden rangos');
  const n = llamadas.length;
  await sec.tenencias13F({ nombreEmisor: 'Eli Lilly and Company' });
  assert.deepEqual(llamadas.slice(n).map(l => l.u.host + l.u.pathname).filter(x => !x.startsWith('efts')), ['www.sec.gov/Archives/edgar/data/333/00033326-09/tabla.xml'.replace('00033326-09', '0003332609'), 'www.sec.gov/Archives/edgar/data/333/0003332606/tabla.xml'], 'ranking, CUSIP y tablas leídas quedan en memoria');
});

test('13F: sin ranking oficial degrada y lo informa; un trimestre a medio presentar no se compara', async () => {
  for (const opciones of [{ ranking: false }, { rango: 200 }]) {
    const [r] = await redSec(opciones).sec.tenencias13F({ nombreEmisor: 'ELI LILLY & Co' });
    assert.deepEqual(r.tenencias.map(t => t.identificadorInstitucion), ['0000000111', '0000000222'], 'ordenadas por el valor de su portada; sin portada quedan fuera');
    assert.match(r.datosFaltantes[0], /ranking/);
  }
  const reportes = await redSec({ recientes: ['111'] }).sec.tenencias13F({ nombreEmisor: 'ELI LILLY & Co' });
  assert.deepEqual(reportes.map(r => r.fechaCorte), ['2026-06-30', '2026-03-31']);
  assert.match(reportes[0].datosFaltantes[0], /2026-09-30 aún incompleto \(1 de 4/);
  await assert.rejects(redSec().sec.tenencias13F({ cusip: '532457108', nombreEmisor: '' }).then(r => { assert.equal(r.length, 2); throw new Error('ok'); }), /ok/);
  await assert.rejects(redSec().sec.tenencias13F({}), e => e.codigo === 'VALIDACION');
});

test('13F: si todas las instituciones fallan se informa el error; sin credenciales no se consulta', async () => {
  const sec = createSecClient({ userAgent: UA, esperar: async () => {}, fetch: async () => new Response('', { status: 503 }) });
  await assert.rejects(sec.tenencias13F({ filers: ['111', '222'], nombreEmisor: 'X' }), e => e.codigo === 'PROVEEDOR');
  await assert.rejects(sec.tenencias13F({ nombreEmisor: 'X' }), e => e.codigo === 'PROVEEDOR');
  await assert.rejects(createSecClient({ fetch: async () => assert.fail() }).tenencias13F({ nombreEmisor: 'X' }), e => e.codigo === 'SIN_CREDENCIALES');
});

test('13F: tablas enormes por trozos, con tope de tamaño', async () => {
  const texto = xml13F(Array.from({ length: 500 }, (_, i) => ({ n: i % 100 ? 'OTRA' : 'ÉSTA CO', c: String(i).padStart(9, '0'), v: 1, s: i })), 'ns1:');
  const bytes = Buffer.from(texto);
  const res = () => ({ body: new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(new Uint8Array(bytes.subarray(i, i + 37))); c.close(); } }) });
  const filas = await leerTablaPorTrozos(res(), f => f.nombreEmisor === 'ÉSTA CO');
  assert.deepEqual(filas.map(f => f.cantidad), [0, 100, 200, 300, 400]);
  await assert.rejects(leerTablaPorTrozos(res(), () => true, { maxBytes: 1000 }), e => e.codigo === 'RED' && /tamaño/.test(e.mensaje));
});

test('13F: nombres de emisor, cortes y ningún CIK escrito en el código', () => {
  for (const [a, b] of [['ELI LILLY & Co', 'LILLY ELI &amp; CO'], ['BANK OF AMERICA CORP /DE/', 'BANK AMERICA CORP'], ['Walt Disney Co', 'DISNEY WALT CO'], ['PROCTER & GAMBLE Co', 'PROCTER AND GAMBLE CO'], ['Apple Inc. Common Stock', 'APPLE INC']]) assert.equal(claveEmisor(a), claveEmisor(b), a);
  assert.notEqual(claveEmisor('APPLE INC'), claveEmisor('APPLE HOSPITALITY REIT INC'));
  assert.deepEqual(['AT&T INC.', 'ELI LILLY & Co', 'Apple Inc.', 'BANK OF AMERICA CORP /DE/'].map(fraseEmisor), ['AT amp T', 'ELI LILLY', 'APPLE', 'BANK OF AMERICA']);
  assert.deepEqual(cortesTrimestrales(3, Date.UTC(2026, 10, 23)), ['2026-09-30', '2026-06-30', '2026-03-31']);
  assert.deepEqual(cortesTrimestrales(2, Date.UTC(2026, 0, 2)), ['2025-12-31', '2025-09-30']);
  assert.throws(() => rankingDesdeTablas('CIK\n', 'X\n'), e => e.codigo === 'PROVEEDOR');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/integrations/institucionales.js'), 'utf8'), /\b\d{7,10}['"]/);
});

test('Webull: sin credenciales y datos de mercado no implementados, sin red', async () => {
  const webull = createWebullClient();
  await assert.rejects(webull.enviarOrden({}), e => e.codigo === 'SIN_CREDENCIALES' && e.proveedor === 'webull');
  assert.equal(webull.velas, undefined, 'los datos de mercado son de Alpaca');
});

test('Integraciones: estado sin revelar valores', () => {
  const fetch = fakeFetch(() => ({ json: {} }));
  const completo = createIntegrations({ ALPACA_KEY_ID: KEY, ALPACA_SECRET_KEY: SECRET, ALPACA_DATA_FEED: 'sip', SEC_USER_AGENT: UA }, fetch);
  const estado = completo.estado();
  assert.deepEqual(estado, { alpaca: { configurado: true, feed: 'sip', opcionesFeed: 'indicative', entorno: 'paper' }, sec: { configurado: true }, webull: { configurado: false }, tesoro: { configurado: true } });
  assert.ok(!JSON.stringify(estado).includes(SECRET) && !JSON.stringify(estado).includes(KEY) && !JSON.stringify(estado).includes('example.com'));
  const vacio = createIntegrations({}, fetch).estado();
  assert.deepEqual(vacio, { alpaca: { configurado: false, feed: 'iex', opcionesFeed: 'indicative', entorno: 'paper' }, sec: { configurado: false }, webull: { configurado: false }, tesoro: { configurado: true } });
});
