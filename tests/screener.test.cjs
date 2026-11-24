// Screener y estado de mercado por HTTP con repositorio en memoria y Alpaca simulado (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const { createCola } = require('../dist/jobs/cola');
const { puntuarSimbolo, parsearOcc, createScreener } = require('../dist/api/v1/services/screener.service');
const { createMercadoEstado, indicesReferencia } = require('../dist/api/v1/services/mercado-estado.service');
const { diaNY } = require('../dist/api/v1/services/mercado-reloj.service');
const { crear } = require('../dist/api/v1/services/registros');
const { createAlpacaClient, createLimitador } = require('../dist/integrations/alpaca.client');
const prefix = require('../dist/config/config').default.API_URL;

const DIA = 86400000, BASE = Date.UTC(2025, 0, 2);
// forma: 'sube' (tendencia alcista), 'baja', 'lateral'
function velas(forma, n = 260) {
  return Array.from({ length: n }, (_, i) => {
    const c = forma === 'sube' ? 100 + i * 0.5 + Math.sin(i / 3) * 2 : forma === 'baja' ? 300 - i * 0.5 + Math.sin(i / 3) * 2 : 100 + Math.sin(i / 4) * 1.5;
    return { fecha: new Date(BASE + i * DIA).toISOString(), apertura: c - 0.3, maximo: c + 1, minimo: c - 1, cierre: c, volumen: 1e6 + i * 1000 };
  });
}
const FORMAS = { UPAA: 'sube', UPBB: 'sube', DOWN: 'baja', FLAT: 'lateral' };

function fakeIntegraciones() {
  const llamadas = { velasLote: [], cotizacionesLote: [], filtros: [], reloj: 0 };
  return {
    llamadas,
    alpaca: {
      feed: 'iex',
      buscarActivo: async simbolo => ({ simbolo, nombre: 'Fondo ' + simbolo }),
      velasLote: async simbolos => { llamadas.velasLote.push(simbolos); return Object.fromEntries(simbolos.filter(s => FORMAS[s]).map(s => [s, velas(FORMAS[s])])); },
      cotizacionesLote: async (simbolos, { feed } = {}) => { llamadas.cotizacionesLote.push(simbolos); return Object.fromEntries(simbolos.map(s => [s, { ultimo: feed ? 150 : 153, cierre: 150, cierreAnterior: 145, volumen: 1e6, fechaSesion: new Date(Date.now() - DIA).toISOString(), fechaDato: new Date().toISOString() }])); },
      contratos: async o => [{ contratoExternoId: 'c1', tipo: 'call', strike: 100, vencimiento: o.vencimientoDesde }],
      snapshotsOpciones: async (_simbolo, filtro) => { llamadas.filtros.push(filtro); return []; },
      reloj: async () => { llamadas.reloj++; return { abierto: true, proximaApertura: '2026-11-20T14:30:00.000Z', proximoCierre: '2026-11-19T21:00:00.000Z' }; },
    },
  };
}

async function arrancar(integraciones) {
  const factory = memoryFactory(), cola = createCola();
  const userId = randomUUID(), password = 'Test-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 's@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory, auth: createSessionService(factory, async () => [user]), integraciones, cola, quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  let token;
  const call = async (method, path, body, status = 200) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json(); assert.equal(r.status, status, method + ' ' + path + ' → ' + JSON.stringify(j)); return j.data;
  };
  token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: 'mongodb' })).token;
  return { call, server, factory, userId };
}

