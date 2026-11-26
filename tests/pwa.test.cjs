// PWA (openspec: aplicacion-web-pwa): qué intercepta el service worker y cómo queda el sw.js compilado.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ORIGEN = 'https://winopciones.example';
const PWA = path.join(__dirname, '..', 'web', 'src', 'pwa');
const DIST = path.join(__dirname, '..', 'web', 'dist');
const cargarReglas = () => import(pathToFileURL(path.join(PWA, 'reglas.js')).href);
const cargarGenerador = () => import(pathToFileURL(path.join(PWA, 'generar-sw.js')).href);
const leer = archivo => fs.readFileSync(path.join(PWA, archivo), 'utf8');

test('PWA: la API, /health, la documentación, SSE, otros métodos y otros orígenes nunca se interceptan', async () => {
  const { decidirSolicitud: d } = await cargarReglas();
  const nulos = [
    { url: ORIGEN + '/api/v1/broker/paper/resumen' },
    { url: ORIGEN + '/api/v1' },
    { url: ORIGEN + '/api' },
    { url: ORIGEN + '/api/v1/api-docs/' },
    { url: ORIGEN + '/api/v1/openapi.json' },
    { url: ORIGEN + '/health' },
    { url: ORIGEN + '/sw.js' },
    { url: ORIGEN + '/api/v1/ordenes/x/seguimiento', accept: 'text/event-stream' },
    { url: ORIGEN + '/cualquier-ruta', accept: 'text/event-stream', mode: 'navigate' },
    { url: ORIGEN + '/api/v1/ordenes/ticket', method: 'POST' },
    { url: ORIGEN + '/assets/index-abc.js', method: 'PUT' },
    { url: ORIGEN + '/api/v1/empresas/1', method: 'DELETE' },
    { url: 'https://otro.example/assets/index-abc.js' },
    { url: 'https://otro.example/', mode: 'navigate' },
    { url: 'no es una url' },
    { url: ORIGEN + '/api/v1/empresas', mode: 'navigate' },
    { url: ORIGEN + '/manifest.webmanifest' },
  ];
  for (const s of nulos) assert.equal(d(s, ORIGEN), null, JSON.stringify(s));
});

test('PWA: /assets con hash es cáscara y las páginas de la SPA son navegación', async () => {
  const { decidirSolicitud: d } = await cargarReglas();
  assert.equal(d({ url: ORIGEN + '/assets/index-BSHKH4KX.js' }, ORIGEN), 'cascara');
  assert.equal(d({ url: ORIGEN + '/assets/index-abc.css', method: 'get' }, ORIGEN), 'cascara');
  assert.equal(d({ url: ORIGEN + '/analisis/AAPL', mode: 'navigate', accept: 'text/html' }, ORIGEN), 'navegacion');
  assert.equal(d({ url: ORIGEN + '/', mode: 'navigate' }, ORIGEN), 'navegacion');
});

test('PWA: sw.js generado sin marcadores, con las reglas, la precarga y una versión que cambia con el contenido', async () => {
  const { generarServiceWorker } = await cargarGenerador();
  const base = { plantilla: leer('sw.plantilla.js'), reglas: leer('reglas.js'), archivos: ['index.html', 'assets/b-2.css', 'assets/a-1.js', 'icons/icon.svg'], html: '<html>1</html>' };
  const a = generarServiceWorker(base);
  assert.doesNotMatch(a.codigo, /__(VERSION|PRECACHE|REGLAS)__|\/\* global|^export /m);
  assert.match(a.codigo, /function decidirSolicitud\(/);
  assert.deepEqual(a.precache, ['/', '/index.html', '/assets/a-1.js', '/assets/b-2.css']);
  assert.ok(a.codigo.includes(`const CACHE = PREFIJO + "${a.version}";`));
  new vm.Script(a.codigo); // sintaxis válida
  assert.equal(generarServiceWorker(base).version, a.version, 'misma entrada → misma versión');
  for (const cambio of [{ html: '<html>2</html>' }, { archivos: ['assets/a-9.js'] }, { reglas: base.reglas + '\n// cambio' }]) {
    assert.notEqual(generarServiceWorker({ ...base, ...cambio }).version, a.version, JSON.stringify(Object.keys(cambio)));
  }
  assert.throws(() => generarServiceWorker({ ...base, plantilla: 'self.addEventListener("fetch", () => {});' }), /no se encontró/);
});

test('PWA: el sw.js compilado (si existe web/dist) precarga index.html y todos los archivos de /assets', { skip: !fs.existsSync(path.join(DIST, 'sw.js')) && 'sin web/dist/sw.js' }, () => {
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /__(VERSION|PRECACHE|REGLAS)__/);
  const precache = JSON.parse(sw.match(/^const PRECACHE = (\[.*\]);$/m)[1]);
  const assets = fs.readdirSync(path.join(DIST, 'assets')).map(f => '/assets/' + f).sort();
  assert.deepEqual(precache, ['/', '/index.html', ...assets]);
});
