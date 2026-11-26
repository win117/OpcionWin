// Ejecuta OWASP ZAP (tests/seguridad/zap-plan.yaml) contra el servidor de pruebas. Lo llama `npm run test:seguridad`
// a través de scripts/con-servidor-pruebas.cjs (que define BASE_URL). Requiere ZAP instalado y Java 17+:
//   ZAP_HOME=<carpeta de ZAP>  (la que contiene zap.bat / zap.sh)
// Inicia sesión con el usuario de pruebas y pasa el token a ZAP por variable de entorno (ZAP_AUTH_HEADER_VALUE; no se escribe en disco).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const base = process.env.BASE_URL || 'http://127.0.0.1:3040';
const zapHome = process.env.ZAP_HOME;
if (!zapHome) { console.error('Define ZAP_HOME con la carpeta de OWASP ZAP (la que contiene zap.bat o zap.sh).'); process.exit(2); }
const reportes = path.resolve(process.env.REPORTES || path.join(__dirname, '..', 'output', 'pruebas'));
fs.mkdirSync(reportes, { recursive: true });

(async () => {
  const r = await fetch(base + '/api/v1/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.EMAIL || 'prueba@local', password: process.env.PASSWORD || 'clave-de-pruebas', baseDatos: 'mongodb' }) });
  if (!r.ok) { console.error('No se pudo iniciar sesión en el servidor de pruebas:', r.status); process.exit(1); }
  const token = (await r.json()).data.token;
  const ejecutable = path.join(zapHome, process.platform === 'win32' ? 'zap.bat' : 'zap.sh');
  // Carpeta de configuración de ZAP nueva en cada escaneo: sin reglas ni estado heredado de ejecuciones anteriores.
  const hogar = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-home-'));
  const zap = spawn(ejecutable, ['-cmd', '-dir', hogar, '-autorun', path.join(__dirname, '..', 'tests', 'seguridad', 'zap-plan.yaml')], {
    cwd: zapHome, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, BASE_URL: base, REPORTES: reportes,
      // Mecanismo oficial de ZAP para autenticar por cabecera en TODAS sus solicitudes (importación, pasivo y activo).
      ZAP_AUTH_HEADER: 'Authorization', ZAP_AUTH_HEADER_VALUE: 'Bearer ' + token },
  });
  zap.on('exit', codigo => {
    fs.rmSync(hogar, { recursive: true, force: true });
    console.log(`Reportes en ${reportes} (zap-api.html, zap-api.json)`); process.exit(codigo ?? 1);
  });
})();
