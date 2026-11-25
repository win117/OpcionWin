// Prueba real opt-in del ciclo de orden en Alpaca PAPER: conexión → verificación → orden limit 1 contrato a 0.01 (no se ejecuta)
// → envío → reenvío idempotente → sincronización → cancelación → posiciones. Usuario temporal; limpia sus registros.
// Uso: npm run build && node scripts/smoke-orden-paper.cjs [mongodb|supabase]
process.chdir(require('node:path').resolve(__dirname, '..'));
require(process.cwd() + '/node_modules/dotenv').config({ quiet: true });
const R = p => require(process.cwd() + '/dist/' + p);
const { once } = require('node:events'); const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = R('repositories'); const { resources } = R('repositories/resources');
const { closeMongo } = R('config/database.config'); const { createSessionService } = R('api/v1/services/sesiones.service');
const { createApp } = R('app'); const prefix = R('config/config').default.API_URL; const { createIntegrations } = R('integrations');
const DB = process.argv[2] || 'mongodb', S = 'AAPL', sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const userId = randomUUID(), password = 'Tmp-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 'o-' + userId + '@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [user]), quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix; let token;
  const call = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { ...h, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + j.message); return j.data; };
  const wait = async p => { for (;;) { const d = await call('GET', p); if (['completada','fallida'].includes(d.estado)) return d; await sleep(1000); } };
  const sync = async b => { const f = await wait('/sincronizaciones/' + (await call('POST', '/sincronizaciones/ejecuciones', b))._id); console.log('sync', b.recurso, f.estado, f.procesados, f.fallidos, f.error || ''); return f; };
  let ordenExterna;
  try {
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: DB })).token;
    await call('POST', '/estrategias/catalogo-base');
    for (const r of ['empresas', 'cotizaciones', 'contratos']) await sync({ recurso: r, simbolos: [S] });
    const empresa = (await call('GET', '/empresas?simbolo=' + S)).items[0];
    const longCall = (await call('GET', '/estrategias?codigo=LONG_CALL')).items[0];
    const brokers = (await call('GET', '/brokers?codigo=alpaca')).items;
    const broker = brokers[0] || await call('POST', '/brokers', { codigo: 'alpaca', nombre: 'Alpaca', activo: true, entornos: ['paper'] });
    const conexion = await call('POST', '/conexiones-broker', { brokerId: broker._id, alias: 'Paper prueba', entorno: 'paper', credencialRef: 'env:ALPACA' });
    const v = await call('POST', '/conexiones-broker/' + conexion._id + '/verificacion');
    console.log('verificacion', v.estadoConexion, 'cuenta', v.estado || v.estadoCuenta, 'nivel opciones', v.nivelOpciones ?? v.options_trading_level, 'poder compra', v.poderCompra ?? v.buying_power);
    const op = await call('GET', '/mercado/opciones/resumen/' + S);
    const calls = op.items.filter(i => i.tipo === 'call');
    const c = calls.reduce((a, b) => Math.abs(b.strike - op.precioSubyacente) < Math.abs(a.strike - op.precioSubyacente) ? b : a);
    console.log('contrato', c.simbolo, 'strike', c.strike, 'venc', c.vencimiento, 'bid/ask', c.bid, c.ask, '| subyacente', op.precioSubyacente);
    const config = await call('POST', '/configuraciones', { empresaId: empresa._id, estrategiaId: longCall._id, nombre: 'Prueba orden paper' });
    const key = 'prueba-' + randomUUID();
    const orden = await call('POST', '/ordenes', { conexionId: conexion._id, configuracionId: config._id, idempotencyKey: key, tipo: 'limit', vigencia: 'day', cantidad: 1, precioLimite: 0.01,
      componentes: [{ contratoId: c.contratoId, simbolo: c.simbolo, accion: 'buy', intencion: 'buy_to_open', proporcion: 1 }] });
    console.log('orden creada', orden.estado);
    const env = await call('POST', '/ordenes/' + orden._id + '/envio', undefined, { 'Idempotency-Key': key });
    ordenExterna = env.ordenExternaId;
    console.log('envio', env.estado, 'externa', env.ordenExternaId ? 'sí' : 'no', '|', env.eventos.at(-1).mensaje);
    const env2 = await call('POST', '/ordenes/' + orden._id + '/envio', undefined, { 'Idempotency-Key': key });
    console.log('reenvio idempotente', env2.ordenExternaId === env.ordenExternaId ? 'misma orden (OK)' : 'DUPLICADA');
    try { await call('POST', '/ordenes/' + orden._id + '/envio', undefined, { 'Idempotency-Key': 'otra-clave-123' }); console.log('clave ajena: aceptada (MAL)'); } catch (e) { console.log('clave ajena rechazada:', e.message.split(' ').slice(2).join(' ')); }
    await sleep(2000);
    await sync({ recurso: 'ordenes', conexionId: conexion._id });
    console.log('estado tras sync', (await call('GET', '/ordenes/' + orden._id)).estado);
    const can = await call('POST', '/ordenes/' + orden._id + '/cancelacion');
    console.log('cancelacion', can.estado, '|', can.eventos.at(-1).mensaje);
    const remoto = await createIntegrations(process.env).alpaca.consultarOrden(ordenExterna);
    console.log('Alpaca confirma', remoto.estado, remoto.estadoProveedor || '');
    await sync({ recurso: 'posiciones', conexionId: conexion._id });
    await call('POST', '/conexiones-broker/' + conexion._id + '/verificacion').catch(() => null);
    console.log('eventos:', (await call('GET', '/ordenes/' + orden._id)).eventos.map(e => e.tipo).join(' → '));
  } catch (e) {
    console.error('FALLO', e.message);
    if (ordenExterna) { await createIntegrations(process.env).alpaca.cancelarOrden(ordenExterna).catch(() => {}); console.error('orden cancelada por seguridad'); }
    process.exitCode = 1;
  } finally {
    server.close(); let n = 0;
    for (const name of Object.keys(resources)) { const repo = repository(name, { userId, database: DB }); for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const r of rows) { await repo.remove(r._id, r.revision); n++; } } }
    console.log('limpieza', n); await closeMongo();
  }
})();
