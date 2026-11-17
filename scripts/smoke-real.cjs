// Prueba real opt-in del flujo funcional: proveedores reales (Alpaca paper, SEC) + base real.
// Usa un usuario temporal UUID y elimina todos sus registros al terminar. No envía órdenes.
// Uso: npm run build && node scripts/smoke-real.cjs mongodb AAPL [--institucional]
require('dotenv').config({ quiet: true });
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = require('../dist/repositories');
const { resources } = require('../dist/repositories/resources');
const { closeMongo } = require('../dist/config/database.config');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const prefix = require('../dist/config/config').default.API_URL;

const [database = 'mongodb', simbolo = 'AAPL'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const conInstitucional = process.argv.includes('--institucional');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!['mongodb', 'supabase'].includes(database)) throw new Error('Base inválida.');
  const userId = randomUUID(), password = 'Tmp-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 'smoke-' + userId + '@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [user]), quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  let token;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json(); if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + j.message); return j.data;
  };
  const esperar = async (path, maxMs = 600000) => {
    const t0 = Date.now();
    for (;;) { const d = await call('GET', path); if (['completada', 'fallida'].includes(d.estado)) return { ...d, ms: Date.now() - t0 }; if (Date.now() - t0 > maxMs) throw new Error('Tiempo agotado ' + path); await sleep(1000); }
  };
  try {
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: database })).token;
    const recursos = ['empresas', 'historicos', 'cotizaciones', 'noticias', 'fundamentales', 'contratos', ...(conInstitucional ? ['institucional'] : [])];
    for (const recurso of recursos) {
      const s = await call('POST', '/sincronizaciones/ejecuciones', { recurso, simbolos: [simbolo] });
      const fin = await esperar('/sincronizaciones/' + s._id);
      console.log('sync', recurso.padEnd(13), fin.estado, 'procesados=' + fin.procesados, (fin.ms / 1000).toFixed(1) + 's', fin.error || '');
    }
    const empresa = (await call('GET', '/empresas')).items[0];
    console.log('empresa', empresa.simbolo, empresa.nombre, empresa.mercado, 'cik=' + empresa.cik);
    const cores = ['tecnico', 'indicadores', 'fundamental', 'noticias', ...(conInstitucional ? ['institucional'] : [])];
    for (const core of cores) {
      const e = await call('POST', '/cores/' + core + '/evaluaciones', { empresaId: empresa._id });
      const f = await esperar('/cores/' + core + '/evaluaciones/' + e._id);
      const m = Object.fromEntries(f.metricas.map(x => [x.nombre, x.valor]));
      console.log('core', core.padEnd(13), f.estado, 'puntaje=' + f.puntaje, 'cobertura=' + f.cobertura, 'sesgo=' + m.sesgo, 'confianza=' + m.confianza, f.error || '');
      console.log('    motivos:', f.motivos.slice(0, 4).join(' | '));
      if (f.datosFaltantes.length) console.log('    faltantes:', f.datosFaltantes.join(', '));
    }
    const sel = await call('POST', '/selecciones/ejecuciones', { modo: 'empresa', empresaId: empresa._id, coresSeleccionados: cores });
    const sf = await esperar('/selecciones/' + sel._id);
    const est = new Map((await call('GET', '/estrategias')).items.map(e => [e._id, e.codigo]));
    console.log('seleccion', sf.estado, (sf.ms / 1000).toFixed(1) + 's', sf.error || '');
    for (const r of sf.resultados) console.log('   ', est.get(r.estrategiaId).padEnd(12), 'compatibilidad=' + r.puntaje, 'cobertura=' + r.cobertura, '|', r.motivos.slice(0, 2).join(' | '));
  } finally {
    server.close();
    let n = 0;
    for (const name of Object.keys(resources)) {
      const repo = repository(name, { userId, database });
      for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const r of rows) { await repo.remove(r._id, r.revision); n++; } }
    }
    console.log('limpieza: ' + n + ' registros temporales eliminados');
    await closeMongo();
  }
})().catch(e => { console.error('Prueba real falló:', e.message); process.exitCode = 1; });
