// Resiliencia ante proveedores externos (openspec: resiliencia-proveedores): circuito puro y su uso en el cliente HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCircuito } = require('../dist/modulos/compartido/circuito');

const reloj = () => { let t = 1_000_000; return { ahora: () => t, avanzar: ms => { t += ms; } }; };

test('circuito: abre tras 5 fallos seguidos y entonces no deja pasar', () => {
  const r = reloj(), c = createCircuito({ ahora: r.ahora });
  for (let i = 0; i < 4; i++) { assert.equal(c.permitir().permitido, true); c.fallo(); }
  assert.equal(c.estado().estado, 'cerrado');
  c.fallo();
  assert.equal(c.estado().estado, 'abierto');
  const p = c.permitir();
  assert.equal(p.permitido, false);
  assert.equal(p.reintentoEnMs, 30000);
  assert.equal(c.estado().reintentoEnSegundos, 30);
});

test('circuito: un éxito reinicia la cuenta (4 fallos, éxito, 4 fallos → sigue cerrado)', () => {
  const c = createCircuito({ ahora: reloj().ahora });
  for (let i = 0; i < 4; i++) c.fallo();
  c.exito();
  for (let i = 0; i < 4; i++) c.fallo();
  assert.equal(c.estado().estado, 'cerrado');
});

test('circuito: a los 30 s pasa a semiabierto y deja pasar UNA sola prueba', () => {
  const r = reloj(), c = createCircuito({ ahora: r.ahora });
  for (let i = 0; i < 5; i++) c.fallo();
  r.avanzar(29_999);
  assert.equal(c.permitir().permitido, false);
  r.avanzar(1);
  assert.equal(c.estado().estado, 'semiabierto');
  assert.deepEqual(c.permitir(), { permitido: true, prueba: true });
  const otra = c.permitir();
  assert.equal(otra.permitido, false, 'mientras la prueba está en curso, las demás fallan rápido');
});

test('circuito: la prueba exitosa lo cierra y la fallida lo reabre otros 30 s', () => {
  const r = reloj(), c = createCircuito({ ahora: r.ahora });
  for (let i = 0; i < 5; i++) c.fallo();
  r.avanzar(30_000); c.permitir(); c.exito();
  assert.equal(c.estado().estado, 'cerrado');
  assert.equal(c.permitir().permitido, true);

  for (let i = 0; i < 5; i++) c.fallo();
  r.avanzar(30_000); c.permitir(); c.fallo();
  assert.equal(c.estado().estado, 'abierto');
  assert.equal(c.permitir().reintentoEnMs, 30000);
});

test('circuito: umbral y espera configurables', () => {
  const r = reloj(), c = createCircuito({ umbral: 2, esperaMs: 1000, ahora: r.ahora });
  c.fallo(); c.fallo();
  assert.equal(c.estado().estado, 'abierto');
  r.avanzar(1000);
  assert.equal(c.estado().estado, 'semiabierto');
});

const { createHttp } = require('../dist/integrations/http');
const fetchSimulado = respuestas => {
  const llamadas = [];
  const fn = async url => { llamadas.push(url); const r = respuestas.shift() ?? { status: 200, body: '{}' }; if (r.red) throw new TypeError('fetch failed'); return new Response(r.body ?? '{}', { status: r.status }); };
  return { fn, llamadas };
};
const cliente = (f, extra = {}) => createHttp({ proveedor: 'alpaca', fetch: f.fn, reintentos: 0, esperar: async () => {}, ...extra });

test('cliente HTTP: tras 5 caídas el siguiente falla sin llamar a fetch, con CIRCUITO_ABIERTO y reintentoEnMs', async () => {
  const f = fetchSimulado([{ status: 503 }, { status: 502 }, { red: true }, { status: 500 }, { status: 503 }]);
  const http = cliente(f);
  for (let i = 0; i < 5; i++) await assert.rejects(http.request({ url: 'https://x.test/a' }));
  assert.equal(http.circuito().estado, 'abierto');
  const antes = f.llamadas.length, t0 = Date.now();
  await assert.rejects(http.request({ url: 'https://x.test/a' }), e => e.codigo === 'CIRCUITO_ABIERTO' && e.reintentoEnMs > 0 && /Reintenta en \d+ s/.test(e.mensaje));
  assert.equal(f.llamadas.length, antes, 'no sale a la red');
  assert.ok(Date.now() - t0 < 100);
});

test('cliente HTTP: los 4xx (incluido 429) no abren el circuito', async () => {
  const f = fetchSimulado(Array.from({ length: 10 }, (_, i) => ({ status: [404, 422, 429, 400, 401][i % 5] })));
  const http = cliente(f);
  for (let i = 0; i < 10; i++) await assert.rejects(http.request({ url: 'https://x.test/b' }));
  assert.equal(http.circuito().estado, 'cerrado');
  assert.equal(http.circuito().fallosSeguidos, 0);
});

