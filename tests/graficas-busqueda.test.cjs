// Soportes y resistencias, búsqueda tolerante a errores e histórico del consolidado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createBusquedaActivos, distancia } = require('../dist/api/v1/services/activos.service');

const serie = cierres => cierres.map((c, i) => ({ time: 1.7e9 + i * 86400, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
const onda = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test('niveles: rango repetido → soporte y resistencia con sus visitas', async () => {
  const { soportesResistencias } = await import('../web/src/utils/senales.js');
  const n = soportesResistencias(serie(onda(120, i => 100 + 10 * Math.sin(i / 6))));
  const r = n.find(x => x.tipo === 'resistencia'), s = n.find(x => x.tipo === 'soporte');
  assert.ok(Math.abs(r.precio - 110.5) < 0.6 && Math.abs(s.precio - 89.5) < 0.6, JSON.stringify(n));
  assert.ok(r.toques >= 3 && r.toques <= 4, 'una visita por cresta, no una por vela');
});

test('niveles: el máximo y el mínimo del periodo aparecen aunque se tocaran una vez', async () => {
  const { soportesResistencias } = await import('../web/src/utils/senales.js');
  // Sube sin repetir niveles, marca un máximo de 160 y retrocede a 150.
  const v = serie([...onda(100, i => 60 + i), ...onda(11, i => 160 - i)]);
  const n = soportesResistencias(v), r = n.find(x => x.tipo === 'resistencia');
  assert.equal(r.precio, 160.5); assert.equal(r.extremo, true); assert.equal(r.toques, 1);
  assert.equal(n.filter(x => x.tipo === 'soporte').at(-1).precio, 59.5);
  assert.ok(n.every((x, i) => !i || n[i - 1].precio >= x.precio), 'de mayor a menor');
  for (const x of n) assert.equal(x.tipo, x.precio >= 150 ? 'resistencia' : 'soporte');
  assert.deepEqual(soportesResistencias(v.slice(0, 5)), []);
});

test('niveles: en máximos no se inventa resistencia y siempre está el nivel más cercano', async () => {
  const { soportesResistencias } = await import('../web/src/utils/senales.js');
  const subida = soportesResistencias(serie(onda(60, i => 100 + i)));
  assert.ok(subida.filter(x => x.tipo === 'resistencia').every(x => x.precio > 159));
  // Soporte lejano muy tocado (80) y uno cercano con dos visitas (98).
  const c = [...onda(150, i => 90 + 10 * Math.sin(i / 5)), ...onda(60, i => 101 + 3 * Math.sin(i / 6)), 103];
  const cerca = soportesResistencias(serie(c)).filter(x => x.tipo === 'soporte')[0];
  assert.ok(cerca.precio > 95, 'el más cercano al precio: ' + cerca.precio);
});

test('búsqueda: nombre, errores de escritura y empresas grandes primero', async () => {
  const lista = [['ZTSL', 'T-Rex 2X Long Tesla Daily'], ['TSLA', 'Tesla, Inc. Common Stock'], ['GOOGL', 'Alphabet Inc. Class A'], ['GOOP', 'Google Yield Fund'], ['AAPL', 'Apple Inc.'], ['APLE', 'Apple Hospitality REIT'], ['KO', 'Coca-Cola Company'], ['COKE', 'Coca-Cola Consolidated'], ['NOPE', 'Tesla Sin Negociar']]
    .map(([simbolo, nombre]) => ({ simbolo, nombre, negociable: simbolo !== 'NOPE', opciones: true, mercado: 'X' }));
  const caps = { TSLA: 1e12, GOOGL: 2e12, AAPL: 5e12, KO: 3e11 };
  const b = createBusquedaActivos({ integraciones: { alpaca: { listarActivos: async () => lista } }, factory: memoryFactory(), universo: { capitalizacionDe: s => caps[s] ?? null } });
  const buscar = async q => (await b.buscar({ userId: 'u', database: 'mongodb' }, q, 5)).items.map(i => i.simbolo);
  assert.equal((await buscar('TESLA'))[0], 'TSLA'); assert.ok(!(await buscar('tesla')).includes('NOPE'));
  assert.equal((await buscar('google'))[0], 'GOOGL', 'mal escrito y de nombre distinto');
  assert.equal((await buscar('aplle'))[0], 'AAPL'); assert.equal((await buscar('coca'))[0], 'KO');
  assert.equal((await buscar('APLE'))[0], 'APLE', 'el símbolo exacto siempre va primero');
  assert.deepEqual(await buscar('qwxyz'), []);
  assert.equal(distancia('google', 'googl', 1), 1); assert.equal(distancia('abc', 'xyz', 1), 2); assert.equal(distancia('a', 'abcd', 2), 3);
});

test('históricos: consolidado retrasado 16 min, con respaldo IEX si el plan no lo permite', async () => {
  const { createSincronizador } = require('../dist/api/v1/services/sincronizacion.service');
  const { createAlpacaClient } = require('../dist/integrations/alpaca.client');
  const urls = [];
  const fetch = async u => { urls.push(new URL(u)); return new Response(JSON.stringify({ bars: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const a = createAlpacaClient({ keyId: 'PKTEST', secretKey: 's', feed: 'iex', fetch, esperar: async () => {} });
  await a.velas('TEST', { desde: '2016-01-01', feed: 'sip' }); await a.velas('TEST', { desde: '2016-01-01' });
  assert.deepEqual(urls.map(u => u.searchParams.get('feed')), ['sip', 'iex']);

  const ctx = { userId: 'u', database: 'mongodb' };
  const correr = async sip => {
    const factory = memoryFactory(), pedidos = [];
    await factory('empresas', ctx).create({ _id: 'e1', usuarioId: 'u', simbolo: 'TEST', nombre: 'Test', mercado: 'X', activa: true });
    const alpaca = { feed: 'iex', velas: async (s, o) => {
      pedidos.push(o);
      if (o.feed === 'sip' && sip) throw Object.assign(new Error('x'), { name: 'IntegrationError', codigo: sip, mensaje: sip });
      return [{ fecha: '2026-11-20T05:00:00Z', apertura: 1, maximo: 2, minimo: 1, cierre: 1.5, volumen: 10 }];
    } };
    let error = null;
    const r = await createSincronizador({ integraciones: { alpaca, sec: {} }, factory }).ejecutar(ctx, { recurso: 'historicos', simbolos: ['TEST'] }).catch(e => { error = e; });
    return { pedidos, r, error, filas: await factory('datos-mercado', ctx).list({}) };
  };
  const bien = await correr(null);
  assert.deepEqual(bien.pedidos.map(p => p.feed), ['sip']); assert.ok(Date.now() - Date.parse(bien.pedidos[0].hasta) >= 16 * 60000 - 1000);
  assert.equal(bien.filas[0].document.fuente.feed, 'sip');
  const sinPlan = await correr('PROVEEDOR');
  assert.deepEqual(sinPlan.pedidos.map(p => p.feed), ['sip', 'iex']); assert.equal(sinPlan.filas[0].document.fuente.feed, 'iex');
  assert.deepEqual((await correr('LIMITE')).pedidos.map(p => p.feed), ['sip'], 'el límite no se disfraza con datos de otra fuente');
});
