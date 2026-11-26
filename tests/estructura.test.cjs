// La estructura se vigila sola: cada ruta no CRUD tiene definición (validación + documentación), existe de verdad y pasa por las capas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createIntegrations } = require('../dist/integrations');
const { exigirContratoBroker, METODOS_BROKER } = require('../dist/integrations/contrato-broker');
const { rutas } = require('../dist/api/v1/schemas');
const { openapi } = require('../dist/config/openapi');
const { resources } = require('../dist/repositories/resources');
const prefix = require('../dist/config/config').default.API_URL;

const SRC = join(__dirname, '../src');
const lee = p => readFileSync(join(SRC, p), 'utf8');
const archivos = d => readdirSync(join(SRC, d)).filter(n => n.endsWith('.js'));

async function servidor() {
  const u = randomUUID(), factory = memoryFactory();
  const integraciones = createIntegrations({}, async () => new Response('{}', { status: 503 }));
  const app = createApp({ factory, integraciones, auth: createSessionService(factory, async () => [{ id: u, email: 'a@b.c', salt: u, passwordHash: scryptSync('p', u, 64).toString('hex') }]), quiet: true, webDir: null });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  const base = 'http://127.0.0.1:' + s.address().port + prefix;
  let token = null;
  const pedir = async (metodo, ruta, body, headers = {}) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: r.status === 204 ? null : await r.json() };
  };
  token = (await pedir('POST', '/sesiones', { email: 'a@b.c', password: 'p', baseDatos: 'mongodb' })).json.data.token;
  return { pedir, cerrar: () => s.close() };
}

test('cada definición está montada en el servidor y aparece en OpenAPI; no hay dos iguales', async () => {
  const s = await servidor(), doc = openapi().paths;
  try {
    assert.equal(new Set(rutas.map(d => d.metodo + d.ruta)).size, rutas.length);
    for (const d of rutas) {
      const en = doc[d.ruta.replace(/:(\w+)/g, '{$1}')]?.[d.metodo];
      assert.equal(en?.summary, d.resumen, d.metodo + ' ' + d.ruta);
      for (const [, n] of d.ruta.matchAll(/:(\w+)/g)) assert.ok(en.parameters.some(p => p.in === 'path' && p.name === n), d.ruta);
      if (d.ruta === '/sesiones/actual' && d.metodo === 'delete') continue; // cerraría la sesión de la prueba
      const r = await s.pedir(d.metodo.toUpperCase(), d.ruta.replace(/:occ/, 'AAPL261218C00350000').replace(/:core/, 'tecnico').replace(/:simbolo/, 'AAPL').replace(/:\w+/g, 'x'), ['post', 'put'].includes(d.metodo) ? {} : undefined);
      assert.notEqual(r.json?.message, 'Ruta no encontrada.', d.metodo + ' ' + d.ruta);
      assert.notEqual(r.status, 500, d.metodo + ' ' + d.ruta + ': ' + r.json?.message);
    }
  } finally { s.cerrar(); }
});

