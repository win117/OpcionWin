// Tasa del Tesoro, eventos (dividendos, divisiones, resultados), interés abierto e historiales: adaptadores con fetch simulado y lógica pura.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAlpacaClient, createSecClient } = require('../dist/integrations');
const { createTesoroClient, parsearCurva } = require('../dist/integrations/tesoro.client');
const { createTasa } = require('../dist/api/v1/services/tasa.service');
const { createEventos, estimarReporte } = require('../dist/api/v1/services/eventos.service');
const { tasaParaPlazo, rendimientoDividendo } = require('../dist/cores/tasa');
const bs = require('../dist/cores/blackscholes');
const coreEstrategias = require('../dist/cores/estrategias.core');

const eo = () => import(pathToFileURL(join(__dirname, '../web/src/utils/estrategiasOrden.js')).href);
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const json = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const alpacaCon = fetch => createAlpacaClient({ keyId: 'K', secretKey: 'S', intervaloMs: 0, fetch });
const CSV = 'Date,"4 WEEKS BANK DISCOUNT","4 WEEKS COUPON EQUIVALENT","13 WEEKS COUPON EQUIVALENT"\n11/24/2026,4.04,4.11,4.28\n11/23/2026,4.00,4.00,4.00\n';
const PUNTOS = [{ dias: 28, tasa: 0.0411 }, { dias: 91, tasa: 0.0428 }];

test('Tesoro: lee la fila más reciente, ignora el descuento bancario y usa el mes anterior si aún no hay filas', async () => {
  const c = parsearCurva(CSV);
  assert.equal(c.fecha, '2026-11-24'); assert.deepEqual(c.puntos.map(p => p.dias), [28, 91]); cerca(c.puntos[0].tasa, 0.0411); cerca(c.puntos[1].tasa, 0.0428);
  assert.equal(parsearCurva('Date\n'), null); assert.equal(parsearCurva('<html>'), null); assert.equal(parsearCurva(''), null);
  assert.equal(parsearCurva('Date,"4 WEEKS COUPON EQUIVALENT"\n11/24/2026,\n11/23/2026,4.10').fecha, '2026-11-23', 'una celda vacía no es 0 %');
  const urls = [];
  const t = createTesoroClient({ ahora: () => Date.parse('2026-12-01T12:00:00Z'), fetch: async u => { urls.push(String(u)); return new Response(String(u).includes('/202612?') ? 'Date,"4 WEEKS COUPON EQUIVALENT"\n' : CSV, { status: 200 }); } });
  assert.equal((await t.curva()).fecha, '2026-11-24'); assert.equal(urls.length, 2); assert.match(urls[1], /all\/202611\?/);
  await assert.rejects(createTesoroClient({ fetch: async () => new Response('<html></html>', { status: 200 }) }).curva(), e => e.proveedor === 'tesoro' && e.codigo === 'PROVEEDOR');
});

test('tasa para un plazo: interpola, respeta los extremos y es la misma en servidor y web', async () => {
  const web = await eo();
  for (const dias of [1, 28, 40, 91, 400]) {
    const simple = dias <= 28 ? 0.0411 : dias >= 91 ? 0.0428 : 0.0411 + 0.0017 * (dias - 28) / 63, T = dias / 365;
    cerca(tasaParaPlazo(PUNTOS, dias), Math.log(1 + simple * T) / T); cerca(web.tasaParaPlazo(PUNTOS, dias), tasaParaPlazo(PUNTOS, dias), 1e-15);
  }
  for (const f of [tasaParaPlazo, web.tasaParaPlazo]) for (const x of [[], null, undefined, [{ dias: 0, tasa: 1 }]]) assert.equal(f(x, 30), null);
  cerca(rendimientoDividendo(4, 100), Math.log(1.04)); assert.equal(rendimientoDividendo(null, 100), 0); assert.equal(rendimientoDividendo(4, 0), 0); cerca(web.rendimientoDividendo(4, 100), Math.log(1.04));
});

