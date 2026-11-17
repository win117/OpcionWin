// Prueba real opt-in con EJECUCIÓN en Alpaca PAPER (dinero simulado): compra market 1 call ATM de AAPL → posición abierta
// → venta market sell_to_close → posición cerrada. Requiere mercado abierto. Usuario temporal; limpia sus registros.
// Salvaguarda: si algo falla con la posición abierta, la cierra directamente en Alpaca.
// Uso: npm run build && node scripts/smoke-orden-ejecucion.cjs [mongodb|supabase]
process.chdir(require('node:path').resolve(__dirname, '..'));
require('dotenv').config({ quiet: true });
const R = p => require(process.cwd() + '/dist/' + p);
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { repository } = R('repositories');
const { resources } = R('repositories/resources');
const { closeMongo } = R('config/database.config');
const { createSessionService } = R('api/v1/services/sesiones.service');
const { createApp } = R('app');
const prefix = R('config/config').default.API_URL;
const { createIntegrations } = R('integrations');

const DB = process.argv[2] || 'mongodb', S = 'AAPL';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alpaca = createIntegrations(process.env).alpaca;
const H = { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY };
const paper = (ruta, init = {}) => fetch('https://paper-api.alpaca.markets' + ruta, { ...init, headers: H }).then(r => (r.status === 204 ? null : r.json()));

(async () => {
  const reloj = await paper('/v2/clock');
  if (!reloj.is_open) { console.log('Mercado cerrado; próxima apertura', reloj.next_open); return; }
  const userId = randomUUID(), password = 'Tmp-' + randomUUID(), salt = randomUUID();
  const user = { id: userId, email: 'x-' + userId + '@example.com', salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  const app = createApp({ factory: repository, auth: createSessionService(repository, async () => [user]), quiet: true, webDir: null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  let token;
  const call = async (m, p, b, h = {}) => {
    const r = await fetch(base + p, { method: m, headers: { ...h, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + p + ' ' + r.status + ' ' + j.message); return j.data;
  };
  const wait = async p => { for (;;) { const d = await call('GET', p); if (['completada', 'fallida'].includes(d.estado)) return d; await sleep(1000); } };
  const sync = async b => wait('/sincronizaciones/' + (await call('POST', '/sincronizaciones/ejecuciones', b))._id);
  let contratoSimbolo, abierta = false;
  try {
    token = (await call('POST', '/sesiones', { email: user.email, password, baseDatos: DB })).token;
    await call('POST', '/estrategias/catalogo-base');
    for (const r of ['empresas', 'cotizaciones', 'contratos']) await sync({ recurso: r, simbolos: [S] });
    const empresa = (await call('GET', '/empresas?simbolo=' + S)).items[0];
    const longCall = (await call('GET', '/estrategias?codigo=LONG_CALL')).items[0];
    const broker = (await call('GET', '/brokers?codigo=alpaca')).items[0] || await call('POST', '/brokers', { codigo: 'alpaca', nombre: 'Alpaca', activo: true, entornos: ['paper'] });
    const conexion = await call('POST', '/conexiones-broker', { brokerId: broker._id, alias: 'Paper ejecución', entorno: 'paper', credencialRef: 'env:ALPACA' });
    const v = await call('POST', '/conexiones-broker/' + conexion._id + '/verificacion');
    console.log('cuenta', v.estadoConexion, '| efectivo', v.efectivo ?? v.cash ?? '—');
    const op = await call('GET', '/mercado/opciones/resumen/' + S);
    const c = op.items.filter(i => i.tipo === 'call' && i.ask > 0)
      .reduce((a, b) => (Math.abs(b.strike - op.precioSubyacente) < Math.abs(a.strike - op.precioSubyacente) ? b : a));
    contratoSimbolo = c.simbolo;
    console.log('contrato', c.simbolo, '| subyacente', op.precioSubyacente, '| bid/ask', c.bid, c.ask, '| delta', c.griegas?.delta);
    const config = await call('POST', '/configuraciones', { empresaId: empresa._id, estrategiaId: longCall._id, nombre: 'Prueba ejecución paper' });

    const ordenar = async (accion, intencion) => {
      const key = 'exec-' + randomUUID();
      const o = await call('POST', '/ordenes', { conexionId: conexion._id, configuracionId: config._id, idempotencyKey: key, tipo: 'market', vigencia: 'day', cantidad: 1,
        componentes: [{ contratoId: c.contratoId, simbolo: c.simbolo, accion, intencion, proporcion: 1 }] });
      const env = await call('POST', '/ordenes/' + o._id + '/envio', undefined, { 'Idempotency-Key': key });
      const t0 = Date.now();
      let estado = env.estado;
      while (estado !== 'ejecutada' && Date.now() - t0 < 90000) {
        await sleep(2000);
        await sync({ recurso: 'ordenes', conexionId: conexion._id });
        estado = (await call('GET', '/ordenes/' + o._id)).estado;
      }
      const remoto = await alpaca.consultarOrden(env.ordenExternaId);
      console.log(intencion.padEnd(13), '->', estado, '| precio', remoto.precioPromedioEjecucion, '|', ((Date.now() - t0) / 1000).toFixed(1) + 's');
      if (estado !== 'ejecutada') {
        await call('POST', '/ordenes/' + o._id + '/cancelacion').catch(() => {});
        throw new Error('La orden ' + intencion + ' no se ejecutó en 90 s (cancelada).');
      }
      return { orden: await call('GET', '/ordenes/' + o._id), precio: remoto.precioPromedioEjecucion };
    };

    const compra = await ordenar('buy', 'buy_to_open'); abierta = true;
    await sync({ recurso: 'posiciones', conexionId: conexion._id });
    let pos = (await call('GET', '/posiciones?conexionId=' + conexion._id)).items;
    console.log('posición', pos.map(p => p.estado + ' ' + p.lado + ' x' + p.cantidad + ' @ ' + p.precioPromedio).join(', ') || 'ninguna');
    const venta = await ordenar('sell', 'sell_to_close'); abierta = false;
    await sync({ recurso: 'posiciones', conexionId: conexion._id });
    pos = (await call('GET', '/posiciones?conexionId=' + conexion._id)).items;
    console.log('posición tras cierre', pos.map(p => p.estado + ' x' + p.cantidad).join(', '));
    console.log('resultado simulado: ' + ((venta.precio - compra.precio) * 100).toFixed(2) + ' USD (spread + movimiento)');
    console.log('eventos compra:', compra.orden.eventos.map(e => e.mensaje).join(' -> '));
  } catch (e) {
    console.error('FALLO', e.message); process.exitCode = 1;
  } finally {
    if (contratoSimbolo) {
      const lista = await paper('/v2/positions');
      if (Array.isArray(lista) && lista.some(p => p.symbol === contratoSimbolo)) {
        await paper('/v2/positions/' + contratoSimbolo, { method: 'DELETE' });
        console.error('Salvaguarda: posición ' + contratoSimbolo + ' cerrada directamente en Alpaca.');
      } else console.log('sin posición residual en Alpaca' + (abierta ? ' (verificar)' : ''));
    }
    server.close();
    let n = 0;
    for (const name of Object.keys(resources)) {
      const repo = repository(name, { userId, database: DB });
      for (;;) { const rows = await repo.list({ offset: 0, limit: 500 }); if (!rows.length) break; for (const r of rows) { await repo.remove(r._id, r.revision); n++; } }
    }
    console.log('limpieza', n);
    await closeMongo();
  }
})();