test('puntuarSimbolo: la tendencia alcista favorece LONG_CALL y la bajista LONG_PUT', () => {
  const ref = new Date(BASE + 300 * DIA).toISOString();
  const sube = puntuarSimbolo({ simbolo: 'X', velas: velas('sube'), fechaReferencia: ref });
  const baja = puntuarSimbolo({ simbolo: 'X', velas: velas('baja'), fechaReferencia: ref });
  assert.ok(sube.puntajes.LONG_CALL > sube.puntajes.LONG_PUT, JSON.stringify(sube.puntajes));
  assert.ok(baja.puntajes.LONG_PUT > baja.puntajes.LONG_CALL, JSON.stringify(baja.puntajes));
  for (const e of ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']) {
    assert.ok(sube.puntajes[e] >= 0 && sube.puntajes[e] <= 100);
    assert.ok(sube.factores[e].length >= 3 && sube.factores[e].every(f => f.nombre && f.puntaje >= 0 && f.puntaje <= 100));
    assert.ok(sube.resumenes[e].length > 0);
  }
  const sin = puntuarSimbolo({ simbolo: 'X', velas: velas('sube', 5), fechaReferencia: ref });
  assert.equal(sin.puntajes.LONG_CALL, null);
});

test('parsearOcc: símbolo OCC válido o null', () => {
  assert.deepEqual(parsearOcc('AAPL251219C00200000'), { tipo: 'call', strike: 200, vencimiento: '2025-12-19' });
  assert.equal(parsearOcc('basura'), null);
});

test('Screener: los empates de puntaje se resuelven por el factor principal y no por orden alfabético', async () => {
  const fila = (simbolo, neutralidad) => ({ _id: simbolo, simbolo, puntajes: { IRON_CONDOR: 100 }, factores: { IRON_CONDOR: [{ nombre: 'Neutralidad media de las señales', valor: neutralidad / 100, puntaje: neutralidad }] } });
  const filas = [fila('AAA', 86), fila('ZZZ', 98), fila('MMM', 90), fila('BBB', 86)];
  const ctx = { userId: 'u', database: 'mongodb' }, factory = memoryFactory();
  for (const f of filas) await factory('screener', ctx).create(f);
  const { items } = await createScreener({ factory }).ranking(ctx, { estrategia: 'IRON_CONDOR' });
  assert.deepEqual(items.map(i => i.simbolo), ['ZZZ', 'MMM', 'AAA', 'BBB']);
});

test('Screener: el ranking lee lo guardado sin llamar al proveedor y la sincronización manual ya no existe', async () => {
  const integ = fakeIntegraciones();
  const { call, server, factory, userId } = await arrancar(integ);
  try {
    const vacio = await call('GET', '/screener/ranking?estrategia=LONG_CALL');
    assert.deepEqual(vacio.items, []); assert.equal(vacio.universo.total, 0); assert.equal(vacio.universo.actualizadoEn, null);
    const repo = factory('screener', { userId, database: 'mongodb' });
    for (const [simbolo, forma] of Object.entries(FORMAS)) {
      const p = puntuarSimbolo({ simbolo, velas: velas(forma), fechaReferencia: new Date(BASE + 300 * DIA).toISOString() });
      await repo.create({ _id: simbolo, simbolo, nombre: simbolo + ' Corp', precio: 150, cambioPct: 0.03, puntajes: p.puntajes, factores: p.factores, resumenes: p.resumenes, actualizadoEn: new Date() });
    }
    const antes = JSON.stringify(integ.llamadas);
    const calls = await call('GET', '/screener/ranking?estrategia=LONG_CALL&limite=3');
    assert.equal(calls.items.length, 3);
    assert.ok(['UPAA', 'UPBB'].includes(calls.items[0].simbolo));
    assert.equal(calls.items[0].precio, 150);
    assert.ok(calls.items[0].puntaje >= calls.items[1].puntaje && calls.items[1].puntaje >= calls.items[2].puntaje);
    assert.ok(calls.items[0].factores.length >= 3 && calls.items[0].resumen && calls.items[0].actualizadoEn);
    assert.equal(calls.universo.total, 4); assert.ok(calls.universo.actualizadoEn);
    assert.equal((await call('GET', '/screener/ranking?estrategia=LONG_PUT&limite=1')).items[0].simbolo, 'DOWN');
    const todas = await call('GET', '/screener/ranking?limite=2');
    assert.deepEqual(Object.keys(todas.estrategias).sort(), ['IRON_CONDOR', 'LONG_CALL', 'LONG_PUT']);
    assert.equal(todas.estrategias.IRON_CONDOR[0].simbolo, 'FLAT');
    assert.equal(JSON.stringify(integ.llamadas), antes, 'el ranking no llama al proveedor');
    await call('GET', '/screener/ranking?estrategia=OTRA', undefined, 400);
    await call('GET', '/screener/ranking?limite=0', undefined, 400);
    await call('POST', '/screener/universo/sincronizaciones', {}, 404);
    await call('POST', '/sincronizaciones/ejecuciones', { recurso: 'universo', simbolos: ['UPAA'] }, 400);
  } finally { server.close(); }
});