test('cliente HTTP: tras la espera, una prueba exitosa cierra el circuito y vuelven a pasar', async () => {
  let t = 0;
  const f = fetchSimulado([...Array(5).fill({ status: 503 }), { status: 200, body: '{"ok":true}' }, { status: 200, body: '{"ok":2}' }]);
  const http = cliente(f, { ahora: () => t, esperaCircuitoMs: 30000 });
  for (let i = 0; i < 5; i++) await assert.rejects(http.request({ url: 'https://x.test/c' }));
  t += 30000;
  assert.deepEqual(await http.request({ url: 'https://x.test/c' }), { ok: true });
  assert.equal(http.circuito().estado, 'cerrado');
  assert.deepEqual(await http.request({ url: 'https://x.test/c' }), { ok: 2 });
});

test('cliente HTTP: cada proveedor tiene su propio circuito', async () => {
  const caido = cliente(fetchSimulado(Array(5).fill({ status: 503 })));
  const sano = createHttp({ proveedor: 'sec', fetch: fetchSimulado([]).fn, reintentos: 0, esperar: async () => {} });
  for (let i = 0; i < 5; i++) await assert.rejects(caido.request({ url: 'https://x.test/d' }));
  assert.equal(caido.circuito().estado, 'abierto');
  assert.deepEqual(await sano.request({ url: 'https://y.test/d' }), {});
  assert.equal(sano.circuito().estado, 'cerrado');
});

// --- La API traduce el circuito abierto a 503 + Retry-After ---
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createIntegrations } = require('../dist/integrations');
const { createCola } = require('../dist/jobs/cola');
const API = require('../dist/config/config').default.API_URL;

async function servidor(t, integraciones) {
  const u = randomUUID(), factory = memoryFactory();
  const auth = createSessionService(factory, async () => [{ id: u, email: 'a@b.c', salt: u, passwordHash: scryptSync('p', u, 64).toString('hex') }]);
  const app = createApp({ factory, integraciones, auth, quiet: true, webDir: null, cola: createCola() });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); s.close(); });
  const base = 'http://127.0.0.1:' + s.address().port + API;
  const login = await (await fetch(base + '/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'p', baseDatos: 'mongodb' }) })).json();
  const auth2 = { Authorization: 'Bearer ' + login.data.token };
  return { pedir: (ruta, init = {}) => fetch(base + ruta, { ...init, headers: { ...auth2, ...(init.headers || {}) } }), base };
}

test('API: con el circuito de Alpaca abierto la cotización en vivo responde 503 al instante con Retry-After', async t => {
  let llamadas = 0;
  const integraciones = createIntegrations({ ALPACA_KEY_ID: 'PKprueba', ALPACA_SECRET_KEY: 'secreto-prueba' }, async () => { llamadas++; throw new TypeError('fetch failed'); });
  for (let i = 0; i < 5; i++) await assert.rejects(integraciones.alpaca.cotizacion('AAPL'), e => e.codigo === 'RED');
  assert.equal(integraciones.alpaca.circuito().estado, 'abierto');
  const s = await servidor(t, integraciones);
  const antes = llamadas, t0 = Date.now();
  const r = await s.pedir('/mercado/cotizaciones/AAPL/en-vivo');
  const ms = Date.now() - t0, cuerpo = await r.json();
  assert.equal(r.status, 503);
  // Los < 100 ms se exigen en el cliente HTTP (prueba de arriba), donde decide el circuito. Aquí la medición incluye
  // conexión, sesión y servidor completos con toda la batería en paralelo: margen holgado frente a los 15 s + reintentos de antes.
  assert.ok(ms < 1000, ms + ' ms');
  assert.ok(Number(r.headers.get('retry-after')) >= 1 && Number(r.headers.get('retry-after')) <= 30);
  assert.match(cuerpo.message, /^\[alpaca\] .*Reintenta en \d+ s/);
  assert.doesNotMatch(JSON.stringify(cuerpo), /secreto-prueba|PKprueba/);
  assert.equal(llamadas, antes, 'no salió a la red');
});

test('API: /integraciones/estado muestra el circuito abierto de un proveedor sin tocar los demás campos', async t => {
  const integraciones = createIntegrations({ SEC_USER_AGENT: 'Prueba prueba@example.com' }, async () => { throw new TypeError('fetch failed'); });
  for (let i = 0; i < 5; i++) await assert.rejects(integraciones.sec.cikDeSimbolo('AAPL'));
  const s = await servidor(t, integraciones);
  const { data } = await (await s.pedir('/integraciones/estado')).json();
  assert.equal(data.sec.configurado, true);
  assert.equal(data.sec.circuito.estado, 'abierto');
  assert.ok(data.sec.circuito.reintentoEnSegundos > 0 && data.sec.circuito.reintentoEnSegundos <= 30);
  assert.equal(data.alpaca.circuito.estado, 'cerrado');
  assert.equal(data.alpaca.entorno, 'paper');
  assert.doesNotMatch(JSON.stringify(data), /prueba@example\.com/);
});
