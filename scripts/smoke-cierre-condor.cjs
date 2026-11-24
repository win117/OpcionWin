// Prueba real opt-in (solo PAPER, mercado abierto): abre un Iron Condor de 1 contrato, revisa las patas que reporta el broker y lo cierra
// desde la app (POST /posiciones/cierre-grupo). Pase lo que pase intenta no dejar la estructura abierta. Usuario temporal con limpieza.
// Se niega a empezar si la cuenta ya tiene posiciones: no toca nada que no haya abierto. No lo cortes con timeout.
// Uso: npm run build && node scripts/smoke-cierre-condor.cjs alpaca|webull [SIMBOLO] [mongodb|supabase]
process.chdir(require('node:path').resolve(__dirname, '..'));
require(process.cwd() + '/node_modules/dotenv').config({ quiet: true });
const R = p => require(process.cwd() + '/dist/' + p);
const { once } = require('node:events'); const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = R('repositories'); const { resources } = R('repositories/resources'); const { closeMongo } = R('config/database.config');
const { createSessionService } = R('api/v1/services/sesiones.service'); const { createApp } = R('app'); const { createIntegrations } = R('integrations');
const prefix = R('config/config').default.API_URL;
const SOLO_CIERRE = process.argv.includes('--solo-cierre'); // cierra la estructura que dejó abierta una corrida anterior
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const BROKER = ARGS[0] || 'webull', S = (ARGS[1] || '').toUpperCase(), DB = ARGS[2] || 'mongodb', z = ms => new Promise(r => setTimeout(r, ms));
const FIN = new Set(['ejecutada', 'cancelada', 'rechazada', 'expirada']);
(async () => {
  if (!['alpaca', 'webull'].includes(BROKER) || !S) throw new Error('Uso: smoke-cierre-condor.cjs alpaca|webull SIMBOLO');
  const u = randomUUID(), pw = 'Tmp-' + u, email = 'c-' + u + '@example.com';
  const integ = createIntegrations(process.env), broker = integ[BROKER];
  const previas = await broker.posiciones();
  if (SOLO_CIERRE ? previas.length !== 4 || previas.some(p => !p.simbolo.startsWith(S)) : previas.length) throw new Error('La cuenta paper no está en el estado esperado; no se ejecuta.');
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [{ id: u, email, salt: u, passwordHash: scryptSync(pw, u, 64).toString('hex') }]), integraciones: integ, quiet: true, webDir: null });
  const sv = app.listen(0, '127.0.0.1'); await once(sv, 'listening'); const base = 'http://127.0.0.1:' + sv.address().port + prefix; let token;
  const call = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { ...h, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b && JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + p + ' → ' + r.status + ' ' + j.message); return j.data; };
  const sync = async b => { const t = await call('POST', '/sincronizaciones/ejecuciones', b); for (;;) { const d = await call('GET', '/sincronizaciones/' + t._id); if (['completada', 'fallida'].includes(d.estado)) return d; await z(800); } };
  const seguir = async (id, ms) => { const t = Date.now(); let o; do { await z(2500); o = await call('POST', '/ordenes/' + id + '/actualizacion'); } while (!FIN.has(o.estado) && Date.now() - t < ms); return o; };
  const ver = p => console.log('   ', p.simbolo, p.lado, 'x' + p.cantidad, 'cerrable', p.cerrable !== false, 'grupo', p.grupoId ? 'si' : 'no', 'precio', p.precioPromedio ?? '-', 'P/L', p.plNoRealizado ?? '-');
  let abierta = false, orden = null;
  try {
    token = (await call('POST', '/sesiones', { email, password: pw, baseDatos: DB })).token;
    await call('POST', '/broker/paper/conexion', { broker: BROKER });
    for (const recurso of ['empresas', 'cotizaciones', 'contratos']) { const r = await sync({ recurso, simbolos: [S] }); if (r.estado !== 'completada') throw new Error('sync ' + recurso + ': ' + r.error); }
    const empresa = (await call('GET', '/empresas?simbolo=' + S)).items[0], op0 = await call('GET', '/mercado/opciones/resumen/' + S), dia = '20' + (previas[0]?.simbolo.match(/(\d{6})[CP]\d{8}$/)?.[1] || '').replace(/(..)(..)(..)/, '$1-$2-$3');
    // Viernes a más de dos semanas (los vencimientos de entre semana son poco líquidos); en --solo-cierre, el de la estructura abierta.
    const venc = SOLO_CIERRE ? dia : op0.vencimientos.find(v => (Date.parse(v) - Date.now()) / 864e5 > 14 && new Date(v).getUTCDay() === 5) || op0.vencimiento;
    const op = await call('GET', '/mercado/opciones/resumen/' + S + '?vencimiento=' + venc), px = op.precioSubyacente;
    const ok = i => i.bid > 0 && i.ask >= i.bid, mid = i => (i.bid + i.ask) / 2;
    let sp, lp, sc, lc;
    if (SOLO_CIERRE) {
      const de = p => op.items.find(i => p.simbolo.includes(i.vencimiento.slice(2).replace(/-/g, '') + (i.tipo === 'call' ? 'C' : 'P') + String(i.strike * 1000).padStart(8, '0')));
      [lp, sp, sc, lc] = previas.map(de).sort((a, b) => a.strike - b.strike);
    } else {
    const puts = op.items.filter(i => i.tipo === 'put' && ok(i)).sort((a, b) => b.strike - a.strike), calls = op.items.filter(i => i.tipo === 'call' && ok(i)).sort((a, b) => a.strike - b.strike);
    sp = puts.find(i => i.strike <= px * 0.97); lp = puts.find(i => sp && i.strike < sp.strike); sc = calls.find(i => i.strike >= px * 1.03); lc = calls.find(i => sc && i.strike > sc.strike);
    if (!sp || !lp || !sc || !lc) throw new Error('No hay 4 contratos con cotización.');
    const medio = mid(sp) + mid(sc) - mid(lp) - mid(lc), natural = sp.bid + sc.bid - lp.ask - lc.ask, limite = Math.max(0.05, Math.round(Math.max(natural, medio * 0.5) * 20) / 20);
    console.log(S, px, 'venc', op.vencimiento, [lp, sp, sc, lc].map(i => i.tipo[0] + i.strike).join(' '), '| crédito medio', medio.toFixed(2), 'natural', natural.toFixed(2), 'límite', limite);
    const componentes = [[lp, 'buy'], [sp, 'sell'], [sc, 'sell'], [lc, 'buy']].map(([i, accion]) => ({ contratoId: i.contratoId, accion }));
    const abrir = async extra => { orden = (await call('POST', '/ordenes/ticket', { broker: BROKER, empresaId: empresa._id, estrategiaCodigo: 'IRON_CONDOR', vigencia: 'day', cantidad: 1, componentes, ...extra }, { 'Idempotency-Key': 'condor-' + randomUUID() })).orden; return seguir(orden._id, 30000); };
    // Solo límite (Webull no admite estructuras a mercado): se cede precio por escalones.
    const escalones = [limite, limite * 0.6, limite * 0.3, 0.05].map(x => Math.max(0.05, Math.round(x * 20) / 20)).filter((x, k, l) => l.indexOf(x) === k);
    let o;
    for (const precioLimite of escalones) {
      o = await abrir({ tipo: 'limit', precioLimite, credito: true });
      console.log('apertura a', precioLimite + ':', o.estado, 'ejecutadas', o.cantidadEjecutada, 'precio', o.precioPromedioEjecucion);
      if (o.estado === 'ejecutada' || o.estado === 'rechazada') break;
      await call('POST', '/ordenes/' + o._id + '/cancelacion').catch(e => console.log('   cancelación:', e.message));
      o = await seguir(o._id, 20000);
      if (o.estado === 'ejecutada') break;
      if (o.estado !== 'cancelada') throw new Error('La orden no se pudo cancelar: ' + o.estado);
    }
    if (o.estado !== 'ejecutada') throw new Error('No se pudo abrir: ' + o.estado);
    }
    abierta = true; await z(4000);
    if (broker.posicionesCrudas) console.log('CRUDO', JSON.stringify(await broker.posicionesCrudas()));
    console.log('adaptador:'); (await broker.posiciones()).forEach(ver);
    const r = await call('GET', '/broker/paper/resumen?broker=' + BROKER);
    console.log('app:', r.avisoSincronizacion || 'sin avisos'); r.posiciones.forEach(ver);
    const lados = Object.fromEntries(r.posiciones.map(p => [p.simbolo, p.lado])), esperado = [[lp, 'long'], [sp, 'short'], [sc, 'short'], [lc, 'long']];
    const bien = esperado.filter(([i, l]) => lados[i.simbolo] === l || Object.entries(lados).some(([s, x]) => s.endsWith(String(i.strike * 1000).padStart(8, '0')) && s.includes(i.tipo === 'call' ? 'C0' : 'P0') && x === l)).length;
    console.log('patas con el lado correcto:', bien, 'de 4');
    const ids = r.posiciones.map(p => p.posicionId || p._id).filter(Boolean);
    const ancho = Math.max(sp.strike - lp.strike, lc.strike - sc.strike), costo = Math.max(0.05, sp.ask + sc.ask - lp.bid - lc.bid);
    let f;
    for (const x of [costo, costo * 1.4, (costo + ancho) / 2, ancho * 0.96]) {
      const precioLimite = Math.round(Math.min(x, ancho * 0.96) * 20) / 20;
      const cierre = (await call('POST', '/posiciones/cierre-grupo', { posicionIds: ids, tipo: 'limit', precioLimite, credito: false }, { 'Idempotency-Key': 'cierre-' + randomUUID() })).orden;
      f = await seguir(cierre._id, 30000);
      console.log('cierre desde la app a', precioLimite + ':', f.estado, 'precio', f.precioPromedioEjecucion, f.eventos?.at(-1)?.mensaje || '');
      if (f.estado === 'ejecutada' || f.estado === 'rechazada') break;
      await call('POST', '/ordenes/' + f._id + '/cancelacion').catch(e => console.log('   cancelación:', e.message));
      f = await seguir(f._id, 20000);
      if (f.estado === 'ejecutada') break;
    }
    await z(4000);
    const quedan = await broker.posiciones(); console.log('posiciones restantes:', quedan.length); quedan.forEach(ver);
    if (!quedan.length) abierta = false;
    const r2 = await call('GET', '/broker/paper/resumen?broker=' + BROKER); console.log('app tras cerrar: posiciones', r2.posiciones.length, 'patrimonio', r2.cuenta?.patrimonio);
  } catch (e) { console.error('FALLO', e.message); process.exitCode = 1; } finally {
    if (abierta) console.error('ATENCIÓN: la estructura puede seguir abierta en ' + BROKER + '. Revísala.');
    sv.close(); let n = 0;
    for (const name of Object.keys(resources)) { const repo = repository(name, { userId: u, database: DB }); for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const x of rows) { await repo.remove(x._id, x.revision); n++; } } }
    console.log('limpieza', n); await closeMongo(); process.exit();
  }
})().catch(async e => { console.error(e.message); await closeMongo().catch(() => {}); process.exit(1); });
