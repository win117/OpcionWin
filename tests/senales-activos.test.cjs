// Selección de señales por core, catálogo, pesos en selección, búsqueda de activos y resumen de opciones guardadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const { createCola } = require('../dist/jobs/cola');
const { createBusquedaActivos } = require('../dist/api/v1/services/activos.service');
const { idDeterminista } = require('../dist/api/v1/services/registros');
const { createAlpacaClient } = require('../dist/integrations/alpaca.client');
const util = require('../dist/cores/util');
const tecnico = require('../dist/cores/tecnico.core');
const indicadores = require('../dist/cores/indicadores.core');
const prefix = require('../dist/config/config').default.API_URL;

const DIA = 86400000, BASE = Date.UTC(2025, 0, 2);
const velas = (n = 260) => Array.from({ length: n }, (_, i) => { const c = 100 + i * 0.5 + Math.sin(i / 3) * 2; return { fecha: new Date(BASE + i * DIA).toISOString(), apertura: c - 0.5, maximo: c + 1.5, minimo: c - 1.5, cierre: c, volumen: 1e6 + i * 1000 }; });
const REF = new Date(BASE + 260 * DIA).toISOString();

test('filtrarSenales: selección propia filtra; vacía o ajena usa todas', () => {
  const lista = [{ nombre: 'a', valor: 1, peso: 1 }, { nombre: 'b', valor: -1, peso: 1 }];
  const r = util.filtrarSenales(lista, { indicadores: ['b', 'zzz'] });
  assert.deepEqual(r.senales.map(s => s.nombre), ['b']);
  assert.match(r.motivo, /Señales usadas: b \(selección del usuario\)/);
  assert.equal(util.filtrarSenales(lista, { indicadores: [] }).senales.length, 2);
  assert.equal(util.filtrarSenales(lista, { indicadores: ['rsi_14'] }).motivo, null);
  assert.equal(util.filtrarSenales(lista, undefined).senales.length, 2);
});

test('cores: técnico e indicadores honran parametros.indicadores', () => {
  assert.deepEqual(tecnico.SENALES.map(s => s.nombre), ['precio_vs_sma50', 'precio_vs_sma200', 'cruce_sma50_200', 'pendiente_20', 'posicion_rango_52s', 'volumen_relativo_20']);
  const todas = tecnico.evaluar({ velas: velas(), fechaReferencia: REF });
  const sel = tecnico.evaluar({ velas: velas(), fechaReferencia: REF, parametros: { indicadores: ['precio_vs_sma50', 'rsi_14'] } });
  assert.ok(sel.motivos.includes('Señales usadas: precio_vs_sma50 (selección del usuario).'));
  assert.ok(!todas.motivos.some(m => m.startsWith('Señales usadas')));
  assert.notEqual(sel.sesgo, todas.sesgo);
  assert.ok(sel.metricas.some(m => m.nombre === 'precio_vs_sma200'), 'las métricas se reportan igualmente');
  const ajena = tecnico.evaluar({ velas: velas(), fechaReferencia: REF, parametros: { indicadores: ['rsi_14'] } });
  assert.equal(ajena.sesgo, todas.sesgo);
  const pocas = velas(30);
  assert.ok(tecnico.evaluar({ velas: pocas, fechaReferencia: REF, parametros: { indicadores: ['pendiente_20'] } }).cobertura > tecnico.evaluar({ velas: pocas, fechaReferencia: REF }).cobertura);
  const ind = indicadores.evaluar({ velas: velas(), fechaReferencia: REF, parametros: { indicadores: ['rsi_14'] } });
  assert.ok(ind.motivos.includes('Señales usadas: rsi_14 (selección del usuario).'));
});