test('servicio de tasa: una sola consulta vigente y conserva la última si el Tesoro falla', async () => {
  let t = 0, n = 0, falla = false;
  const s = createTasa({ ahora: () => t, integraciones: { tesoro: { curva: async () => { n++; if (falla) throw new Error('x'); return { fecha: 'F', puntos: PUNTOS }; } } } });
  await Promise.all([s.curva(), s.curva()]); assert.equal(n, 1); assert.ok(await s.para(30) > 0.04);
  falla = true; t = 13 * 3600000; assert.equal((await s.curva()).fecha, 'F'); assert.equal(n, 2); await s.curva(); assert.equal(n, 2, 'espera antes de reintentar');
  assert.equal(await createTasa({ integraciones: {} }).para(30), null);
});

test('probabilidad: usa tasa y dividendo, igual en el ticket y en el servidor; sin datos usa 0 y lo dice', async () => {
  const { metricasOrden } = await eo(), ahora = new Date('2026-11-24T20:00:00Z'), vencimiento = '2027-02-23', S = 100; // 91 días
  const patas = [{ accion: 'buy', item: { tipo: 'call', strike: 100, bid: 5, ask: 5, volatilidadImplicita: 0.3 } }];
  const base = { patas, precioNeto: 5, credito: false, S, items: [], vencimiento, ahora };
  const con = metricasOrden({ ...base, tasa: PUNTOS, dividendoAnual: 3 }), sin = metricasOrden(base);
  const r = tasaParaPlazo(PUNTOS, 91), q = rendimientoDividendo(3, S);
  cerca(con.probabilidad, bs.probabilidadSobre({ S, X: 105, T: 91 / 365, sigma: 0.3, r, q }), 1e-6); cerca(con.tasa, r); cerca(con.dividendo, q);
  cerca(sin.probabilidad, bs.probabilidadSobre({ S, X: 105, T: 91 / 365, sigma: 0.3 }), 1e-6); assert.equal(sin.tasa, null); assert.notEqual(sin.probabilidad, con.probabilidad);
  const srv = coreEstrategias.evaluarConfiguracion({ estrategia: 'LONG_CALL', precioSubyacente: S, fechaReferencia: ahora.toISOString(), tasaLibreRiesgo: r, rendimientoDividendo: q,
    componentes: [{ tipo: 'call', strike: 100, accion: 'buy', cantidad: 1, vencimiento, precio: 5, volatilidadImplicita: 0.3 }] });
  cerca(con.probabilidad, srv.metricas.find(m => m.nombre === 'probabilidad_ganancia').valor, 1e-4); assert.match(srv.motivos.join(' '), /dividendo = 2\.96 %/);
});

test('próximo reporte: mismo trimestre + 364 días, margen propio, y sin historial no inventa', () => {
  const apple = ['2025-01-30', '2025-05-01', '2025-07-31', '2025-10-30', '2026-01-29', '2026-04-30', '2026-07-30', '2026-11-02'];
  const r = estimarReporte(apple, '2026-11-24');
  assert.deepEqual(r, { fecha: '2027-01-28', desde: '2027-01-24', hasta: '2027-02-01', margen: 4, estimada: true });
  assert.equal(estimarReporte([...apple, '2026-11-10'], '2026-11-24').fecha, '2027-01-28', 'una corrección del mismo trimestre no cuenta');
  assert.equal(estimarReporte(apple, '2027-01-30').fecha, '2027-01-28', 'dentro del margen sigue vigente'); assert.equal(estimarReporte(apple, '2027-01-30').desde, '2027-01-30');
  assert.equal(estimarReporte(apple.slice(-3), '2026-11-24'), null); assert.equal(estimarReporte(apple, '2027-08-01'), null); assert.equal(estimarReporte([], '2026-11-24'), null);
  assert.equal(estimarReporte(['2024-11-01', '2025-02-01', '2025-05-01', '2025-08-01', '2025-11-30', '2026-02-01', '2026-05-01', '2026-08-01'], '2026-08-10').margen, 14, 'margen acotado');
});

