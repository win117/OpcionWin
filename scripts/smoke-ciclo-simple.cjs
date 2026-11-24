// Prueba real opt-in (solo PAPER, mercado abierto): ciclo completo de una opción: abrir a límite, comprobar que los números tienen sentido
// (lado, cantidad, precio de ejecución, resultado, efectivo) y cerrar desde la app. Usuario temporal con limpieza. No lo cortes con timeout.
// Se niega a empezar si la cuenta ya tiene posiciones. Uso: npm run build && node scripts/smoke-ciclo-simple.cjs alpaca|webull SIMBOLO call|put [buy|sell]
process.chdir(require('node:path').resolve(__dirname, '..'));
require(process.cwd() + '/node_modules/dotenv').config({ quiet: true });
const R = p => require(process.cwd() + '/dist/' + p);
const { once } = require('node:events'); const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = R('repositories'); const { resources } = R('repositories/resources'); const { closeMongo } = R('config/database.config');
const { createSessionService } = R('api/v1/services/sesiones.service'); const { createApp } = R('app'); const { createIntegrations } = R('integrations');
const prefix = R('config/config').default.API_URL, z = ms => new Promise(r => setTimeout(r, ms));
const [BROKER, S0, TIPO, ACCION = 'buy'] = process.argv.slice(2), S = (S0 || '').toUpperCase(), DB = 'mongodb';
const FIN = new Set(['ejecutada', 'cancelada', 'rechazada', 'expirada']);
(async () => {
  if (!['alpaca', 'webull'].includes(BROKER) || !S || !['call', 'put'].includes(TIPO) || !['buy', 'sell'].includes(ACCION)) throw new Error('Uso: smoke-ciclo-simple.cjs alpaca|webull SIMBOLO call|put [buy|sell]');
  const u = randomUUID(), pw = 'Tmp-' + u, email = 'q-' + u + '@example.com', integ = createIntegrations(process.env), broker = integ[BROKER];
  if ((await broker.posiciones()).length) throw new Error('La cuenta paper ya tiene posiciones; no se ejecuta.');
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [{ id: u, email, salt: u, passwordHash: scryptSync(pw, u, 64).toString('hex') }]), integraciones: integ, quiet: true, webDir: null });
  const sv = app.listen(0, '127.0.0.1'); await once(sv, 'listening'); const base = 'http://127.0.0.1:' + sv.address().port + prefix; let token;
  const call = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { ...h, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b && JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + p + ' → ' + r.status + ' ' + j.message); return j.data; };
  const sync = async b => { const t = await call('POST', '/sincronizaciones/ejecuciones', b); for (;;) { const d = await call('GET', '/sincronizaciones/' + t._id); if (['completada', 'fallida'].includes(d.estado)) return d; await z(800); } };
  const seguir = async (id, ms) => { const t = Date.now(); let o; do { await z(2500); o = await call('POST', '/ordenes/' + id + '/actualizacion'); } while (!FIN.has(o.estado) && Date.now() - t < ms); return o; };
  const fallos = [], revisa = (t, ok, d = '') => { console.log(ok ? '  ok ' : '  MAL', t, d); if (!ok) fallos.push(t); };
  const casi = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
  try {
    token = (await call('POST', '/sesiones', { email, password: pw, baseDatos: DB })).token;
    await call('POST', '/broker/paper/conexion', { broker: BROKER });
    for (const recurso of ['empresas', 'cotizaciones', 'contratos']) { const r = await sync({ recurso, simbolos: [S] }); if (r.estado !== 'completada') throw new Error('sync ' + recurso + ': ' + r.error); }
    const empresa = (await call('GET', '/empresas?simbolo=' + S)).items[0], op0 = await call('GET', '/mercado/opciones/resumen/' + S);
    const venc = op0.vencimientos.find(v => (Date.parse(v) - Date.now()) / 864e5 > 14 && new Date(v).getUTCDay() === 5) || op0.vencimiento, op = await call('GET', '/mercado/opciones/resumen/' + S + '?vencimiento=' + venc), px = op.precioSubyacente;
    const it = op.items.filter(i => i.tipo === TIPO && i.bid > 0 && i.ask >= i.bid).sort((a, b) => Math.abs(a.strike - px * (ACCION === 'sell' ? 0.93 : 1)) - Math.abs(b.strike - px * (ACCION === 'sell' ? 0.93 : 1)))[0];
    const r0 = await call('GET', '/broker/paper/resumen?broker=' + BROKER), efectivo0 = r0.cuenta.efectivo;
    console.log(BROKER, ACCION, S, px, it.tipo + it.strike, venc, 'bid', it.bid, 'ask', it.ask);
    let o;
    for (const f of [1, 1.05, 1.12]) {
      const precio = Math.round((ACCION === 'buy' ? it.ask * f : it.bid / f) * 20) / 20;
      o = (await call('POST', '/ordenes/ticket', { broker: BROKER, empresaId: empresa._id, ...(ACCION === 'buy' ? { estrategiaCodigo: TIPO === 'call' ? 'LONG_CALL' : 'LONG_PUT' } : {}), tipo: 'limit', precioLimite: precio, vigencia: 'day', cantidad: 1, componentes: [{ contratoId: it.contratoId, accion: ACCION }] }, { 'Idempotency-Key': 'ciclo-' + randomUUID() })).orden;
      o = await seguir(o._id, 25000); console.log('apertura a', precio, o.estado, o.precioPromedioEjecucion ?? '', o.eventos?.at(-1)?.mensaje || '');
      if (o.estado === 'ejecutada') { revisa('precio de ejecución mejor o igual que el límite', ACCION === 'buy' ? o.precioPromedioEjecucion <= precio + 1e-9 : o.precioPromedioEjecucion >= precio - 1e-9); break; }
      if (o.estado === 'rechazada') break;
      await call('POST', '/ordenes/' + o._id + '/cancelacion').catch(e => console.log('   cancelación', e.message)); o = await seguir(o._id, 15000); if (o.estado === 'ejecutada') break;
    }
    if (o.estado !== 'ejecutada') throw new Error('No se ejecutó: ' + o.estado);
    revisa('orden: 1 contrato ejecutado', o.cantidadEjecutada === 1);
    await z(4000);
    const r = await call('GET', '/broker/paper/resumen?broker=' + BROKER), p = r.posiciones[0];
    revisa('una posición', r.posiciones.length === 1); revisa('sin avisos', !r.avisoSincronizacion, r.avisoSincronizacion || '');
    revisa('contrato correcto', p.contratoId === it.contratoId, p.simbolo); revisa('lado', p.lado === (ACCION === 'buy' ? 'long' : 'short'), p.lado); revisa('cantidad 1', p.cantidad === 1); revisa('se puede cerrar', p.cerrable === true);
    revisa('tipo, strike y vencimiento', p.tipo === it.tipo && p.strike === it.strike && p.vencimiento === venc, [p.tipo, p.strike, p.vencimiento].join(' '));
    revisa('costo ≈ precio de ejecución', casi(p.precioPromedio, o.precioPromedioEjecucion, 0.02), p.precioPromedio + ' vs ' + o.precioPromedioEjecucion);
    const signo = ACCION === 'buy' ? 1 : -1, esperado = (p.precioActual - p.precioPromedio) * 100 * signo;
    revisa('resultado = (actual − costo) × 100 × lado', casi(p.pl, esperado, Math.max(3, Math.abs(esperado) * 0.1)), (p.pl ?? 'null') + ' vs ' + esperado.toFixed(2));
    console.log('   efectivo', efectivo0, '→', r.cuenta.efectivo, '| valor', p.valorMercado, '| plPct', p.plPct);
    const ventaEnUI = ACCION === 'buy';
    let f;
    for (const k of [1, 1.06, 1.15]) {
      const q = (await call('GET', '/mercado/opciones/resumen/' + S + '?vencimiento=' + venc)).items.find(i => i.contratoId === it.contratoId);
      const precio = Math.max(0.05, Math.round((ventaEnUI ? Math.min(q.bid, p.precioActual || q.bid) / k : Math.max(q.ask, p.precioActual || q.ask) * k) * 20) / 20);
      f = (await call('POST', '/posiciones/' + p.posicionId + '/cierre', { tipo: 'limit', precioLimite: precio }, { 'Idempotency-Key': 'cierre-' + randomUUID() })).orden;
      const dup = await call('POST', '/posiciones/' + p.posicionId + '/cierre', { tipo: 'limit', precioLimite: precio }, { 'Idempotency-Key': 'cierre-' + randomUUID() }).then(() => 'ACEPTADO', e => e.message);
      if (k === 1) revisa('un segundo cierre simultáneo no pasa', dup !== 'ACEPTADO', dup.slice(0, 110));
      f = await seguir(f._id, 25000); console.log('cierre a', precio, f.estado, f.precioPromedioEjecucion ?? '', f.eventos?.at(-1)?.mensaje || '');
      if (f.estado === 'ejecutada' || f.estado === 'rechazada') break;
      await call('POST', '/ordenes/' + f._id + '/cancelacion').catch(e => console.log('   cancelación', e.message)); f = await seguir(f._id, 15000); if (f.estado === 'ejecutada') break;
    }
    await z(4000);
    const r2 = await call('GET', '/broker/paper/resumen?broker=' + BROKER);
    revisa('cerrada: 0 posiciones en el broker', (await broker.posiciones()).length === 0); revisa('cerrada: 0 en la app', r2.posiciones.length === 0);
    const local = (await call('GET', '/posiciones')).items; revisa('el registro local queda cerrado', local.every(x => x.estado === 'cerrada'), local.map(x => x.estado).join(','));
    const res = (f.precioPromedioEjecucion - o.precioPromedioEjecucion) * 100 * signo; console.log('resultado calculado', res.toFixed(2), '| efectivo', efectivo0, '→', r2.cuenta.efectivo, '(', (r2.cuenta.efectivo - efectivo0).toFixed(2), ')');
    revisa('el efectivo cambió lo que dice el resultado (± comisiones)', casi(r2.cuenta.efectivo - efectivo0, res, 5));
  } catch (e) { console.error('FALLO', e.message); fallos.push(e.message); } finally {
    const q = await broker.posiciones().catch(() => null); if (!q || q.length) console.error('ATENCIÓN: quedan posiciones abiertas en ' + BROKER + ': ' + (q ? q.map(x => x.simbolo).join(', ') : 'no se pudo comprobar'));
    sv.close(); let n = 0; for (const name of Object.keys(resources)) { const repo = repository(name, { userId: u, database: DB }); for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const x of rows) { await repo.remove(x._id, x.revision); n++; } } }
    console.log(fallos.length ? 'CON FALLOS: ' + fallos.join(' | ') : 'TODO BIEN', '| limpieza', n); await closeMongo(); process.exit(fallos.length ? 1 : 0);
  }
})().catch(async e => { console.error(e.message); await closeMongo().catch(() => {}); process.exit(1); });