test('Alpaca: listarActivos pide /v2/assets y normaliza', async () => {
  const llamadas = [];
  const fetch = async url => {
    llamadas.push(new URL(url));
    return new Response(JSON.stringify([
      { id: '1', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', tradable: true, attributes: ['options_enabled', 'fractional_eh_enabled'] },
      { id: '2', symbol: 'XYZ', name: 'Xyz Corp', exchange: 'NYSE', tradable: false }]), { status: 200 });
  };
  const a = createAlpacaClient({ keyId: 'PKTESTKEYID1234567', secretKey: 'supersecretvalue-abcdef', fetch, esperar: async () => {}, intervaloMs: 0 });
  const lista = await a.listarActivos();
  assert.equal(llamadas[0].pathname, '/v2/assets');
  assert.equal(llamadas[0].searchParams.get('status'), 'active');
  assert.equal(llamadas[0].searchParams.get('asset_class'), 'us_equity');
  assert.deepEqual(lista, [{ simbolo: 'AAPL', nombre: 'Apple Inc.', mercado: 'NASDAQ', negociable: true, opciones: true },
    { simbolo: 'XYZ', nombre: 'Xyz Corp', mercado: 'NYSE', negociable: false, opciones: false }]);
  await assert.rejects(createAlpacaClient({ fetch }).listarActivos(), e => e.codigo === 'SIN_CREDENCIALES');
});

test('búsqueda de activos: ranking, caché 12 h, registrada y validación', async () => {
  const factory = memoryFactory(), ctx = { database: 'mongodb', userId: 'u1' };
  let llamadas = 0, ahora = 1000;
  const lista = [
    { simbolo: 'MSFT', nombre: 'Microsoft Corp', mercado: 'NASDAQ', negociable: true, opciones: true },
    { simbolo: 'AAPL', nombre: 'Apple Inc.', mercado: 'NASDAQ', negociable: true, opciones: true },
    { simbolo: 'APLE', nombre: 'Apple Hospitality', mercado: 'NYSE', negociable: true, opciones: false },
    { simbolo: 'AP', nombre: 'Ampco', mercado: 'NYSE', negociable: true, opciones: false },
    { simbolo: 'APX', nombre: 'No negociable', mercado: 'NYSE', negociable: false, opciones: false },
    { simbolo: 'PINE', nombre: 'Pineapple Energy', mercado: 'NASDAQ', negociable: true, opciones: false },
  ];
  const integraciones = { alpaca: { listarActivos: async () => { llamadas++; return lista; } } };
  const b = createBusquedaActivos({ integraciones, factory, ahora: () => ahora });
  await factory('empresas', ctx).create({ _id: 'e1', simbolo: 'AAPL', nombre: 'Apple Inc.' });
  const r = await b.buscar(ctx, 'ap');
  assert.deepEqual(r.items.map(i => i.simbolo), ['AP', 'APLE', 'AAPL', 'PINE']);
  assert.equal(r.total, 4);
  const aapl = r.items.find(i => i.simbolo === 'AAPL');
  assert.equal(aapl.registrada, true); assert.equal(aapl.empresaId, 'e1'); assert.equal(aapl.opciones, true);
  assert.equal(r.items[0].registrada, false); assert.ok(!('empresaId' in r.items[0]));
  assert.deepEqual((await b.buscar(ctx, 'aapl', 1)).items.map(i => i.simbolo), ['AAPL']);
  assert.equal(llamadas, 1, 'caché vigente');
  ahora += 12 * 3600 * 1000 + 1;
  await b.buscar(ctx, 'ap');
  assert.equal(llamadas, 2, 'caché expirada tras 12 h');
  await assert.rejects(b.buscar(ctx, ''), e => e.output.statusCode === 400);
  await assert.rejects(b.buscar(ctx, 'x'.repeat(21)), e => e.output.statusCode === 400);
  await assert.rejects(b.buscar(ctx, 'ap', 51), e => e.output.statusCode === 400);
});

function fake() {
  const venc = new Date(Date.now() + 30 * DIA).toISOString().slice(0, 10);
  const occ = 'TEST' + venc.slice(2).replace(/-/g, '') + 'C00120000';
  return { occ, venc,
    estado: () => ({ alpaca: { configurado: true }, sec: { configurado: true }, webull: { configurado: false } }),
    alpaca: { feed: 'iex',
      listarActivos: async () => [{ simbolo: 'TEST', nombre: 'Test Corp', mercado: 'NASDAQ', negociable: true, opciones: true }],
      buscarActivo: async s => ({ simbolo: s, nombre: 'Test Corp', mercado: 'NASDAQ', activo: true }),
      velas: async () => velas(), cotizacion: async () => ({ bid: 229, ask: 229.2, ultimo: 229.1, fechaDato: new Date().toISOString(), feed: 'iex' }),
      contratos: async () => [
        { contratoExternoId: occ, simbolo: occ, tipo: 'put', strike: 120, vencimiento: venc, multiplicador: 100 },
        { contratoExternoId: occ + 'x', simbolo: occ + 'x', tipo: 'call', strike: 120, vencimiento: venc, multiplicador: 100 },
        { contratoExternoId: occ + 'y', simbolo: occ + 'y', tipo: 'call', strike: 110, vencimiento: venc, multiplicador: 100 }],
      snapshotsOpciones: async () => [occ, occ + 'x', occ + 'y'].map((c, i) => ({ contratoExternoId: c, bid: 2 + i, ask: 2.2 + i, ultimo: 2.1 + i, volatilidadImplicita: 0.3, griegas: { delta: 0.5, gamma: 0.03, theta: -0.05, vega: 0.12, rho: 0.02 }, fechaDato: new Date().toISOString() })),
      noticias: async () => [], posiciones: async () => [] },
    sec: {} };
}

test('HTTP: catálogo de cores, búsqueda, resumen de opciones y pesos en selección', async () => {
  const factory = memoryFactory(), cola = createCola(), integraciones = fake();
  const userId = randomUUID(), password = 'Test-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 't@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory, auth: createSessionService(factory, async () => [user]), integraciones, cola, quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  let token;
  const call = async (method, path, body, status = 200) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json(); assert.equal(r.status, status, method + ' ' + path + ' → ' + JSON.stringify(j)); return j.data;
  };
  try {
    await call('GET', '/cores/catalogo', undefined, 401);
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: 'mongodb' })).token;
    const cat = await call('GET', '/cores/catalogo');
    assert.deepEqual(cat.items.map(i => i.core), ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias']);
    const t = cat.items[0];
    assert.equal(t.version, 'tecnico@1.1.0'); assert.deepEqual(t.requiere, ['velas']);
    assert.equal(t.senales.length, 6); assert.ok(t.senales.every(s => s.nombre && s.etiqueta && s.descripcion && s.pesoBase > 0));
    assert.deepEqual(cat.items[4].senales.map(s => s.nombre), ['sentimiento_promedio']);
    await call('GET', '/cores/tecnico/evaluaciones');

    await call('GET', '/activos/busqueda', undefined, 400);
    await call('GET', '/activos/busqueda?q=te&limit=0', undefined, 400);
    let b = await call('GET', '/activos/busqueda?q=test');
    assert.equal(b.total, 1); assert.equal(b.items[0].registrada, false);
    await call('GET', '/mercado/opciones/resumen/TEST', undefined, 404);

    for (const recurso of ['empresas', 'historicos', 'contratos', 'cotizaciones']) {
      const s = await call('POST', '/sincronizaciones/ejecuciones', { recurso, simbolos: ['TEST'] }, 202);
      await cola.vaciar(); assert.equal((await call('GET', '/sincronizaciones/' + s._id)).estado, 'completada', recurso);
    }
    const empresa = (await call('GET', '/empresas')).items[0];
    b = await call('GET', '/activos/busqueda?q=TEST');
    assert.equal(b.items[0].registrada, true); assert.equal(b.items[0].empresaId, empresa._id);

    const r = await call('GET', '/mercado/opciones/resumen/test');
    assert.deepEqual(r.empresa, { _id: empresa._id, simbolo: 'TEST', nombre: 'Test Corp' });
    assert.equal(r.precioSubyacente, 229.1);
    assert.deepEqual(r.vencimientos, [integraciones.venc]); assert.equal(r.vencimiento, integraciones.venc);
    assert.equal(r.total, 3);
    assert.deepEqual(r.items.map(i => [i.strike, i.tipo]), [[110, 'call'], [120, 'call'], [120, 'put']]);
    const it = r.items[2];
    assert.equal(it.contratoId, idDeterminista(userId, 'contrato', 'alpaca', integraciones.occ));
    assert.equal(it.simbolo, integraciones.occ); assert.equal(it.bid, 2); assert.equal(it.volatilidadImplicita, 0.3);
    assert.equal(it.griegas.delta, 0.5); assert.ok(it.fechaDato);
    assert.equal((await call('GET', '/mercado/opciones/resumen/TEST?vencimiento=2020-01-01')).total, 0);
    await call('GET', '/mercado/opciones/resumen/TEST?vencimiento=ayer', undefined, 400);

    const cat2 = await call('POST', '/estrategias/catalogo-base');
    const lc = cat2.find(e => e.codigo === 'LONG_CALL');
    const sel = async extra => {
      const s = await call('POST', '/selecciones/ejecuciones', { modo: 'estrategia', estrategiaId: lc._id, empresasCandidatas: [empresa._id], coresSeleccionados: ['tecnico', 'indicadores'], ...extra }, 202);
      await cola.vaciar(); return call('GET', '/selecciones/' + s._id);
    };
    const igual = await sel({});
    const pesada = await sel({ ponderaciones: [{ core: 'tecnico', peso: 5 }, { core: 'indicadores', peso: 0 }] });
    assert.equal(pesada.estado, 'completada', pesada.error);
    assert.deepEqual(pesada.ponderaciones.map(p => [p.core, p.peso]), [['tecnico', 5], ['indicadores', 0]]);
    const conf = await call('GET', '/confluencias/' + pesada.resultados[0].confluenciaId);
    assert.deepEqual(conf.ponderaciones.map(p => p.core).sort(), ['indicadores', 'tecnico']);
    assert.notEqual(pesada.resultados[0].puntaje, igual.resultados[0].puntaje);
    await call('POST', '/selecciones/ejecuciones', { modo: 'estrategia', estrategiaId: lc._id, coresSeleccionados: ['tecnico'], ponderaciones: [{ core: 'tecnico', peso: -1 }] }, 400);
    await call('POST', '/selecciones/ejecuciones', { modo: 'estrategia', estrategiaId: lc._id, coresSeleccionados: ['tecnico'], ponderaciones: [{ core: 'noticias', peso: 1 }] }, 400);

    const filtrada = await sel({ filtros: { indicadores: ['precio_vs_sma50'] } });
    assert.equal(filtrada.estado, 'completada', filtrada.error);
    const evs = (await call('GET', '/cores/tecnico/evaluaciones?limit=100')).items;
    assert.ok(evs.some(e => e.parametros?.indicadores?.includes('precio_vs_sma50') && e.motivos.includes('Señales usadas: precio_vs_sma50 (selección del usuario).')));
  } finally { server.close(); }
});