test('SEC: solo 8-K con punto 2.02; los emisores con miles de documentos usan la búsqueda de EDGAR', async () => {
  const pedidos = [];
  const recientes = n => ({ filings: { recent: { form: ['8-K', '8-K', '10-Q', ...Array(n).fill('424B2')], items: ['2.02,9.01', '5.02', '2.02', ...Array(n).fill('')], filingDate: ['2026-10-30', '2026-10-01', '2026-11-01', ...Array(n).fill('2026-11-02')] } } });
  const crear = n => createSecClient({ userAgent: 'x x@x', esperaMs: 0, esperar: async () => {}, fetch: async u => { pedidos.push(String(u)); return json(String(u).includes('efts') ? { hits: { hits: [{ _source: { file_date: '2026-07-14', items: ['2.02', '9.01'] } }, { _source: { file_date: '2026-07-20', items: ['8.01'] } }] } } : recientes(n)); } });
  assert.deepEqual(await crear(0).reportesResultados('320193'), ['2026-10-30']); assert.equal(pedidos.length, 1);
  assert.deepEqual(await crear(997).reportesResultados('19617'), ['2026-07-14', '2026-10-30']);
});

test('Alpaca: dividendos, divisiones, interés abierto, velas de opciones e historial de la cartera', async () => {
  const a = alpacaCon(async u => {
    const s = String(u);
    if (s.includes('/v1/corporate-actions')) return json({ corporate_actions: { cash_dividends: [{ ex_date: '2026-12-01', payable_date: '2026-12-15', rate: 0.53, special: false }, { ex_date: '2026-09-15', rate: 0.5 }, { ex_date: '2026-01-01', rate: 0 }], forward_splits: [{ ex_date: '2026-12-10', old_rate: 1, new_rate: 4 }] } });
    if (s.includes('/options/contracts')) return json({ option_contracts: [{ symbol: 'A261218C00100000', underlying_symbol: 'A', type: 'call', strike_price: '100', expiration_date: '2026-12-18', open_interest: '409', open_interest_date: '2026-11-20' }, { symbol: 'A261218P00100000', underlying_symbol: 'A', type: 'put', strike_price: '100', expiration_date: '2026-12-18' }] });
    if (s.includes('/options/bars')) return json({ bars: { A261218C00100000: [{ t: '2026-11-24T05:00:00Z', o: 1, h: 2, l: 1, c: 1.5, v: 3 }] } });
    return json({ timestamp: [1700000000, 1700086400], equity: [0, 100500.5] });
  });
  const c = await a.accionesCorporativas('A', {});
  assert.deepEqual(c.dividendos.map(d => [d.exFecha, d.monto, d.especial]), [['2026-09-15', 0.5, false], ['2026-12-01', 0.53, false]]); assert.deepEqual(c.divisiones, [{ exFecha: '2026-12-10', de: 1, a: 4 }]);
  const k = await a.contratos({ subyacente: 'A' }); assert.equal(k[0].interesAbierto, 409); assert.equal('interesAbierto' in k[1], false, 'sin dato no es 0');
  assert.equal((await a.velasOpciones(['A261218C00100000'])).A261218C00100000[0].cierre, 1.5);
  assert.deepEqual((await a.historialCartera({ periodo: '1M' })).map(p => p.valor), [100500.5]); await assert.rejects(a.historialCartera({ periodo: 'x' }), e => e.codigo === 'VALIDACION');
  await assert.rejects(alpacaCon(async () => json({})).historialCartera(), e => e.codigo === 'PROVEEDOR');
});

