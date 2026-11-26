// Liveness y readiness del servicio (openspec: salud-servicio). Bases simuladas: se inyectan las comprobaciones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createIntegrations } = require('../dist/integrations');
const { createCola } = require('../dist/jobs/cola');

async function levantar(t, { comprobaciones, integraciones = createIntegrations({}, async () => new Response('{}')), cola = createCola(), ...salud } = {}) {
  const app = createApp({ factory: memoryFactory(), integraciones, cola, quiet: true, webDir: null, salud: { comprobaciones, ...salud } });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); s.close(); });
  const base = 'http://127.0.0.1:' + s.address().port;
  return { pedir: async ruta => { const r = await fetch(base + ruta); return { status: r.status, cache: r.headers.get('cache-control'), json: await r.json() }; }, cola };
}
const ok = async () => {};
const SECRETO = 'mongodb+srv://usuario:clave-secreta@cluster.example.net';

test('readiness: con una base que responde está listo; la no configurada se informa como tal', async t => {
  const s = await levantar(t, { comprobaciones: { mongodb: ok, supabase: null } });
  const r = await s.pedir('/health/listo');
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  assert.equal(r.json.estado, 'listo');
  assert.equal(r.json.motivo, undefined);
  assert.equal(r.json.dependencias.mongodb.estado, 'ok');
  assert.deepEqual(r.json.dependencias.supabase, { estado: 'sin_configurar' });
  assert.equal(r.json.degradado, false);
  assert.equal(r.json.cola.aceptando, true);
});

test('readiness: sin ninguna base que responda → 503 no_listo, y nunca revela la dirección ni la clave', async t => {
  const s = await levantar(t, { comprobaciones: { mongodb: async () => { throw new Error('no se pudo conectar a ' + SECRETO); }, supabase: null } });
  const r = await s.pedir('/health/listo');
  assert.equal(r.status, 503);
  assert.equal(r.json.estado, 'no_listo');
  assert.equal(r.json.motivo, 'sin_base_de_datos');
  assert.equal(r.json.dependencias.mongodb.estado, 'caido');
  assert.doesNotMatch(JSON.stringify(r.json), /clave-secreta|cluster\.example|usuario:/);
});

test('readiness: una comprobación que no responde se corta al tope y cuenta como caída', async t => {
  const s = await levantar(t, { comprobaciones: { mongodb: () => new Promise(() => {}), supabase: ok }, topeMs: 150 });
  const t0 = Date.now(), r = await s.pedir('/health/listo');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.json.dependencias.mongodb.estado, 'caido');
  assert.equal(r.status, 200, 'Supabase responde: sigue listo');
});

test('readiness: un proveedor con el circuito abierto degrada pero no tumba (200 + degradado)', async t => {
  const integraciones = createIntegrations({ ALPACA_KEY_ID: 'PKx', ALPACA_SECRET_KEY: 'sx' }, async () => { throw new TypeError('fetch failed'); });
  for (let i = 0; i < 5; i++) await assert.rejects(integraciones.alpaca.cotizacion('AAPL'));
  const s = await levantar(t, { comprobaciones: { mongodb: ok }, integraciones });
  const r = await s.pedir('/health/listo');
  assert.equal(r.status, 200);
  assert.equal(r.json.degradado, true);
  assert.equal(r.json.proveedores.alpaca.circuito, 'abierto');
  assert.ok(r.json.proveedores.alpaca.reintentoEnSegundos > 0);
  assert.equal(r.json.proveedores.sec.circuito, 'cerrado');
});

test('readiness: 20 consultas seguidas comprueban cada base una sola vez (caché de 10 s)', async t => {
  let n = 0;
  const s = await levantar(t, { comprobaciones: { mongodb: async () => { n++; await new Promise(r => setTimeout(r, 20)); } } });
  await Promise.all(Array.from({ length: 20 }, () => s.pedir('/health/listo')));
  assert.equal(n, 1);
});

test('liveness: /health sigue 200 aunque la base esté caída', async t => {
  const s = await levantar(t, { comprobaciones: { mongodb: async () => { throw new Error('caída'); } } });
  assert.equal((await s.pedir('/health/listo')).status, 503);
  const h = await s.pedir('/health');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json, { status: 'ok' });
});

// --- Apagado ordenado con drenado ---
const { crearApagado } = require('../dist/modulos/salud');
const servidorFalso = () => { const s = { cerrado: false, close(cb) { s.cerrado = true; cb(); } }; return s; };

test('apagado: deja de aceptar, espera a que termine la sincronización en curso y luego cierra', async () => {
  const cola = createCola(), server = servidorFalso(), orden = [];
  cola.encolar('sincronizacion', async () => { await new Promise(r => setTimeout(r, 300)); orden.push('trabajo completado'); });
  const apagar = crearApagado({ server, cola, cerrarBase: async () => { orden.push('base cerrada'); }, salir: () => assert.fail('no debe forzar la salida') });
  const promesa = apagar();
  assert.equal(cola.aceptando(), false, 'deja de aceptar de inmediato');
  assert.equal(server.cerrado, false, 'no cierra mientras hay trabajo');
  assert.equal(await promesa, 0);
  assert.equal(server.cerrado, true);
  assert.deepEqual(orden, ['trabajo completado', 'base cerrada']);
});

test('apagado: si el trabajo no termina a tiempo, cierra al vencer el drenado y lo avisa', async () => {
  const cola = createCola(), server = servidorFalso(), avisos = [];
  cola.encolar('eterno', () => new Promise(() => {}));
  const t0 = Date.now();
  const codigo = await crearApagado({ server, cola, drenadoMs: 150, avisar: m => avisos.push(m), salir: () => assert.fail('no debe forzar la salida') })();
  assert.equal(codigo, 0);
  assert.ok(Date.now() - t0 >= 140 && Date.now() - t0 < 1000);
  assert.equal(server.cerrado, true);
  assert.match(avisos[0], /quedan trabajos en curso/);
});

test('apagado: una segunda señal no repite el cierre; un fallo al detener algo no lo impide', async () => {
  let cierres = 0;
  const server = { close(cb) { cierres++; cb(); } };
  const apagar = crearApagado({ server, cola: createCola(), alApagar: [() => { throw new Error('x'); }], salir: () => {} });
  await Promise.all([apagar(), apagar()]);
  assert.equal(cierres, 1);
});
