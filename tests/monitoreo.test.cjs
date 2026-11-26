// Monitoreo de las APIs (openspec: monitoreo-servicio): métricas Prometheus, analítica de uso, errores agrupados,
// instrumentación, endpoints de operación protegidos y envío opcional a Sentry.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistro } = require('../dist/modulos/monitoreo/metricas');
const { createUso } = require('../dist/modulos/monitoreo/uso');
const { createErrores, huellaDe } = require('../dist/modulos/monitoreo/errores');

test('métricas: contador e histograma en el formato de texto de Prometheus, con etiquetas escapadas', () => {
  const r = createRegistro();
  const c = r.contador('http_solicitudes_total', 'Solicitudes atendidas');
  c.sumar({ metodo: 'GET', ruta: '/api/v1/empresas/:id', codigo: 200 });
  c.sumar({ metodo: 'GET', ruta: '/api/v1/empresas/:id', codigo: 200 });
  c.sumar({ ruta: 'con "comillas"\ny salto\\' });
  const h = r.histograma('http_duracion_segundos', 'Duración', [0.01, 0.1]);
  h.observar({ ruta: '/x' }, 0.005); h.observar({ ruta: '/x' }, 0.05); h.observar({ ruta: '/x' }, 3);
  r.calculado('circuito_abierto', 'Circuito abierto (1) o no (0)', () => [{ etiquetas: { proveedor: 'alpaca' }, valor: 1 }]);
  const t = r.exportar();
  assert.match(t, /^# HELP http_solicitudes_total Solicitudes atendidas\n# TYPE http_solicitudes_total counter\n/);
  assert.match(t, /^http_solicitudes_total\{codigo="200",metodo="GET",ruta="\/api\/v1\/empresas\/:id"\} 2$/m);
  assert.match(t, /^http_solicitudes_total\{ruta="con \\"comillas\\"\\ny salto\\\\"\} 1$/m);
  assert.match(t, /^# TYPE http_duracion_segundos histogram$/m);
  assert.match(t, /^http_duracion_segundos_bucket\{le="0\.01",ruta="\/x"\} 1$/m);
  assert.match(t, /^http_duracion_segundos_bucket\{le="0\.1",ruta="\/x"\} 2$/m);
  assert.match(t, /^http_duracion_segundos_bucket\{le="\+Inf",ruta="\/x"\} 3$/m);
  assert.match(t, /^http_duracion_segundos_sum\{ruta="\/x"\} 3\.055$/m);
  assert.match(t, /^http_duracion_segundos_count\{ruta="\/x"\} 3$/m);
  assert.match(t, /^circuito_abierto\{proveedor="alpaca"\} 1$/m);
});

test('métricas: un valor calculado que falla no rompe la exportación', () => {
  const r = createRegistro();
  r.calculado('roto', 'falla', () => { throw new Error('x'); });
  r.contador('ok_total', 'ok').sumar();
  assert.match(r.exportar(), /^ok_total 1$/m);
});

test('uso: ordena endpoints por solicitudes, calcula p50/p95, cuenta rechazos y usuarios seudonimizados', () => {
  const u = createUso();
  for (let i = 1; i <= 5; i++) u.registrar({ metodo: 'GET', ruta: '/api/v1/empresas', codigo: 200, ms: i * 10, usuario: 'a1' });
  u.registrar({ metodo: 'GET', ruta: '/api/v1/estrategias', codigo: 429, ms: 1, usuario: 'b2' });
  u.registrar({ metodo: 'GET', ruta: '/api/v1/estrategias', codigo: 503, ms: 2, usuario: 'b2' });
  const r = u.resumen();
  assert.equal(r.endpoints[0].endpoint, 'GET /api/v1/empresas');
  assert.equal(r.endpoints[0].solicitudes, 5);
  assert.equal(r.endpoints[0].p50ms, 30);
  assert.equal(r.endpoints[0].p95ms, 50);
  assert.deepEqual(r.endpoints[1].rechazos, { 429: 1, 503: 1 });
  assert.deepEqual(r.usuarios, [{ usuario: 'a1', solicitudes: 5 }, { usuario: 'b2', solicitudes: 2 }]);
  assert.equal(r.totalSolicitudes, 7);
});

test('uso: los topes de endpoints y usuarios descartan el más antiguo', () => {
  const u = createUso({ maxUsuarios: 2, maxEndpoints: 2 });
  for (const [ruta, usuario] of [['/a', 'u1'], ['/b', 'u2'], ['/c', 'u3']]) u.registrar({ metodo: 'GET', ruta, codigo: 200, ms: 1, usuario });
  const r = u.resumen();
  assert.deepEqual(r.endpoints.map(e => e.endpoint).sort(), ['GET /b', 'GET /c']);
  assert.equal(r.totalUsuarios, 2);
});

test('errores: el mismo error con ids y números distintos forma un solo grupo; los secretos se ocultan', () => {
  const e = createErrores();
  const ruta = '/api/v1/empresas/:id';
  for (const id of ['3b1cf135-5453-4e7e-bc68-6b2fb8b2de6f', '9a1cf135-5453-4e7e-bc68-6b2fb8b2de60', 'aa1cf135-5453-4e7e-bc68-6b2fb8b2de61']) {
    e.capturar(new TypeError(`No se pudo leer ${id} tras 3 intentos`), { ruta, requestId: 'req-' + id.slice(0, 4) });
  }
  e.capturar(new RangeError('otro'), { ruta });
  const lista = e.lista();
  assert.equal(lista.length, 2);
  const g = lista.find(x => x.tipo === 'TypeError');
  assert.equal(g.conteo, 3);
  assert.equal(g.mensaje, 'No se pudo leer <uuid> tras # intentos');
  assert.ok(g.primeraVez && g.ultimaVez && g.requestIdEjemplo);
  assert.equal(e.total(), 4);
  assert.match(huellaDe(new Error('conectar a mongodb://usuario:clave@host fallo'), '/x'), /\/\/\[oculto\]@/);
});

test('errores: el tope de grupos descarta el más antiguo', () => {
  const e = createErrores({ max: 2 });
  e.capturar(new Error('a'), { ruta: '/a' }); e.capturar(new Error('b'), { ruta: '/b' }); e.capturar(new Error('c'), { ruta: '/c' });
  assert.deepEqual(e.lista().map(g => g.ruta).sort(), ['/b', '/c']);
});

// --- Integración: la app completa con monitoreo activado ---
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createIntegrations } = require('../dist/integrations');
const { createCola } = require('../dist/jobs/cola');
const API = require('../dist/config/config').default.API_URL;
const TOKEN = 'token-de-monitoreo-de-prueba';

// Base en memoria que falla al listar «noticias» con un mensaje que incluye un id y un número (para provocar 500 reales).
const factoryQueFalla = () => {
  const base = memoryFactory();
  return (nombre, ctx) => {
    const repo = base(nombre, ctx);
    if (nombre !== 'noticias') return repo;
    const falla = async () => { throw new TypeError(`Lectura fallida del lote ${randomUUID()} tras ${Math.floor(Math.random() * 9) + 1} intentos`); };
    return { ...repo, list: falla, count: falla }; // el CRUD cuenta antes de listar
  };
};

async function levantar(t, { monitoreo = {}, integraciones = createIntegrations({}) } = {}) {
  const u = randomUUID(), factory = factoryQueFalla(), logs = [];
  const auth = createSessionService(factory, async () => [{ id: u, email: 'ana@local', salt: u, passwordHash: scryptSync('clave', u, 64).toString('hex') }]);
  const app = createApp({ factory, auth, integraciones, cola: createCola(), quiet: true, webDir: null, salud: { comprobaciones: { m: async () => {} } },
    monitoreo: { escribirLog: l => logs.push(l), ...monitoreo } });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); s.close(); });
  const base = 'http://127.0.0.1:' + s.address().port;
  const token = (await (await fetch(base + API + '/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@local', password: 'clave', baseDatos: 'mongodb' }) })).json()).data.token;
  const H = { Authorization: 'Bearer ' + token };
  const api = (ruta, init = {}) => fetch(base + API + ruta, { ...init, headers: { ...H, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const operacion = (ruta, tok = TOKEN) => fetch(base + ruta, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  return { base, api, operacion, logs, usuarioId: u, token };
}

test('monitoreo: la ruta de respaldo de la SPA (expresión regular) se etiqueta como «spa»', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'web-')); t.after(() => fs.rmSync(web, { recursive: true, force: true }));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><div id="root"></div>');
  const factory = memoryFactory();
  const app = createApp({ factory, auth: createSessionService(factory, async () => []), integraciones: createIntegrations({}), cola: createCola(), quiet: true, webDir: web,
    salud: { comprobaciones: { m: async () => {} } }, monitoreo: { token: TOKEN } });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening'); t.after(() => { s.closeAllConnections(); s.close(); });
  const base = 'http://127.0.0.1:' + s.address().port;
  assert.equal((await fetch(base + '/analisis/AAPL')).status, 200);
  const texto = await (await fetch(base + '/metrics', { headers: { Authorization: 'Bearer ' + TOKEN } })).text();
  assert.match(texto, /^http_solicitudes_total\{codigo="200",metodo="GET",ruta="spa"\} 1$/m);
  assert.doesNotMatch(texto, /ruta="\/\^/, 'sin el texto crudo de la expresión regular');
});

test('monitoreo: Server-Timing en toda respuesta', async t => {
  const s = await levantar(t);
  const r = await fetch(s.base + '/health');
  assert.match(r.headers.get('server-timing'), /^app;dur=\d+(\.\d)?$/);
});

test('monitoreo: sin MONITOREO_TOKEN los endpoints de operación no existen (404); token incorrecto → 401', async t => {
  const sin = await levantar(t);
  for (const r of ['/metrics', '/monitoreo/uso', '/monitoreo/errores']) assert.equal((await sin.operacion(r)).status, 404, r);
  const con = await levantar(t, { monitoreo: { token: TOKEN } });
  assert.equal((await con.operacion('/metrics', null)).status, 401);
  assert.equal((await con.operacion('/monitoreo/uso', 'otro-token-de-igual-longitud-x')).status, 401);
  assert.equal((await con.operacion('/monitoreo/errores', con.token)).status, 401, 'la sesión de usuario no sirve como token de operación');
  const ok = await con.operacion('/metrics');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('monitoreo: /metrics etiqueta por patrón (sin ids reales) e incluye proceso, cola y circuitos', async t => {
  const integraciones = createIntegrations({ ALPACA_KEY_ID: 'PKm', ALPACA_SECRET_KEY: 'sm' }, async () => { throw new TypeError('fetch failed'); });
  for (let i = 0; i < 5; i++) await assert.rejects(integraciones.alpaca.cotizacion('AAPL'));
  const s = await levantar(t, { monitoreo: { token: TOKEN }, integraciones });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await s.api('/empresas', { method: 'POST', body: JSON.stringify({ simbolo: 'M' + i, nombre: 'm', mercado: 'N' }) })).json()).data._id);
  for (const id of ids) assert.equal((await s.api('/empresas/' + id)).status, 200);
  await s.api('/configuraciones/x/componentes', { method: 'POST' });
  const texto = await (await s.operacion('/metrics')).text();
  assert.match(texto, /^http_solicitudes_total\{codigo="200",metodo="GET",ruta="\/api\/v1\/empresas\/:id"\} 3$/m);
  assert.match(texto, /^http_duracion_segundos_count\{metodo="GET",ruta="\/api\/v1\/empresas\/:id"\} 3$/m);
  assert.match(texto, /ruta="\/api\/v1\/configuraciones\/:id\/componentes"/);
  for (const id of ids) assert.ok(!texto.includes(id), 'no debe aparecer un id real');
  assert.match(texto, /^circuito_abierto\{proveedor="alpaca"\} 1$/m);
  assert.match(texto, /^circuito_abierto\{proveedor="sec"\} 0$/m);
  assert.match(texto, /^proceso_memoria_bytes\{tipo="rss"\} \d+$/m);
  assert.match(texto, /^cola_aceptando 1$/m);
  assert.match(texto, /^event_loop_retraso_p99_segundos [\d.e-]+$/m);
});

