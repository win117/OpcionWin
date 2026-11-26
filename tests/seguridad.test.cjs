// Pruebas de seguridad de la API organizadas según el OWASP API Security Top 10 (2023). Complementan el escaneo
// dinámico de OWASP ZAP (npm run test:seguridad) con casos que un escáner no conoce: dueño de cada registro, sesiones, etc.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createIntegrations } = require('../dist/integrations');
const { createCola } = require('../dist/jobs/cola');
const API = require('../dist/config/config').default.API_URL;

async function levantar(t) {
  const factory = memoryFactory();
  const usuarios = ['ana@local', 'beto@local'].map(email => { const id = randomUUID(); return { id, email, salt: id, passwordHash: scryptSync('clave', id, 64).toString('hex') }; });
  const app = createApp({ factory, auth: createSessionService(factory, async () => usuarios), integraciones: createIntegrations({}), cola: createCola(), quiet: true, webDir: null, salud: { comprobaciones: { memoria: async () => {} } } });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); s.close(); });
  const base = 'http://127.0.0.1:' + s.address().port + API;
  const pedir = (metodo, ruta, { token, body, headers = {} } = {}) => fetch(base + ruta, { method: metodo,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const login = async email => (await (await pedir('POST', '/sesiones', { body: { email, password: 'clave', baseDatos: 'mongodb' } })).json()).data.token;
  return { pedir, login, base };
}
const empresa = { simbolo: 'SEG', nombre: 'Seguridad', mercado: 'NASDAQ' };

// Cuerpo de más de 1 MB: el servidor responde 413 en cuanto lee Content-Length, sin consumir el cuerpo, y según el
// sistema operativo puede cortar la conexión mientras el cliente aún envía (EPIPE/ECONNRESET). Se toma la respuesta
// en cuanto llega y se ignora el corte posterior del envío.
function enviarGrande(url, token, cuerpo) {
  return new Promise((resolver, rechazar) => {
    let listo = false;
    const req = require('node:http').request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo), Authorization: 'Bearer ' + token } }, res => {
      listo = true; res.resume(); resolver(res.statusCode);
    });
    req.on('error', e => { if (!listo) rechazar(e); });
    req.end(cuerpo);
  });
}

test('API1 Autorización a nivel de objeto (BOLA): un usuario no lee, cambia ni borra registros de otro', async t => {
  const s = await levantar(t), ana = await s.login('ana@local'), beto = await s.login('beto@local');
  const id = (await (await s.pedir('POST', '/empresas', { token: ana, body: empresa })).json()).data._id;
  assert.equal((await s.pedir('GET', '/empresas/' + id, { token: beto })).status, 404);
  assert.equal((await s.pedir('PUT', '/empresas/' + id, { token: beto, body: empresa })).status, 404);
  assert.equal((await s.pedir('DELETE', '/empresas/' + id, { token: beto })).status, 404);
  assert.equal((await (await s.pedir('GET', '/empresas', { token: beto })).json()).data.total, 0, 'la lista de Beto no incluye lo de Ana');
  assert.equal((await s.pedir('GET', '/empresas/' + id, { token: ana })).status, 200, 'el dueño sí lo ve');
});

test('API2 Autenticación: sin token, token alterado o revocado → 401; fuerza bruta → 429', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  assert.equal((await s.pedir('GET', '/empresas')).status, 401);
  const alterado = ana.slice(0, -1) + (ana.endsWith('a') ? 'b' : 'a');
  assert.equal((await s.pedir('GET', '/empresas', { token: alterado })).status, 401);
  assert.equal((await s.pedir('GET', '/empresas', { headers: { Authorization: 'Basic YW5hOmNsYXZl' } })).status, 401);
  assert.equal((await s.pedir('DELETE', '/sesiones/actual', { token: ana })).status, 204);
  assert.equal((await s.pedir('GET', '/empresas', { token: ana })).status, 401, 'revocado');
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await s.pedir('POST', '/sesiones', { body: { email: 'beto@local', password: 'incorrecta', baseDatos: 'mongodb' } });
  assert.equal(ultimo.status, 429);
  assert.ok(Number(ultimo.headers.get('retry-after')) > 0);
});

test('API3 Autorización a nivel de propiedad: no se asigna el dueño ni campos del servidor, y no se exponen secretos', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  for (const campo of [{ usuarioId: randomUUID() }, { _revision: 99 }, { owner_id: 'x' }]) {
    const r = await s.pedir('POST', '/empresas', { token: ana, body: { ...empresa, ...campo } });
    assert.equal(r.status, 400, JSON.stringify(campo));
    assert.match((await r.json()).message, /no editable/);
  }
  const textos = await Promise.all(['/sesiones/actual', '/empresas', '/conexiones-broker', '/auditoria'].map(async r => (await s.pedir('GET', r, { token: ana })).text()));
  for (const t of textos) assert.doesNotMatch(t, /passwordHash|tokenHash|credencialRef|"salt"/);
});

test('API4 Consumo de recursos: cuerpo > 1 MB → 413 y páginas de más de 100 → 400', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  assert.equal(await enviarGrande(s.base + '/empresas', ana, JSON.stringify({ ...empresa, nombre: 'x'.repeat(1_100_000) })), 413);
  assert.equal((await s.pedir('GET', '/empresas?limit=500', { token: ana })).status, 400);
  assert.equal((await s.pedir('POST', '/empresas/lote', { token: ana, body: { items: Array(101).fill(empresa) } })).status, 400);
});

test('Inyección: operadores de MongoDB en consulta o en el id no filtran ni devuelven datos ajenos', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  await s.pedir('POST', '/empresas', { token: ana, body: empresa });
  for (const q of ['simbolo[$ne]=x', 'simbolo[$gt]=', '_id[$exists]=true']) {
    const r = await s.pedir('GET', '/empresas?' + q, { token: ana });
    if (r.status === 200) assert.equal((await r.json()).data.total, 0, q + ' no debe actuar como operador');
    else assert.equal(r.status, 400, q);
  }
  for (const id of [encodeURIComponent('{"$ne":null}'), '%24where', '..%2F..%2Fpackage.json']) {
    assert.ok([400, 404].includes((await s.pedir('GET', '/empresas/' + id, { token: ana })).status), id);
  }
  const busqueda = await s.pedir('GET', '/empresas?search=' + encodeURIComponent('.*'), { token: ana });
  assert.equal((await busqueda.json()).data.total, 0, 'la búsqueda escapa expresiones regulares');
});

test('API8 Configuración: cabeceras de seguridad, sin X-Powered-By, CORS cerrado y errores sin rastro de pila', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  const r = await s.pedir('GET', '/empresas', { token: ana, headers: { Origin: 'https://malicioso.example' } });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'un origen ajeno no recibe permiso CORS');
  assert.equal(r.headers.get('cache-control'), 'no-store', 'las respuestas autenticadas no se guardan en caché');
  const e = await (await s.pedir('POST', '/empresas', { token: ana, body: '{"roto":' })).text();
  assert.doesNotMatch(e, /\n\s+at |node_modules|SyntaxError/, 'el error no filtra la pila');
});

test('API9 Inventario: solo existe /api/v1; rutas desconocidas y métodos no previstos no se atienden', async t => {
  const s = await levantar(t), ana = await s.login('ana@local');
  assert.equal((await s.pedir('GET', '/no-existe', { token: ana })).status, 404);
  assert.equal((await s.pedir('PATCH', '/empresas', { token: ana, body: {} })).status, 404);
  assert.equal((await s.pedir('POST', '/auditoria', { token: ana, body: {} })).status, 405);
});
