// Prueba real opt-in del screener y del estado de mercado: Alpaca real + base real. No envía órdenes.
// Usa un usuario temporal UUID y elimina todos sus registros al terminar.
// Uso: npm run build && node scripts/smoke-screener.cjs mongodb|supabase [limite=10]
require('dotenv').config({ quiet: true });
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = require('../dist/repositories');
const { resources } = require('../dist/repositories/resources');
const { closeMongo } = require('../dist/config/database.config');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const prefix = require('../dist/config/config').default.API_URL;

const [database = 'mongodb', limite = '10'] = process.argv.slice(2);
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
  try {
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: database })).token;
    const estado = await call('GET', '/mercado/estado');
    console.log('mercado', estado.abierto ? 'abierto' : 'cerrado', estado.indices.map(i => i.simbolo + '=' + i.precio).join(' '));
    console.log('brokers', (await call('GET', '/brokers/disponibles')).items.map(b => b.codigo + ':' + (b.operativo ? 'operativo' : 'sin credenciales')).join(' '));
    const t0 = Date.now();
    let s = await call('POST', '/screener/universo/sincronizaciones', { limite: Number(limite) });
    while (!['completada', 'fallida'].includes(s.estado)) {
      if (Date.now() - t0 > 540000) throw new Error('Tiempo agotado.');
      await sleep(1500); s = await call('GET', '/screener/universo/sincronizaciones/' + s._id);
    }
    console.log('universo', s.estado, s.procesados + '/' + s.total, 'fallidos=' + s.fallidos, ((Date.now() - t0) / 1000).toFixed(1) + 's', s.error || '');
    if (s.estado !== 'completada') throw new Error('La sincronización del universo no se completó.');
    const r = await call('GET', '/screener/ranking?limite=3');
    for (const [e, items] of Object.entries(r.estrategias)) console.log('ranking', e.padEnd(12), items.map(i => i.simbolo + ' ' + i.puntaje).join(' | '));
    if (!r.universo.total) throw new Error('El ranking quedó vacío.');
  } finally {
    server.close();
    let n = 0;
    for (const name of Object.keys(resources)) {
      try {
        const repo = repository(name, { userId, database });
        for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const r of rows) { await repo.remove(r._id, r.revision); n++; } }
      } catch (e) { console.log('limpieza', name, e.message); }
    }
    console.log('limpieza: ' + n + ' registros temporales eliminados');
    await closeMongo();
  }
})().catch(e => { console.error('Falló:', e.message); process.exitCode = 1; });