test('Mercado: /mercado/estado da nombre, precio y variación con la misma combinación que el mapa, y usa caché', async () => {
  const integ = fakeIntegraciones();
  const { call, server } = await arrancar(integ);
  try {
    const e = await call('GET', '/mercado/estado');
    assert.equal(e.abierto, true); assert.ok(e.proximaApertura && e.proximoCierre && e.fuente);
    assert.deepEqual(e.indices.map(i => i.simbolo), indicesReferencia());
    assert.equal(e.indices[0].nombre, 'Fondo ' + e.indices[0].simbolo, 'el nombre viene de Alpaca');
    // Primeros minutos: el consolidado muestra la sesión de ayer, así que la variación se mide contra SU cierre (150), no contra 145.
    assert.deepEqual([e.indices[0].precio, e.indices[0].cambioPct], [153, 0.02]);
    await call('GET', '/mercado/estado');
    assert.equal(integ.llamadas.reloj, 1, 'segunda lectura desde caché');
  } finally { server.close(); }
});

test('Índices de referencia: se configuran con INDICES_REFERENCIA; sin nombre de Alpaca se usa el símbolo', async () => {
  assert.equal(indicesReferencia({}).length, 4);
  assert.deepEqual(indicesReferencia({ INDICES_REFERENCIA: ' aaa, BBB,aaa,m@l ' }), ['AAA', 'BBB']);
  const integ = fakeIntegraciones();
  integ.alpaca.buscarActivo = async () => { throw new Error('sin red'); };
  const e = await createMercadoEstado({ integraciones: integ, env: { INDICES_REFERENCIA: 'AAA' } })();
  assert.deepEqual(e.indices.map(i => [i.simbolo, i.nombre]), [['AAA', 'AAA']]);
});

test('Opciones: el resumen excluye vencidos, elige el más cercano vigente e informa la fecha del dato; la cadena filtra el vencimiento', async () => {
  const integ = fakeIntegraciones();
  const { call, server, factory, userId } = await arrancar(integ);
  try {
    const ctx = { userId, database: 'mongodb' }, dia = n => diaNY(Date.now() + n * DIA);
    const empresa = await crear('empresas', ctx, { simbolo: 'UPAA', nombre: 'Up', mercado: 'NYSE', activo: true }, factory);
    const contrato = venc => crear('contratos', ctx, { proveedor: 'alpaca', contratoExternoId: 'c' + venc, empresaId: empresa._id, simbolo: 'c' + venc, tipo: 'call', strike: 100, vencimiento: new Date(venc), multiplicador: 100, activo: true }, factory);
    await contrato(dia(-3));
    const hoy = await contrato(dia(0));
    await contrato(dia(20));
    const fechaDato = new Date(Date.now() - 60000).toISOString();
    await crear('datos-mercado', ctx, { empresaId: empresa._id, contratoId: hoy._id, tipo: 'snapshot_opcion', bid: 1, fuente: { proveedor: 'alpaca', fechaDato } }, factory);
    const r = await call('GET', '/mercado/opciones/resumen/UPAA');
    assert.deepEqual(r.vencimientos, [dia(0), dia(20)]);
    assert.equal(r.vencimiento, dia(0)); assert.equal(r.total, 1); assert.equal(r.fechaDato, fechaDato);
    const otro = await call('GET', '/mercado/opciones/resumen/UPAA?vencimiento=' + dia(20));
    assert.equal(otro.total, 1); assert.equal(otro.fechaDato, null);
    assert.equal((await call('GET', '/mercado/opciones/resumen/UPAA?vencimiento=' + dia(-3))).total, 0);

    await call('GET', '/mercado/opciones/cadena/UPAA?vencimiento=' + dia(20) + '&tipo=call');
    assert.deepEqual(integ.llamadas.filtros.at(-1), { vencimientoDesde: dia(20), vencimientoHasta: dia(20), tipo: 'call' });
    await call('GET', '/mercado/opciones/cadena/UPAA');
    assert.deepEqual(integ.llamadas.filtros.at(-1), { vencimientoDesde: dia(0), vencimientoHasta: dia(60) });
  } finally { server.close(); }
});

