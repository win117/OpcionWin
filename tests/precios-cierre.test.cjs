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