test('mercado/panorama: cambio vs cierre previo, caché y error por símbolo', async () => {
  const controller = require('../dist/api/v1/controllers/mercado.controller').default;
  let llamadas = 0;
  const hoy = new Date().toISOString().slice(0, 10);
  const alpaca = {
    feed: 'iex',
    velas: async s => { llamadas++; if (s === 'MALO') throw { mensaje: 'Sin velas' }; return [{ fecha: '2026-01-02T05:00:00Z', cierre: 100 }, { fecha: hoy + 'T05:00:00Z', cierre: 103 }]; },
    cotizacion: async () => ({ ultimo: 110, fechaDato: new Date().toISOString() }),
  };
  const c = controller(null, { alpaca });
  const run = query => new Promise((resolve, reject) => c.panorama({ query, context: {} }, { status() { return this; }, json: b => resolve(b.data) }, reject));
  const d = await run({ simbolos: 'SPYX,MALO' });
  assert.equal(d.items[0].ultimo, 110);
  assert.ok(Math.abs(d.items[0].cambioPct - 0.1) < 1e-9, 'la última vela es de hoy: compara contra la anterior');
  assert.equal(d.items[1].error, 'Sin velas');
  await run({ simbolos: 'SPYX' });
  assert.equal(llamadas, 2, 'SPYX se sirve desde caché');
  await assert.rejects(run({ simbolos: 'A,B,C,D,E,F,G,H,I' }), /hasta 8/);
});

