// Screener y estado de mercado por HTTP con repositorio en memoria y Alpaca simulado (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const { createCola } = require('../dist/jobs/cola');
const { puntuarSimbolo, parsearOcc } = require('../dist/api/v1/services/screener.service');
const { UNIVERSO_DEFECTO } = require('../dist/data/universo');
const { createAlpacaClient } = require('../dist/integrations/alpaca.client');
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
  const llamadas = { velasLote: [], cotizacionesLote: [], snapshotsOpciones: [], reloj: 0 };
  return {
    llamadas,
    alpaca: {
      feed: 'iex',
      listarActivos: async () => [{ simbolo: 'UPAA', nombre: 'Up A Corp' }],
      velasLote: async simbolos => { llamadas.velasLote.push(simbolos); return Object.fromEntries(simbolos.filter(s => FORMAS[s]).map(s => [s, velas(FORMAS[s])])); },
      cotizacionesLote: async simbolos => { llamadas.cotizacionesLote.push(simbolos); return Object.fromEntries(simbolos.map(s => [s, { ultimo: 150, cierre: 150, cierreAnterior: 145, volumen: 1e6, fechaDato: new Date().toISOString() }])); },
      snapshotsOpciones: async simbolo => {
        llamadas.snapshotsOpciones.push(simbolo);
        const v = new Date(Date.now() + 30 * DIA).toISOString().slice(2, 10).replace(/-/g, '');
        return [{ contratoExternoId: simbolo + v + 'C00150000', bid: 3, ask: 3.2, volatilidadImplicita: 0.3, griegas: {} }, { contratoExternoId: simbolo + v + 'P00150000', bid: 3, ask: 3.2, volatilidadImplicita: 0.32, griegas: {} }];
      },
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
  return { call, cola, server, factory };
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

test('parsearOcc y universo por defecto', () => {
  assert.deepEqual(parsearOcc('AAPL251219C00200000'), { tipo: 'call', strike: 200, vencimiento: '2025-12-19' });
  assert.equal(parsearOcc('basura'), null);
  assert.ok(UNIVERSO_DEFECTO.length >= 450 && new Set(UNIVERSO_DEFECTO).size === UNIVERSO_DEFECTO.length);
});

test('Screener: sincroniza por lotes, guarda y ranquea sin llamar al proveedor', async () => {
  const integ = fakeIntegraciones();
  const { call, cola, server } = await arrancar(integ);
  try {
    // Ranking vacío antes de sincronizar
    const vacio = await call('GET', '/screener/ranking?estrategia=LONG_CALL');
    assert.deepEqual(vacio.items, []); assert.equal(vacio.universo.total, 0); assert.equal(vacio.universo.actualizadoEn, null);

    await call('POST', '/screener/universo/sincronizaciones', { limite: 0 }, 400);
    await call('POST', '/screener/universo/sincronizaciones', { limite: 1001 }, 400);
    await call('POST', '/screener/universo/sincronizaciones', { simbolos: ['mal simbolo!'] }, 400);

    const t = await call('POST', '/screener/universo/sincronizaciones', { simbolos: ['upaa', 'UPBB', 'DOWN', 'FLAT', 'NODATA'] }, 202);
    assert.equal(t.estado, 'pendiente'); assert.equal(t.total, 5); assert.equal(t.procesados, 0);
    await cola.vaciar();
    const fin = await call('GET', '/screener/universo/sincronizaciones/' + t._id);
    assert.equal(fin.estado, 'completada', fin.error);
    assert.equal(fin.procesados, 5); assert.equal(fin.total, 5); assert.equal(fin.fallidos, 1);
    await call('GET', '/screener/universo/sincronizaciones/inexistente', undefined, 404);

    // Eficiencia: 5 símbolos → 1 solicitud de barras, 1 de snapshots, 4 de opciones (una por símbolo con datos)
    assert.equal(integ.llamadas.velasLote.length, 1);
    assert.equal(integ.llamadas.cotizacionesLote.length, 1);
    assert.equal(integ.llamadas.snapshotsOpciones.length, 4);

    const antes = JSON.stringify(integ.llamadas);
    const calls = await call('GET', '/screener/ranking?estrategia=LONG_CALL&limite=3');
    assert.equal(calls.items.length, 3);
    assert.ok(['UPAA', 'UPBB'].includes(calls.items[0].simbolo), calls.items.map(i => i.simbolo).join());
    assert.equal(calls.items[0].precio, 150);
    assert.ok(Math.abs(calls.items[0].cambioPct - (150 / 145 - 1)) < 1e-4);
    assert.ok(calls.items[0].puntaje >= calls.items[1].puntaje && calls.items[1].puntaje >= calls.items[2].puntaje);
    assert.ok(calls.items[0].factores.length >= 3 && calls.items[0].resumen && calls.items[0].actualizadoEn);
    assert.equal(calls.universo.total, 4); assert.ok(calls.universo.actualizadoEn);
    assert.equal(calls.items.find(i => i.simbolo === 'UPAA')?.nombre, 'Up A Corp');

    const puts = await call('GET', '/screener/ranking?estrategia=LONG_PUT&limite=1');
    assert.equal(puts.items[0].simbolo, 'DOWN');
    const todas = await call('GET', '/screener/ranking?limite=2');
    assert.deepEqual(Object.keys(todas.estrategias).sort(), ['IRON_CONDOR', 'LONG_CALL', 'LONG_PUT']);
    assert.ok(Object.values(todas.estrategias).every(l => l.length === 2));
    assert.equal(todas.estrategias.IRON_CONDOR[0].simbolo, 'FLAT');
    assert.equal(JSON.stringify(integ.llamadas), antes, 'el ranking no llama al proveedor');

    await call('GET', '/screener/ranking?estrategia=OTRA', undefined, 400);
    await call('GET', '/screener/ranking?limite=0', undefined, 400);

    // Refrescar reemplaza (no duplica) los registros
    await call('POST', '/screener/universo/sincronizaciones', { simbolos: ['UPAA', 'DOWN'], opciones: false }, 202); await cola.vaciar();
    assert.equal((await call('GET', '/screener/ranking?limite=1')).universo.total, 4);
    assert.equal(integ.llamadas.snapshotsOpciones.length, 4, 'opciones:false no consulta opciones');
  } finally { server.close(); }
});

test('Screener: error del proveedor deja el trabajo en fallida con mensaje seguro', async () => {
  const integ = fakeIntegraciones();
  integ.alpaca.velasLote = async () => { const e = new Error('x'); e.name = 'IntegrationError'; e.mensaje = 'Faltan credenciales de Alpaca.'; throw e; };
  const { call, cola, server } = await arrancar(integ);
  try {
    const t = await call('POST', '/screener/universo/sincronizaciones', { simbolos: ['UPAA'] }, 202); await cola.vaciar();
    const fin = await call('GET', '/screener/universo/sincronizaciones/' + t._id);
    assert.equal(fin.estado, 'fallida'); assert.match(fin.error, /credenciales/);
  } finally { server.close(); }
});

test('Mercado: /mercado/estado combina reloj e índices y usa caché', async () => {
  const integ = fakeIntegraciones();
  const { call, server } = await arrancar(integ);
  try {
    const e = await call('GET', '/mercado/estado');
    assert.equal(e.abierto, true); assert.ok(e.proximaApertura && e.proximoCierre);
    assert.deepEqual(e.indices.map(i => i.simbolo), ['SPY', 'QQQ', 'IWM', 'DIA']);
    assert.equal(e.indices[0].precio, 150);
    assert.ok(Math.abs(e.indices[0].cambioPct - (150 / 145 - 1)) < 1e-9);
    assert.ok(e.fuente);
    await call('GET', '/mercado/estado');
    assert.equal(integ.llamadas.reloj, 1, 'segunda lectura desde caché');
  } finally { server.close(); }
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