test('monitoreo: log JSON por solicitud sin token, consulta, correo ni id real', async t => {
  const s = await levantar(t, { monitoreo: { token: TOKEN, logJson: true } });
  await s.api('/empresas?search=secreto-de-busqueda');
  const linea = s.logs.map(l => JSON.parse(l)).find(l => l.ruta === '/api/v1/empresas' && l.metodo === 'GET');
  assert.ok(linea, 'hay línea de log');
  assert.deepEqual(Object.keys(linea).sort(), ['codigo', 'metodo', 'ms', 'nivel', 'requestId', 'ruta', 'ts', 'usuario']);
  assert.equal(linea.codigo, 200); assert.equal(linea.nivel, 'info');
  const todo = s.logs.join('\n');
  for (const prohibido of [s.token, 'secreto-de-busqueda', 'ana@local', s.usuarioId, 'clave']) assert.ok(!todo.includes(prohibido), 'el log no debe contener ' + prohibido.slice(0, 12));
});

test('monitoreo: /monitoreo/uso ordena endpoints y usa seudónimos (sin correo ni id real)', async t => {
  const s = await levantar(t, { monitoreo: { token: TOKEN } });
  for (let i = 0; i < 5; i++) await s.api('/empresas');
  for (let i = 0; i < 2; i++) await s.api('/estrategias');
  const { data } = await (await s.operacion('/monitoreo/uso')).json();
  const empresas = data.endpoints.find(e => e.endpoint === 'GET /api/v1/empresas');
  assert.equal(empresas.solicitudes, 5);
  assert.ok(data.endpoints.indexOf(empresas) < data.endpoints.findIndex(e => e.endpoint === 'GET /api/v1/estrategias'));
  assert.ok(empresas.p95ms >= 0);
  assert.equal(data.usuarios.length, 1);
  assert.match(data.usuarios[0].usuario, /^[0-9a-f]{10}$/);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(`ana@local|${s.usuarioId}`));
});

