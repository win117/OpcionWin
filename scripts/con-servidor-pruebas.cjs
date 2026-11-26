// Levanta el servidor de pruebas (scripts/servidor-pruebas.cjs), espera a /health, ejecuta el comando indicado y lo apaga.
// Devuelve el código de salida del comando. Lo usan test:e2e (Newman), test:carga (k6) y test:seguridad (OWASP ZAP).
// Uso: node scripts/con-servidor-pruebas.cjs <comando> [argumentos...]      (PORT_PRUEBAS para otro puerto)
const { spawn } = require('node:child_process');
const path = require('node:path');

const puerto = process.env.PORT_PRUEBAS || '3040';
const [comando, ...args] = process.argv.slice(2);
if (!comando) { console.error('Indica el comando a ejecutar.'); process.exit(2); }

const base = `http://127.0.0.1:${puerto}`;
let servidor;
const detener = () => { if (servidor && servidor.exitCode === null) servidor.kill(); };
process.on('exit', detener);

(async () => {
  // Si algo ya escucha en el puerto, las pruebas usarían ese servidor (con otros datos) sin avisar: se falla de inmediato.
  const ocupado = await fetch(base + '/health').then(() => true, () => false);
  if (ocupado) { console.error(`El puerto ${puerto} ya está en uso: cierra ese proceso o usa PORT_PRUEBAS con otro puerto.`); process.exit(1); }
  servidor = spawn(process.execPath, [path.join(__dirname, 'servidor-pruebas.cjs')], { env: { ...process.env, PORT_PRUEBAS: puerto }, stdio: ['ignore', 'inherit', 'inherit'] });
  servidor.on('exit', codigo => { if (codigo) { console.error('El servidor de pruebas terminó con código ' + codigo + '.'); process.exit(1); } });
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* aún no escucha */ }
    if (i > 100) { console.error('El servidor de pruebas no arrancó.'); process.exit(1); }
    await new Promise(r => setTimeout(r, 100));
  }
  // Windows necesita la consola para npx/k6 (.cmd): se arma un solo comando con los argumentos entre comillas.
  const env = { ...process.env, BASE_URL: base };
  const comillas = a => /[\s"&|<>^]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a;
  const hijo = process.platform === 'win32'
    ? spawn([comando, ...args].map(comillas).join(' '), { stdio: 'inherit', shell: true, env })
    : spawn(comando, args, { stdio: 'inherit', env });
  hijo.on('exit', codigo => { detener(); process.exit(codigo ?? 1); });
})();