test('las rutas solo conectan: sin reglas, sin base de datos y sin verbos sueltos fuera del CRUD común', () => {
  for (const n of archivos('api/v1/routes')) {
    const t = lee('api/v1/routes/' + n);
    if (['crud.routes.js', 'index.js', 'registrar.js'].includes(n)) continue;
    const sueltos = t.match(/router\.(get|post|put|delete|patch)\(/g) || [];
    assert.ok(sueltos.length <= (n === 'sesiones.routes.js' ? 1 : 0), n + ': usa registrar() o moduleRouter()'); // el límite de intentos del login
    assert.doesNotMatch(t, /from '\.\.\/services|repositories'|factory\(/, n + ' no debe hablar con servicios ni con la base');
  }
  for (const n of archivos('api/v1/controllers')) assert.doesNotMatch(lee('api/v1/controllers/' + n), /mongoose|\.collection\(|fetch\(/, n);
  for (const n of archivos('api/v1/services')) assert.doesNotMatch(lee('api/v1/services/' + n), /\breq\.|\bres\.(status|json|set|send)|from 'express'/, n + ' no debe conocer HTTP');
  for (const n of archivos('cores')) assert.doesNotMatch(lee('cores/' + n), /fetch\(|from '\.\.|from 'express'|process\.env|Date\.now\(\)/, n + ' debe ser puro');
});

// Módulos por dominio (src/modulos/<dominio>/, openspec: plataforma-seguridad «Módulos por dominio vigilados»):
// las mismas reglas de capas que src/api/v1, por archivo. compartido/ solo admite piezas puras.
function revisarModulos(raiz) {
  const fallas = [];
  if (!existsSync(raiz)) return fallas;
  for (const dominio of readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const dir = join(raiz, dominio), js = readdirSync(dir).filter(n => n.endsWith('.js'));
    const t = n => readFileSync(join(dir, n), 'utf8');
    if (dominio === 'compartido') {
      for (const n of js) if (/from 'express'|fetch\(|process\.env|\breq\.|\bres\./.test(t(n))) fallas.push(`${dominio}/${n}: compartido debe ser puro`);
      continue;
    }
    for (const n of js) {
      if (n.endsWith('.routes.js')) {
        if (/router\.(get|post|put|delete|patch)\(/.test(t(n))) fallas.push(`${dominio}/${n}: usa registrar()`);
        if (/\.service'|repositories|factory\(/.test(t(n))) fallas.push(`${dominio}/${n}: la ruta no habla con servicios ni con la base`);
        const base = n.slice(0, -'.routes.js'.length);
        for (const capa of ['schema', 'controller', 'service']) if (!js.includes(`${base}.${capa}.js`)) fallas.push(`${dominio}/${n}: falta ${base}.${capa}.js`);
      }
      if (n.endsWith('.service.js') && /\breq\.|\bres\.(status|json|set|send)|from 'express'/.test(t(n))) fallas.push(`${dominio}/${n}: el servicio no debe conocer HTTP`);
      if (n.endsWith('.controller.js') && /mongoose|\.collection\(|fetch\(/.test(t(n))) fallas.push(`${dominio}/${n}: el controlador no habla con la base ni con la red`);
    }
  }
  return fallas;
}

test('módulos por dominio: cumplen las mismas reglas de capas que src/api/v1', () => {
  assert.deepEqual(revisarModulos(join(SRC, 'modulos')), []);
});

test('módulos por dominio: la revisión detecta un módulo que rompe las reglas', t => {
  const raiz = mkdtempSync(join(tmpdir(), 'modulos-')); t.after(() => rmSync(raiz, { recursive: true, force: true }));
  mkdirSync(join(raiz, 'roto')); mkdirSync(join(raiz, 'compartido'));
  writeFileSync(join(raiz, 'roto', 'roto.routes.js'), "import { x } from './roto.service';\nrouter.get('/', x);");
  writeFileSync(join(raiz, 'roto', 'roto.service.js'), 'export const x = (req, res) => res.json({});');
  writeFileSync(join(raiz, 'compartido', 'util.js'), 'export const v = process.env.X;');
  const fallas = revisarModulos(raiz).join('\n');
  for (const p of [/usa registrar/, /no habla con servicios/, /falta roto\.schema\.js/, /falta roto\.controller\.js/, /no debe conocer HTTP/, /compartido debe ser puro/]) assert.match(fallas, p);
});

test('cada módulo CRUD tiene su modelo, servicio, controlador y ruta, y se usan', () => {
  for (const n of Object.keys(resources).filter(x => !['sesiones', 'screener'].includes(x))) {
    assert.match(lee(`api/v1/services/${n}.service.js`), /forRepository/, n);
    assert.match(lee(`api/v1/controllers/${n}.controller.js`), new RegExp(`services/${n}\\.service`), n);
    assert.match(lee(`api/v1/routes/${n}.routes.js`), new RegExp(`controllers/${n}\\.controller`), n);
    assert.match(lee('api/v1/routes/index.js'), new RegExp(`'/${n}'`), n);
  }
});

test('validación: mensajes en español con el campo, y los tipos llegan convertidos', async () => {
  const s = await servidor();
  try {
    const caso = async (metodo, ruta, body, patron, headers) => { const r = await s.pedir(metodo, ruta, body, headers); assert.equal(r.status, 400, ruta + ' ' + r.json?.message); assert.match(r.json.message, patron); };
    await caso('POST', '/sincronizaciones/ejecuciones', { recurso: 'x' }, /recurso inválido\. Usa: empresas/);
    await caso('POST', '/sincronizaciones/ejecuciones', { recurso: 'ordenes' }, /conexionId: requerido/);
    await caso('POST', '/sincronizaciones/ejecuciones', { recurso: 'empresas', simbolos: ['A B'] }, /símbolo inválido/);
    await caso('POST', '/sincronizaciones/ejecuciones', { recurso: 'empresas', simbolos: Array.from({ length: 26 }, (_, i) => 'A' + i) }, /hasta 25/);
    await caso('POST', '/ordenes/ticket', { empresaId: 'x' }, /Idempotency-Key/);
    await caso('POST', '/ordenes/ticket', { empresaId: 'x', tipo: 'limit', cantidad: 0, componentes: [] }, /cantidad/, { 'Idempotency-Key': 'clave-12345' });
    await caso('GET', '/mercado/opciones/velas/nada', undefined, /OCC/); await caso('GET', '/mercado/eventos/A%20B', undefined, /símbolo inválido/); await caso('GET', '/broker/paper/historial?periodo=9Z', undefined, /periodo/);
    await caso('POST', '/cores/tecnico/evaluaciones', [1], /esperaba objeto/);
    const r = await s.pedir('POST', '/sincronizaciones/ejecuciones', { recurso: 'contratos', simbolos: [' aapl ', 'AAPL'], diasVencimientoMin: '7' });
    assert.equal(r.status, 202); assert.deepEqual(r.json.data.simbolos, ['AAPL']); assert.equal(r.json.data.diasVencimientoMin, 7);
    assert.equal((await s.pedir('GET', '/broker/paper/historial?broker=webull')).json.data.disponible, false);
  } finally { s.cerrar(); }
});

test('OpenAPI: los recursos de solo lectura no prometen escritura y la contraseña se marca como tal', () => {
  const p = openapi().paths;
  for (const r of ['/posiciones', '/auditoria']) { assert.ok(p[r].get); assert.equal(p[r].post, undefined); assert.equal(p[r + '/lote'], undefined); }
  assert.equal(p['/ordenes/{id}/eventos'].post, undefined); assert.ok(p['/configuraciones/{id}/componentes'].post);
  assert.equal(p['/sesiones'].post.requestBody.content['application/json'].schema.properties.password.format, 'password'); assert.deepEqual(p['/sesiones'].post.security, []);
  assert.ok(p['/ordenes/ticket'].post.parameters.some(x => x.name === 'Idempotency-Key' && x.in === 'header' && x.required));
});

test('contrato de brokers: Alpaca y Webull lo cumplen; a quien le falte algo no arranca', () => {
  const i = createIntegrations({});
  for (const b of [i.alpaca, i.webull]) for (const m of Object.keys(METODOS_BROKER)) assert.equal(typeof b[m], 'function', b.proveedor + '.' + m);
  assert.throws(() => exigirContratoBroker({ ...i.webull, cancelarOrden: undefined }), /falta cancelarOrden/); assert.throws(() => exigirContratoBroker({ ...i.webull, entorno: 'live' }), /paper/);
});