test('Límite de Alpaca: ráfaga inicial, nunca más de 180 por minuto y las operaciones pasan primero', async () => {
  let t = 0;
  const reloj = async ms => { await new Promise(setImmediate); t += ms; }; // avanza el reloj cuando ya salieron las llamadas con ficha
  const turno = createLimitador({ ahora: () => t, esperar: reloj });
  const horas = [];
  await Promise.all(Array.from({ length: 400 }, () => turno(false).then(() => horas.push(t))));
  assert.equal(horas[29], 0, 'las primeras 30 salen sin espera');
  const maximo = Math.max(...horas.map(h => horas.filter(x => x >= h && x < h + 60000).length));
  assert.ok(maximo <= 180, 'en un minuto: ' + maximo);

  const orden = [], lento = createLimitador({ rafaga: 1, ahora: () => t, esperar: reloj });
  await Promise.all([...['a', 'b', 'c'].map(n => lento(false).then(() => orden.push(n))), lento(true).then(() => orden.push('orden'))]);
  assert.deepEqual(orden, ['a', 'orden', 'b', 'c']);
});

test('Cliente Alpaca: velasLote, cotizacionesLote y reloj usan endpoints multi-símbolo', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    const u = new URL(url);
    let cuerpo = {};
    if (u.pathname === '/v2/stocks/bars') cuerpo = { bars: { AAA: [{ t: '2026-01-02T05:00:00Z', o: 1, h: 2, l: 1, c: 2, v: 10 }], BBB: [{ t: '2026-01-02T05:00:00Z', o: 1, h: 2, l: 1, c: 2, v: 10 }] }, next_page_token: u.searchParams.get('page_token') ? null : 'p2' };
    else if (u.pathname === '/v2/stocks/snapshots') cuerpo = { AAA: { latestTrade: { p: 5 }, prevDailyBar: { c: 4 }, dailyBar: { c: 5, v: 9 } }, BBB: null };
    else if (u.pathname === '/v2/clock') cuerpo = { is_open: false, next_open: 'a', next_close: 'b', timestamp: 't' };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) };
  };
  const c = createAlpacaClient({ keyId: 'k', secretKey: 's', fetch, intervaloMs: 0 });
  const v = await c.velasLote(['aaa', 'bbb']);
  assert.equal(v.AAA.length, 2); assert.equal(v.BBB.length, 2); // 2 páginas, agrupadas por símbolo
  assert.match(urls[0], /symbols=AAA%2CBBB/);
  const q = await c.cotizacionesLote(['AAA', 'BBB']);
  assert.equal(q.AAA.ultimo, 5); assert.equal(q.AAA.cierreAnterior, 4); assert.equal(q.BBB, undefined);
  assert.deepEqual(await c.reloj(), { abierto: false, proximaApertura: 'a', proximoCierre: 'b', marcaTiempo: 't' });
});