test('sincronizar posiciones: abre, actualiza y marca cerrada la que el broker ya no reporta', async () => {
  const { createSincronizador } = require('../dist/api/v1/services/sincronizacion.service');
  const { crear, todos } = require('../dist/api/v1/services/registros');
  const factory = memoryFactory(), ctx = { database: 'mongodb', userId: 'u1' };
  const broker = await crear('brokers', ctx, { codigo: 'alpaca', nombre: 'Alpaca', activo: true, entornos: ['paper'] }, factory);
  const conexion = await crear('conexiones-broker', ctx, { brokerId: broker._id, alias: 'p', entorno: 'paper' }, factory);
  const empresa = await crear('empresas', ctx, { simbolo: 'AAPL', nombre: 'Apple', mercado: 'NASDAQ', activo: true }, factory);
  await crear('contratos', ctx, { proveedor: 'alpaca', contratoExternoId: 'AAPL261125C00350000', empresaId: empresa._id, simbolo: 'AAPL261125C00350000', tipo: 'call', strike: 350, vencimiento: new Date('2026-11-25'), multiplicador: 100, activo: true }, factory);
  let remotas = [{ posicionExternaId: 'a1', simbolo: 'AAPL261125C00350000', lado: 'long', cantidad: 1, precioPromedio: 6.65 }];
  const sync = createSincronizador({ integraciones: { alpaca: { posiciones: async () => remotas }, sec: {} }, factory });
  await sync.ejecutar(ctx, { recurso: 'posiciones', conexionId: conexion._id });
  let pos = await todos('posiciones', ctx, { conexionId: conexion._id }, factory);
  assert.equal(pos.length, 1); assert.equal(pos[0].estado, 'abierta'); assert.equal(pos[0].precioPromedio, 6.65);
  remotas = [];
  const r = await sync.ejecutar(ctx, { recurso: 'posiciones', conexionId: conexion._id });
  pos = await todos('posiciones', ctx, { conexionId: conexion._id }, factory);
  assert.equal(pos[0].estado, 'cerrada'); assert.equal(pos[0].cantidad, 1); assert.equal(r.procesados, 1);
});
