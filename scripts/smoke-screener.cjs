// Prueba real opt-in del universo vivo (mapa, ficha, movimientos, ranking) y del estado de mercado: Alpaca, SEC y base reales. No envía órdenes.
// Usa un usuario temporal UUID y elimina todos sus registros al terminar.
// Uso: npm run build && node scripts/smoke-screener.cjs mongodb|supabase
require('dotenv').config({ quiet: true });
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = require('../dist/repositories');
const { resources } = require('../dist/repositories/resources');
const { closeMongo } = require('../dist/config/database.config');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { createApp } = require('../dist/app');
const prefix = require('../dist/config/config').default.API_URL;

const [database = 'mongodb'] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!['mongodb', 'supabase'].includes(database)) throw new Error('Base inválida.');
  const userId = randomUUID(), password = 'Tmp-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 'smoke-' + userId + '@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [user]), quiet: true, webDir: null });
  const { universo } = app.locals;
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
    console.log('mercado', estado.abierto ? 'abierto' : 'cerrado', estado.indices.map(i => i.simbolo + ' (' + i.nombre + ')=' + i.precio).join(' '));
    console.log('brokers', (await call('GET', '/brokers/disponibles')).items.map(b => b.codigo + ':' + (b.operativo ? 'operativo' : 'sin credenciales')).join(' '));
    const t0 = Date.now();
    universo.iniciar();
    while (!universo.listo()) {
      if (Date.now() - t0 > 540000) throw new Error('Tiempo agotado. ' + JSON.stringify(universo.estado()));
      await sleep(1500);
    }
    console.log('universo listo en', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(universo.estado()));
    const mapa = await call('GET', '/mercado/mapa');
    const completas = mapa.items.filter(i => i.precio > 0 && i.nombre && i.capitalizacion > 0);
    console.log('mapa', mapa.total, 'empresas;', completas.length, 'con precio, nombre y capitalización; desactualizado:', mapa.desactualizado);
    if (!completas.length) throw new Error('El mapa quedó vacío.');
    const { simbolo } = mapa.items.reduce((a, b) => ((b.capitalizacion ?? 0) > (a.capitalizacion ?? 0) ? b : a));
    const ficha = await call('GET', '/mercado/mapa/' + simbolo);
    console.log('ficha', simbolo, ficha.precio, ficha.velas.length, 'velas');
    if (ficha.simbolo !== simbolo || !ficha.velas.length) throw new Error('La ficha está incompleta.');
    const mov = await call('GET', '/mercado/movimientos');
    console.log('movimientos', 'alzas=' + mov.alzas.length, 'bajas=' + mov.bajas.length, 'volumen=' + mov.volumenInusual.map(i => i.simbolo + '×' + i.volumenRelativo).slice(0, 3).join(' '));
    const r = await call('GET', '/screener/ranking?limite=3');
    for (const [e, items] of Object.entries(r.estrategias)) console.log('ranking', e.padEnd(12), items.map(i => i.simbolo + ' ' + i.puntaje).join(' | '));
    if (!r.universo.total) throw new Error('El ranking quedó vacío.');
  } finally {
    universo.detener();
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
