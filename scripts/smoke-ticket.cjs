// Prueba real opt-in (Alpaca o Webull PAPER): conexión asegurada → ticket de IRON CONDOR (limit de crédito lejos del precio, no ejecuta) → cancelación.
// Usuario temporal; limpia sus registros. Nunca deja órdenes abiertas: ante cualquier fallo cancela en Alpaca. No envía órdenes market.
// Uso: npm run build && node scripts/smoke-ticket.cjs [mongodb|supabase] [alpaca|webull]
process.chdir(require('node:path').resolve(__dirname, '..'));
require(process.cwd() + '/node_modules/dotenv').config({ quiet: true });
const R = p => require(process.cwd() + '/dist/' + p);
const { once } = require('node:events'); const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = R('repositories'); const { resources } = R('repositories/resources');
const { closeMongo } = R('config/database.config'); const { createSessionService } = R('api/v1/services/sesiones.service');
const { createApp } = R('app'); const prefix = R('config/config').default.API_URL; const { createIntegrations } = R('integrations');
const DB = process.argv[2] || 'mongodb', BROKER = process.argv[3] || 'alpaca', S = 'AAPL', sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const userId = randomUUID(), password = 'Tmp-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 't-' + userId + '@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const integ = createIntegrations(process.env), adaptador = integ[BROKER];
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [user]), quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix; let token;
  const call = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { ...h, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + j.message); return j.data; };
  const wait = async p => { for (;;) { const d = await call('GET', p); if (['completada', 'fallida'].includes(d.estado)) return d; await sleep(1000); } };
  const sync = async b => { const f = await wait('/sincronizaciones/' + (await call('POST', '/sincronizaciones/ejecuciones', b))._id); console.log('sync', b.recurso, f.estado, f.procesados, f.fallidos, f.error || ''); return f; };
  let ordenExterna;
  try {
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: DB })).token;
    // Reloj de mercado (solo informativo: una orden day fuera de horario queda en cola).
    const clock = await fetch('https://paper-api.alpaca.markets/v2/clock', { headers: { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY } }).then(r => r.json());
    console.log('mercado abierto:', clock.is_open, '| próxima apertura', clock.next_open);
    const con = await call('POST', '/broker/paper/conexion', { broker: BROKER });
    console.log('conexion', con.conexion.estado, '| cuenta', con.cuenta.estado, 'nivel opciones', con.cuenta.nivelOpciones, 'poder compra', con.cuenta.poderCompra);
    const con2 = await call('POST', '/broker/paper/conexion', { broker: BROKER });
    console.log('conexion idempotente:', con2.conexion._id === con.conexion._id ? 'misma (OK)' : 'DUPLICADA');
    await sync({ recurso: 'empresas', simbolos: [S] }); await sync({ recurso: 'cotizaciones', simbolos: [S] }); await sync({ recurso: 'contratos', simbolos: [S] });
    const empresa = (await call('GET', '/empresas?simbolo=' + S)).items[0];
    const op = await call('GET', '/mercado/opciones/resumen/' + S), px = op.precioSubyacente;
    const mid = i => (i.bid != null && i.ask != null && i.ask >= i.bid && i.ask > 0) ? (i.bid + i.ask) / 2 : null;
    const puts = op.items.filter(i => i.tipo === 'put' && mid(i) != null).sort((a, b) => b.strike - a.strike);
    const calls = op.items.filter(i => i.tipo === 'call' && mid(i) != null).sort((a, b) => a.strike - b.strike);
    const sp = puts.find(i => i.strike <= px * 0.95), lp = puts.find(i => sp && i.strike < sp.strike);
    const sc = calls.find(i => i.strike >= px * 1.05), lc = calls.find(i => sc && i.strike > sc.strike);
    if (!sp || !lp || !sc || !lc) throw new Error('No hay 4 contratos con cotización para armar el condor.');
    const credito = mid(sp) + mid(sc) - mid(lp) - mid(lc);
    const limite = Math.max(0.05, Math.round(credito * 1.5 * 100) / 100); // 50 % por encima del crédito medio: no debe ejecutarse
    console.log('subyacente', px, '| venc', op.vencimiento, '| patas', [lp, sp, sc, lc].map(i => i.tipo[0] + i.strike).join(' '), '| crédito medio', credito.toFixed(2), '| limit crédito', limite);
    const key = 'ticket-' + randomUUID();
    const body = { broker: BROKER, empresaId: empresa._id, estrategiaCodigo: 'IRON_CONDOR', tipo: 'limit', precioLimite: limite, credito: true, vigencia: 'day', cantidad: 1, componentes: [
      { contratoId: lp.contratoId, accion: 'buy' }, { contratoId: sp.contratoId, accion: 'sell' }, { contratoId: sc.contratoId, accion: 'sell' }, { contratoId: lc.contratoId, accion: 'buy' }] };
    const r = await call('POST', '/ordenes/ticket', body, { 'Idempotency-Key': key });
    ordenExterna = r.orden.ordenExternaId;
    console.log('ticket', r.orden.estado, '| config', r.configuracion.nombre, '|', r.orden.eventos.at(-1).mensaje);
    const remoto = await adaptador.consultarOrden(ordenExterna);
    console.log(BROKER + ':', remoto.estadoProveedor, '| clase', remoto.claseOrden, '| patas', remoto.componentes.length, '| orden enlazada:', remoto.clientOrderId === key || (BROKER === 'webull' && remoto.clientOrderId === ordenExterna));
    if (!['enviada', 'aceptada'].includes(remoto.estado)) throw new Error('Estado inesperado en ' + BROKER + ': ' + remoto.estadoProveedor);
    const r2 = await call('POST', '/ordenes/ticket', body, { 'Idempotency-Key': key });
    console.log('reintento misma key:', r2.orden._id === r.orden._id ? 'misma orden (OK)' : 'DUPLICADA');
    const can = await call('POST', '/ordenes/' + r.orden._id + '/cancelacion');
    console.log('cancelacion', can.estado);
    await sleep(1500);
    const fin = await adaptador.consultarOrden(ordenExterna);
    console.log(BROKER, 'confirma', fin.estadoProveedor);
    if (fin.estado !== 'cancelada') throw new Error('La orden no quedó cancelada: ' + fin.estadoProveedor);
    ordenExterna = null;
    const res = await call('GET', '/broker/paper/resumen?broker=' + BROKER);
    console.log('resumen: posiciones', res.posiciones.length, '| ordenes', res.ordenes.length, '| cuenta', res.cuenta ? res.cuenta.estado : null);
  } catch (e) {
    console.error('FALLO', e.message);
    if (ordenExterna) { await adaptador.cancelarOrden(ordenExterna).then(o => console.error('orden cancelada por seguridad:', o.estadoProveedor)).catch(x => console.error('NO SE PUDO CANCELAR:', x.mensaje || x.message)); }
    process.exitCode = 1;
  } finally {
    server.close(); let n = 0;
    for (const name of Object.keys(resources)) { const repo = repository(name, { userId, database: DB }); for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const x of rows) { await repo.remove(x._id, x.revision); n++; } } }
    console.log('limpieza', n); await closeMongo();
  }
})();
