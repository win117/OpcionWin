// Precios con el mercado cerrado: vencimientos sin precios, cotizaciones de antes de abrir y últimos precios viejos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSincronizador } = require('../dist/api/v1/services/sincronizacion.service');
const { enSesion: enSesionServidor, primaDe } = require('../dist/api/v1/services/analisis.service');
const { idDeterminista } = require('../dist/api/v1/services/registros');
const eo = () => import(pathToFileURL(join(__dirname, '../web/src/utils/estrategiasOrden.js')).href);
const HOY = new Date(2026, 10, 25, 12), hace = dias => new Date(Date.now() - dias * 86400000).toISOString();

test('sesión regular de Nueva York: misma regla en la web y en el servidor, con y sin horario de verano', async () => {
  const { enSesion } = await eo();
  for (const [t, si] of [['2026-11-24T20:59:59Z', true], ['2026-11-25T13:27:00Z', false], ['2026-11-25T14:30:00Z', true], ['2026-11-25T21:20:00Z', false], ['2026-07-01T13:31:00Z', true], ['2026-07-01T13:29:00Z', false], ['2026-11-28T16:00:00Z', false], [null, true]]) {
    assert.equal(enSesion(t), si, t); assert.equal(enSesionServidor(t), si, t);
  }
});

test('la cotización de antes de abrir con spread desmedido no fija precios; un último viejo tampoco', async () => {
  const { mid, precioInmediato, costoSpread, liquidez } = await eo();
  const fuera = '2026-11-25T13:27:59Z', dentro = '2026-11-24T20:59:00Z', mala = { bid: 0.88, ask: 11.02, fechaDato: fuera };
  for (const [item, esperado] of [[mala, null], [{ ...mala, ultimo: 4.2, ultimoFecha: hace(1) }, 4.2], [{ ...mala, ultimo: 4.2, ultimoFecha: hace(90) }, null], [{ ...mala, fechaDato: dentro }, 5.95], [{ bid: 1.9, ask: 2, fechaDato: fuera }, 1.95]]) {
    assert.equal(mid(item) == null ? null : Math.round(mid(item) * 100) / 100, esperado);
    assert.equal(primaDe(item) == null ? null : Math.round(primaDe(item) * 100) / 100, esperado, 'mismo precio en el servidor');
  }
  const p = [{ accion: 'buy', item: mala }];
  assert.equal(precioInmediato(p, false), null); assert.equal(costoSpread(p), null); assert.equal(liquidez(p).fueraDeHorario, true);
  assert.equal(liquidez([{ accion: 'buy', item: { bid: 1.9, ask: 2, fechaDato: fuera } }]).fueraDeHorario, false);
});

test('no se propone un vencimiento sin precios y los que nadie ha negociado quedan al final', async () => {
  const { elegirVencimiento, vencimientosConPrecio, sinPrecios } = await eo();
  const lista = ['2026-12-18', '2027-01-08', '2027-01-15'], d = (v, conPrecio, conInteres) => ({ vencimiento: v, contratos: 50, conPrecio, conInteres });
  const pedir = det => elegirVencimiento(lista, HOY, 7, 60, 'LONG_CALL', det);
  assert.equal(pedir([]), '2027-01-08');
  assert.equal(pedir([d('2026-12-18', 90, 85), d('2027-01-08', 0, 0), d('2027-01-15', 60, 57)]), '2027-01-15', 'recién listado sin precios');
  assert.equal(pedir([d('2026-12-18', 90, 85), d('2027-01-08', 47, 0), d('2027-01-15', 60, 57)]), '2027-01-15', 'cotiza pero nadie lo tiene');
  assert.equal(pedir(lista.map(v => d(v, 0, 0))), '2027-01-08', 'si ninguno tiene precios, el de siempre');
  assert.equal(pedir([d('2026-12-18', 90, 0), d('2027-01-08', 47, 0), d('2027-01-15', 60, 0)]), '2027-01-08', 'sin datos de interés no se penaliza');
  assert.deepEqual(vencimientosConPrecio(lista, [d('2027-01-08', 0, 0)]), ['2026-12-18', '2027-01-15']);
  assert.equal(sinPrecios([{ strike: 1 }, { bid: 0, ask: 2 }]), true); assert.equal(sinPrecios([{ ultimo: 1 }]), false); assert.equal(sinPrecios([]), false);
});

test('sincronizar fuera de horario conserva la cotización de la última sesión y actualiza el último precio', async () => {
  const { memoryFactory } = require('./helpers/memory.cjs');
  const { crear, todos } = require('../dist/api/v1/services/registros');
  const factory = memoryFactory(), ctx = { userId: 'u', database: 'mongodb' }, occ = 'TEST270115C00100000';
  let dia = new Date(); do dia = new Date(dia.getTime() - 86400000); while ([0, 6].includes(dia.getUTCDay()));
  const d = dia.toISOString().slice(0, 10), dentro = d + 'T18:00:00.000Z', fuera = d + 'T23:00:00.000Z';
  let snap = { bid: 2, ask: 2.2, ultimo: 2.1, ultimoFecha: dentro, volatilidadImplicita: 0.3, griegas: { delta: 0.5 }, fechaDato: dentro };
  const alpaca = { cotizacion: async () => ({ ultimo: 100 }), contratos: async () => [{ contratoExternoId: occ, tipo: 'call', strike: 100, vencimiento: '2027-01-15' }], snapshotsOpciones: async () => [{ contratoExternoId: occ, ...snap }] };
  const id = idDeterminista(idDeterminista('u', 'contrato', 'alpaca', occ), 'snapshot');
  await crear('empresas', ctx, { simbolo: 'TEST', nombre: 'Test', mercado: 'NASDAQ', activo: true }, factory);
  const s = createSincronizador({ integraciones: { alpaca, sec: {} }, factory });
  const correr = () => s.ejecutar(ctx, { recurso: 'contratos', simbolos: ['TEST'] });
  await correr();
  snap = { bid: 0.1, ask: 9, ultimo: 2.4, ultimoFecha: fuera, volatilidadImplicita: 0.9, griegas: { delta: 0.1 }, fechaDato: fuera };
  await correr();
  const g = (await todos('datos-mercado', ctx, { tipo: 'snapshot_opcion' }, factory)).find(x => x._id === id);
  assert.deepEqual([g.bid, g.ask, g.ultimo, g.volatilidadImplicita, g.griegas.delta, new Date(g.fuente.fechaDato).toISOString()], [2, 2.2, 2.4, 0.3, 0.5, dentro]);
});

