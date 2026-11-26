// Smoke test post-despliegue: comprobaciones rápidas de que lo esencial funciona en la URL publicada.
// Uso:  node scripts/smoke-despliegue.cjs https://<tu-app>.onrender.com
//       SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-despliegue.cjs <url>   (además prueba una sesión real)
// Sale con código 1 si algo falla. La primera solicitud tolera el arranque en frío del plan gratuito de Render (hasta 90 s).
const base = (process.argv[2] || process.env.BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('Indica la URL: node scripts/smoke-despliegue.cjs https://<app>.onrender.com'); process.exit(2); }

const resultados = [];
async function paso(nombre, fn) {
  const t0 = Date.now();
  try { const detalle = await fn(); resultados.push({ ok: true, nombre, ms: Date.now() - t0, detalle: detalle || '' }); }
  catch (e) { resultados.push({ ok: false, nombre, ms: Date.now() - t0, detalle: e.message }); }
}
const pedir = (ruta, init = {}, ms = 15000) => fetch(base + ruta, { ...init, signal: AbortSignal.timeout(ms) });
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  await paso('Liveness /health (arranque en frío)', async () => { const r = await pedir('/health', {}, 90000); exigir(r.status === 200, 'status ' + r.status); return (await r.json()).status; });
  await paso('Readiness /health/listo', async () => {
    const r = await pedir('/health/listo'); const b = await r.json();
    exigir(r.status === 200, `status ${r.status} (${b.motivo || 'sin motivo'})`);
    return `bases: ${Object.entries(b.dependencias).map(([k, v]) => k + '=' + v.estado).join(', ')}${b.degradado ? ' · DEGRADADO' : ''}`;
  });
  await paso('Web (SPA) en /', async () => { const r = await pedir('/'); const t = await r.text(); exigir(r.status === 200 && t.includes('id="root"'), 'no entrega la SPA'); return 'index.html'; });
  await paso('PWA: manifest y service worker', async () => {
    const m = await pedir('/manifest.webmanifest'); exigir(m.status === 200 && /manifest\+json/.test(m.headers.get('content-type')), 'manifest ' + m.status);
    const s = await pedir('/sw.js'); exigir(s.status === 200 && s.headers.get('cache-control') === 'no-cache', 'sw.js ' + s.status + ' ' + s.headers.get('cache-control'));
    return 'manifest + sw.js sin caché';
  });
  await paso('API raíz y OpenAPI', async () => { const r = await pedir('/api/v1/openapi.json'); exigir(r.status === 200, 'status ' + r.status); return Object.keys((await r.json()).paths).length + ' rutas documentadas'; });
  await paso('Autenticación activa (sin token → 401)', async () => { const r = await pedir('/api/v1/empresas'); exigir(r.status === 401, 'status ' + r.status); return '401'; });
  await paso('Cabeceras de seguridad', async () => {
    const r = await pedir('/api/v1/empresas'); const h = n => r.headers.get(n);
    exigir(h('x-content-type-options') === 'nosniff' && h('content-security-policy') && !h('x-powered-by'), 'faltan cabeceras');
    return 'nosniff, CSP, sin X-Powered-By';
  });
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    let token;
    await paso('Sesión real (login)', async () => {
      const r = await pedir('/api/v1/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD, baseDatos: process.env.SMOKE_BASE || 'mongodb' }) });
      exigir(r.status === 200, 'status ' + r.status); token = (await r.json()).data.token; return 'token emitido';
    });
    if (token) {
      const H = { Authorization: 'Bearer ' + token };
      await paso('Integraciones y circuitos', async () => {
        const r = await pedir('/api/v1/integraciones/estado', { headers: H }); exigir(r.status === 200, 'status ' + r.status);
        const d = (await r.json()).data; return Object.entries(d).map(([k, v]) => `${k}:${v.configurado ? 'ok' : 'sin config'}/${v.circuito?.estado}`).join(' ');
      });
      await paso('Cerrar sesión', async () => { const r = await pedir('/api/v1/sesiones/actual', { method: 'DELETE', headers: H }); exigir(r.status === 204, 'status ' + r.status); return '204'; });
    }
  }
  const ancho = Math.max(...resultados.map(r => r.nombre.length));
  console.log(`\nSmoke post-despliegue · ${base}\n`);
  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.nombre.padEnd(ancho)} ${String(r.ms).padStart(6)} ms  ${r.detalle}`);
  const fallas = resultados.filter(r => !r.ok).length;
  console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones correctas`);
  process.exitCode = fallas ? 1 : 0;
})();
