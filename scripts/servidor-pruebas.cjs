// Servidor de pruebas determinista para E2E (Newman), carga (k6) y seguridad (OWASP ZAP).
// Es la app compilada real (dist/), pero con base en memoria, un usuario de prueba fijo y proveedores sin credenciales:
// no toca las bases reales del .env ni consume cuota de Alpaca/SEC. Requiere `npm run build` antes.
//
// Uso:  node scripts/servidor-pruebas.cjs            (puerto 3040)
//       PORT_PRUEBAS=4000 node scripts/servidor-pruebas.cjs
// Usuario: prueba@local / clave-de-pruebas  (base: mongodb, que aquí es la memoria)
const path = require('node:path');
const { scryptSync } = require('node:crypto');
const raiz = path.join(__dirname, '..');
const { memoryFactory } = require(path.join(raiz, 'tests/helpers/memory.cjs'));
const { createApp } = require(path.join(raiz, 'dist/app'));
const { createSessionService } = require(path.join(raiz, 'dist/api/v1/services/sesiones.service'));
const { createIntegrations } = require(path.join(raiz, 'dist/integrations'));
const { createCola } = require(path.join(raiz, 'dist/jobs/cola'));

const USUARIO = { id: '00000000-0000-4000-8000-000000000001', // el token exige un UUID
   email: 'prueba@local', salt: 'sal-de-pruebas' };
USUARIO.passwordHash = scryptSync('clave-de-pruebas', USUARIO.salt, 64).toString('hex');

const puerto = Number(process.env.PORT_PRUEBAS || 3040);
const factory = memoryFactory();
const app = createApp({
  factory,
  auth: createSessionService(factory, async () => [USUARIO]),
  integraciones: createIntegrations({}), // sin credenciales: los endpoints de proveedores responden 503 claro, sin red
  cola: createCola(),
  quiet: !process.env.VERBOSE,
  // webDir sin indicar: sirve web/dist si existe (para el smoke de la SPA y la PWA).
  salud: { comprobaciones: { memoria: async () => {} } },
});
const server = app.listen(puerto, '127.0.0.1', () => console.log(`Servidor de pruebas en http://127.0.0.1:${puerto} (usuario ${USUARIO.email})`));
const cerrar = () => server.close(() => process.exit(0));
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
