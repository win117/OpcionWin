// Pruebas de contrato dirigidas por el consumidor (estilo Pact): tests/contrato/web-api.contrato.json declara lo que la web
// necesita de cada respuesta y aquí se verifica contra el proveedor real (la API compilada, con base en memoria).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createIntegrations } = require('../dist/integrations');
const { createCola } = require('../dist/jobs/cola');
const API = require('../dist/config/config').default.API_URL;

const RAIZ = path.join(__dirname, '..');
const contrato = JSON.parse(fs.readFileSync(path.join(__dirname, 'contrato', 'web-api.contrato.json'), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Compara un valor con un comparador del contrato. Devuelve la lista de diferencias con su ruta (data.items[0]._id…). */
function comparar(valor, esperado, ruta = 'cuerpo') {
  const mal = msg => [`${ruta}: ${msg} (recibido ${JSON.stringify(valor)?.slice(0, 80)})`];
  if (esperado === 'ausente') return valor === undefined ? [] : mal('no debe existir');
  if (valor === undefined) return [`${ruta}: falta`];
  if (esperado === 'string') return typeof valor === 'string' ? [] : mal('se esperaba texto');
  if (esperado === 'number') return typeof valor === 'number' ? [] : mal('se esperaba número');
  if (esperado === 'boolean') return typeof valor === 'boolean' ? [] : mal('se esperaba booleano');
  if (esperado === 'array') return Array.isArray(valor) ? [] : mal('se esperaba arreglo');
  if (esperado === 'object') return valor && typeof valor === 'object' && !Array.isArray(valor) ? [] : mal('se esperaba objeto');
  if (esperado === 'uuid') return UUID.test(valor) ? [] : mal('se esperaba UUID');
  if (esperado === 'iso-date') return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)) ? [] : mal('se esperaba fecha ISO');
  if (esperado && typeof esperado === 'object' && !Array.isArray(esperado)) {
    if ('oneOf' in esperado) return esperado.oneOf.includes(valor) ? [] : mal('se esperaba uno de ' + esperado.oneOf.join(', '));
    if ('regex' in esperado) return typeof valor === 'string' && new RegExp(esperado.regex).test(valor) ? [] : mal('no cumple ' + esperado.regex);
    if ('cadaElemento' in esperado) {
      if (!Array.isArray(valor)) return mal('se esperaba arreglo');
      return valor.flatMap((v, i) => comparar(v, esperado.cadaElemento, `${ruta}[${i}]`));
    }
    if (!valor || typeof valor !== 'object') return mal('se esperaba objeto');
    return Object.entries(esperado).flatMap(([k, e]) => comparar(valor[k], e, `${ruta}.${k}`));
  }
  return valor === esperado ? [] : mal('se esperaba ' + JSON.stringify(esperado));
}

const leerRuta = (obj, ruta) => ruta.split('.').reduce((o, k) => o?.[k], obj);
const sustituir = (texto, vars) => JSON.parse(JSON.stringify(texto).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''));

async function proveedor(t) {
  const u = randomUUID(), factory = memoryFactory();
  const auth = createSessionService(factory, async () => [{ id: u, email: 'pact@local', salt: u, passwordHash: scryptSync('clave', u, 64).toString('hex') }]);
  const app = createApp({ factory, auth, integraciones: createIntegrations({}), cola: createCola(), quiet: true, webDir: null, salud: { comprobaciones: { memoria: async () => {} } } });
  const s = app.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => { s.closeAllConnections(); s.close(); });
  return 'http://127.0.0.1:' + s.address().port;
}

async function verificar(base, interacciones) {
  const vars = { email: 'pact@local', password: 'clave' }, fallas = [];
  for (const it of interacciones) {
    const sol = sustituir(it.solicitud, vars);
    const headers = { ...(sol.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(sol.sesion ? { Authorization: 'Bearer ' + vars.token } : {}) };
    const r = await fetch(base + (sol.fueraDeApi ? '' : API) + sol.ruta, { method: sol.metodo, headers, body: sol.cuerpo === undefined ? undefined : JSON.stringify(sol.cuerpo) });
    const texto = await r.text(), cuerpo = texto ? JSON.parse(texto) : undefined;
    const dif = [];
    if (r.status !== it.respuesta.status) dif.push(`status: se esperaba ${it.respuesta.status}, recibido ${r.status}`);
    for (const [h, e] of Object.entries(it.respuesta.headers || {})) dif.push(...comparar(r.headers.get(h) ?? undefined, e, 'header ' + h));
    if (it.respuesta.cuerpo) dif.push(...comparar(cuerpo, it.respuesta.cuerpo));
    else if (it.respuesta.status === 204 && texto) dif.push('204 con cuerpo');
    if (dif.length) fallas.push(`«${it.descripcion}»\n    ` + dif.join('\n    '));
    for (const [k, ruta] of Object.entries(it.guardar || {})) vars[k] = leerRuta(cuerpo, ruta);
  }
  return fallas;
}

test('contrato web ↔ API: el proveedor cumple todas las interacciones que declara el consumidor', async t => {
  const fallas = await verificar(await proveedor(t), contrato.interacciones);
  assert.deepEqual(fallas, [], 'El proveedor rompió el contrato:\n' + fallas.join('\n'));
});

test('contrato: cada interacción declara el archivo del consumidor que la usa y ese archivo menciona la ruta', () => {
  for (const it of contrato.interacciones) {
    assert.ok(it.usadoEn, it.descripcion);
    if (!it.usadoEn.startsWith('web/')) continue; // consumidores externos (monitor)
    const fuente = fs.readFileSync(path.join(RAIZ, it.usadoEn), 'utf8') + fs.readFileSync(path.join(RAIZ, 'web/src/api/resources.js'), 'utf8') + fs.readFileSync(path.join(RAIZ, 'web/src/api/client.js'), 'utf8');
    const segmento = it.solicitud.ruta.split('?')[0].split('/').filter(p => p && !p.startsWith('{{'))[0];
    assert.match(fuente, new RegExp(segmento), `${it.usadoEn} (o el cliente de la API) ya no usa /${segmento}`);
  }
});

test('contrato: el verificador detecta un proveedor que no cumple', async t => {
  const roto = JSON.parse(JSON.stringify(contrato.interacciones.slice(0, 2)));
  roto[0].respuesta.cuerpo.data.tokenType = 'Basic';           // valor distinto
  roto[1].respuesta.cuerpo.data.campoQueNoExiste = 'string';   // campo que el proveedor no entrega
  const fallas = (await verificar(await proveedor(t), roto)).join('\n');
  assert.match(fallas, /tokenType: se esperaba "Basic"/);
  assert.match(fallas, /campoQueNoExiste: falta/);
});