test('cadena en pantalla: strikes alrededor del precio, cambio, mensual y mezcla de cotizaciones', async () => {
  const c = await import(pathToFileURL(join(__dirname, '../web/src/utils/cadena.js')).href);
  const filas = c.porStrike([90, 95, 100, 105, 110].flatMap(strike => [{ strike, tipo: 'call' }, { strike, tipo: 'put' }]));
  assert.equal(filas.length, 5); assert.deepEqual([filas[0].call.tipo, filas[0].put.tipo], ['call', 'put']);
  const ver = (p, n) => c.cercanas(filas, p, n).map(x => x.strike);
  assert.deepEqual(ver(101, 2), [100, 105]); assert.deepEqual(ver(80, 2), [90, 95]); assert.deepEqual(ver(200, 2), [105, 110]); assert.equal(ver(101, 0).length, 5); assert.equal(ver(null, 2).length, 5);
  assert.ok(Math.abs(c.cambioPct({ ultimo: 1.1, cierreAnterior: 1, ultimoFecha: hace(1) }) - 0.1) < 1e-9);
  assert.equal(c.cambioPct({ ultimo: 1.1, cierreAnterior: 1, ultimoFecha: hace(30) }), null); assert.equal(c.cambioPct({ ultimo: 1 }), null);
  assert.equal(c.esMensual('2027-01-15'), true); assert.equal(c.esMensual('2027-01-08'), false);
  assert.equal(c.esMensual('2027-06-17', ['2027-06-17', '2027-09-17']), true, 'viernes feriado'); assert.equal(c.esMensual('2026-12-17', ['2026-12-17', '2026-12-18']), false);
  const item = { simbolo: 'A', bid: 2, ask: 2.2, ultimo: 2.1, fechaDato: '2026-11-24T20:00:00Z', griegas: { delta: 0.5 } };
  const q = { contratoExternoId: 'A', bid: 0.1, ask: 9, ultimo: 2.4, ultimoFecha: 'x', fechaDato: '2026-11-25T13:00:00Z', griegas: { delta: 0.1 } };
  assert.deepEqual(c.fusionarCotizaciones([item], [q])[0], { ...item, ultimo: 2.4, ultimoFecha: 'x' }, 'fuera de horario conserva la sesión');
  const viva = c.fusionarCotizaciones([item], [{ ...q, bid: 2.3, ask: 2.5, fechaDato: '2026-11-25T15:00:00Z' }])[0];
  assert.deepEqual([viva.bid, viva.ask, viva.griegas.delta], [2.3, 2.5, 0.1]); assert.equal(c.fusionarCotizaciones([item], [])[0], item);
});

test('cadena del servidor: todos los vencimientos, uno bajo demanda con sus strikes cercanos y caché', async () => {
  const { memoryFactory } = require('./helpers/memory.cjs');
  const { crear } = require('../dist/api/v1/services/registros');
  const { createCadena } = require('../dist/api/v1/services/cadena.service');
  const factory = memoryFactory(), ctx = { userId: 'u', database: 'mongodb' }, pedidos = [], lejos = '2029-01-19';
  const strikes = Array.from({ length: 80 }, (_, i) => 61 + i);
  const alpaca = { cotizacion: async () => ({ ultimo: 100 }),
    contratos: async f => { pedidos.push(f); return f.vencimientoDesde === f.vencimientoHasta ? strikes.map(k => ({ contratoExternoId: 'TEST290119C' + String(k * 1000).padStart(8, '0'), tipo: 'call', strike: k, vencimiento: lejos })) : ['2027-01-15', lejos, '2027-01-15'].map(v => ({ vencimiento: v })); },
    snapshotsOpciones: async () => [] };
  await crear('empresas', ctx, { simbolo: 'TEST', nombre: 'Test', mercado: 'NASDAQ', activo: true }, factory);
  const c = createCadena({ integraciones: { alpaca, sec: {} }, factory, ahora: () => Date.parse('2026-11-25T15:00:00Z') });
  assert.deepEqual((await c.vencimientos('TEST')).items, ['2027-01-15', lejos]); await c.vencimientos('TEST');
  assert.equal(pedidos.length, 1, 'la lista se guarda unos minutos'); assert.deepEqual([pedidos[0].strikeMin, pedidos[0].strikeMax, pedidos[0].tipo], [85, 115, 'call']);
  const d = await c.traer(ctx, 'TEST', lejos);
  assert.equal(d.vencimiento, lejos); assert.equal(d.items.length, 60); assert.ok(d.items.every(i => i.contratoId && i.strike >= 70 && i.strike <= 130));
  await c.traer(ctx, 'TEST', lejos); assert.equal(pedidos.length, 2, 'no repite la descarga en segundos');
  await assert.rejects(c.traer(ctx, 'TEST', '2026-11-20'), /ya pasó/); await assert.rejects(c.traer(ctx, 'OTRA', lejos), /no registrada/);
});