test('monitoreo: tres 500 iguales forman un grupo; Sentry caído no cambia la respuesta', async t => {
  const enviados = [];
  const s = await levantar(t, { monitoreo: { token: TOKEN, sentryDsn: 'https://clavepublica@o1.ingest.sentry.io/42', fetch: async (url, init) => { enviados.push({ url, init }); throw new TypeError('Sentry caído'); } } });
  for (let i = 0; i < 3; i++) {
    const r = await s.api('/noticias');
    assert.equal(r.status, 500);
    assert.ok((await r.json()).requestId, 'el cliente recibe su 500 normal con requestId');
  }
  const { data } = await (await s.operacion('/monitoreo/errores')).json();
  assert.equal(data.sentry, true);
  assert.equal(data.grupos.length, 1);
  assert.equal(data.grupos[0].conteo, 3);
  assert.equal(data.grupos[0].ruta, '/api/v1/noticias');
  assert.equal(data.grupos[0].mensaje, 'Lectura fallida del lote <uuid> tras # intentos');
  assert.equal(enviados.length, 1, 'un solo envío por huella en 60 s');
  assert.equal(enviados[0].url, 'https://o1.ingest.sentry.io/api/42/envelope/');
  assert.match(enviados[0].init.headers['X-Sentry-Auth'], /sentry_key=clavepublica/);
  const [, tipo, evento] = enviados[0].init.body.split('\n').map(JSON.parse);
  assert.equal(tipo.type, 'event');
  assert.equal(evento.exception.values[0].type, 'TypeError');
  assert.equal(evento.tags.ruta, '/api/v1/noticias');
  const metricas = await (await s.operacion('/metrics')).text();
  assert.match(metricas, /^errores_capturados_total\{ruta="\/api\/v1\/noticias"\} 3$/m);
});