test('eventos: cada fuente falla por separado, se guarda en memoria y suma solo dividendos ordinarios del último año', async () => {
  let n = 0, t = Date.parse('2026-11-24T15:00:00Z'), falla = false;
  const e = createEventos({ ahora: () => t, integraciones: {
    alpaca: { accionesCorporativas: async () => { n++; return { dividendos: [{ exFecha: '2025-10-01', monto: 9 }, { exFecha: '2026-03-01', monto: 0.5 }, { exFecha: '2026-06-01', monto: 3, especial: true }, { exFecha: '2026-09-01', monto: 0.5 }, { exFecha: '2026-12-01', monto: 0.53 }], divisiones: [{ exFecha: '2026-01-01' }] }; } },
    sec: { cikDeSimbolo: async () => ({ cik: '1' }), reportesResultados: async () => { if (falla) throw Object.assign(new Error(), { mensaje: 'SEC caída' }); return []; } } } });
  const [a, b] = await Promise.all([e('A'), e('A')]); assert.equal(a, b); assert.equal(n, 1);
  assert.equal(a.dividendos.anualPorAccion, 1); assert.deepEqual(a.dividendos.proximos.map(d => d.exFecha), ['2026-12-01']); assert.equal(a.dividendos.ultimo.exFecha, '2026-09-01'); assert.deepEqual(a.divisiones, []); assert.equal(a.reportes.proximo, null);
  falla = true; t += 7 * 3600000; const c = await e('A'); assert.equal(c.reportes, null); assert.match(c.faltantes[0], /SEC caída/); assert.ok(c.dividendos);
  falla = false; t += 11 * 60000; assert.deepEqual((await e('A')).faltantes, [], 'un resultado incompleto se reintenta pronto');
});

test('avisos del ticket: resultados y dividendo solo si caen antes del vencimiento y afectan', async () => {
  const { avisosEventos, liquidez, INTERES_MINIMO } = await eo();
  const p = (accion, tipo, strike, precio, extra) => ({ accion, item: { tipo, strike, bid: precio, ask: precio, ...extra } });
  const ev = { reportes: { proximo: { fecha: '2027-01-28', desde: '2027-01-24', hasta: '2027-02-01' } }, dividendos: { proximos: [{ exFecha: '2026-12-01', monto: 0.53 }] }, divisiones: [] };
  const tipos = (patas, v, S = 100) => avisosEventos(patas, S, v, ev).map(a => a.tipo);
  assert.deepEqual(tipos([p('buy', 'call', 100, 5)], '2026-12-18'), [], 'quien compra un call no puede ser asignado');
  assert.deepEqual(tipos([p('sell', 'call', 110, 1)], '2026-12-18'), ['dividendo']); assert.deepEqual(tipos([p('sell', 'put', 90, 1)], '2026-12-18'), []);
  assert.deepEqual(tipos([p('buy', 'put', 100, 5)], '2027-03-19'), ['resultados']); assert.deepEqual(tipos([p('sell', 'call', 110, 1)], '2026-11-27'), []);
  assert.match(avisosEventos([p('buy', 'put', 100, 5)], 100, '2027-01-26', ev)[0].texto, /puede caer antes/);
  const dentro = v => avisosEventos([p('sell', 'call', 95, v)], 100, '2026-12-18', ev)[0].texto;
  assert.match(dentro(5.2), /Riesgo alto/); assert.doesNotMatch(dentro(6), /Riesgo alto/);
  assert.deepEqual(avisosEventos([], 100, '2026-12-18', null), []);
  assert.equal(liquidez([p('buy', 'call', 1, 1, { interesAbierto: INTERES_MINIMO - 1 }), p('buy', 'call', 2, 1, { interesAbierto: 5000 })]).pocoInteres, true);
  assert.deepEqual([liquidez([p('buy', 'call', 1, 1)])].map(l => [l.interesMinimo, l.pocoInteres])[0], [null, false], 'sin dato no se avisa');
});
