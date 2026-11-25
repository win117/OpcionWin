// Seguimiento de órdenes: WebSocket de Alpaca (simulado), servicio que combina avisos y consultas, y respuesta Server-Sent Events.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, scryptSync } = require('node:crypto');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createApp } = require('../dist/app');
const { createSessionService } = require('../dist/api/v1/services/sesiones.service');
const { crear } = require('../dist/api/v1/services/registros');
const { createSeguimiento, MAX_POR_USUARIO } = require('../dist/api/v1/services/seguimiento.service');
const { createFlujoOrdenes } = require('../dist/integrations/alpaca.stream');
const { normalizarOrden } = require('../dist/integrations/alpaca.client');
const prefix = require('../dist/config/config').default.API_URL;
const z = ms => new Promise(r => setTimeout(r, ms));
const hasta = async (f, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('No ocurrió a tiempo'); await z(5); } };

function fakeWs() {
  const abiertos = [];
  class WS { constructor(url) { this.url = url; this.enviados = []; abiertos.push(this); } send(x) { this.enviados.push(JSON.parse(x)); } close() { this.cerrado = true; this.onclose?.(); }
    llega(o) { this.onmessage({ data: new TextEncoder().encode(JSON.stringify(o)).buffer }); } } // Alpaca manda marcos binarios
  return { WS, abiertos };
}

test('flujo de Alpaca: una sola conexión, se autentica, escucha y reparte los avisos', async () => {
  const { WS, abiertos } = fakeWs(), recibidos = [], programados = [];
  const f = createFlujoOrdenes({ keyId: 'K', secretKey: 'S', normalizar: normalizarOrden, WebSocket: WS, setTimeout: (fn, ms) => { programados.push({ fn, ms }); return { fn }; }, clearTimeout: () => {} });
  const baja1 = f.suscribir(x => recibidos.push(x)); f.suscribir(() => { throw new Error('un suscriptor roto no afecta a los demás'); });
  assert.equal(abiertos.length, 1); assert.match(abiertos[0].url, /^wss:\/\/paper-api\.alpaca\.markets\/stream$/);
  const [ws] = abiertos; ws.onopen(); assert.deepEqual(ws.enviados[0], { action: 'auth', key: 'K', secret: 'S' }); assert.equal(f.activo(), false);
  ws.llega({ stream: 'authorization', data: { status: 'authorized' } }); await hasta(() => ws.enviados.length === 2); assert.deepEqual(ws.enviados[1].data.streams, ['trade_updates']);
  ws.llega({ stream: 'listening', data: { streams: ['trade_updates'] } }); await hasta(() => f.activo());
  ws.llega({ stream: 'trade_updates', data: { event: 'fill', order: { id: 'o1', client_order_id: 'c1', status: 'filled', filled_qty: '1', filled_avg_price: '-2.5' } } });
  await hasta(() => recibidos.length === 1); assert.deepEqual([recibidos[0].evento, recibidos[0].orden.estado, recibidos[0].orden.precioPromedioEjecucion], ['fill', 'ejecutada', 2.5]);
  ws.onmessage({ data: 'esto no es JSON' }); await z(10);
  ws.onclose(); assert.equal(f.activo(), false); assert.equal(programados.length, 1, 'se corta: reintenta con espera'); programados[0].fn(); assert.equal(abiertos.length, 2);
  abiertos[1].onopen(); abiertos[1].llega({ stream: 'authorization', data: { status: 'unauthorized' } }); await hasta(() => abiertos[1].cerrado); assert.ok(programados[1].ms >= 30000, 'credenciales rechazadas: espera larga');
  baja1(); f.cerrar(); assert.equal(f.activo(), false);
  const sin = createFlujoOrdenes({ WebSocket: WS, normalizar: normalizarOrden }); sin.suscribir(() => {}); assert.equal(abiertos.length, 2, 'sin credenciales no se conecta');
});

async function escenario({ avisos = true } = {}) {
  const factory = memoryFactory(), ctx = { userId: randomUUID(), database: 'mongodb' };
  const b = await crear('brokers', ctx, { codigo: 'alpaca', nombre: 'Alpaca', activo: true, entornos: ['paper'] }, factory);
  const c = await crear('conexiones-broker', ctx, { brokerId: b._id, alias: 'x', entorno: 'paper', credencialRef: 'env:ALPACA', estado: 'activa' }, factory);
  const orden = await crear('ordenes', ctx, { conexionId: c._id, configuracionId: 'cfg', ordenExternaId: 'ext', idempotencyKey: 'clave-12345', tipo: 'limit', precioLimite: 1, vigencia: 'day', cantidad: 1, estado: 'aceptada',
    componentes: [{ contratoId: 'k', simbolo: 'A261218C00100000', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 }], eventos: [{ tipo: 'enviada' }] }, factory);
  const estado = { remoto: { estado: 'aceptada', cantidadEjecutada: 0 }, consultas: 0, avisar: null, bajas: 0 };
  const alpaca = { consultarOrden: async () => { estado.consultas++; if (estado.falla) throw new Error('caído'); return estado.remoto; }, entorno: 'paper',
    ...(avisos ? { suscribirOrdenes: fn => { estado.avisar = fn; return () => { estado.bajas++; }; }, avisosActivos: () => true } : {}) };
  return { factory, ctx, orden, estado, integraciones: { alpaca, estado: () => ({}) } };
}

test('seguimiento: el aviso del broker se refleja al instante, sin esperar la consulta periódica', async () => {
  const e = await escenario(), s = createSeguimiento({ ...e, cadaMs: 60000, cadaConAvisoMs: 60000 }), cambios = [], fin = [];
  const r = await s.seguir(e.ctx, e.orden._id, { alCambio: (o, x) => cambios.push([o.estado, x.enVivo]), alTerminar: m => fin.push(m) });
  assert.equal(r.orden.estado, 'aceptada'); await hasta(() => e.estado.consultas === 1);
  e.estado.avisar({ orden: { ordenExternaId: 'otra' } }); await z(30); assert.equal(e.estado.consultas, 1, 'un aviso de otra orden no consulta');
  e.estado.remoto = { estado: 'ejecutada', cantidadEjecutada: 1, precioPromedioEjecucion: 0.95 }; e.estado.avisar({ orden: { ordenExternaId: 'ext' } });
  await hasta(() => fin.length); assert.deepEqual(cambios.at(-1), ['ejecutada', true]); assert.deepEqual(fin, ['final']); assert.equal(e.estado.bajas, 1); assert.equal(s.total(), 0);
});

test('seguimiento sin avisos: consulta cada poco, tolera fallos, respeta el tope de tiempo y de seguimientos', async () => {
  const e = await escenario({ avisos: false }), s = createSeguimiento({ ...e, cadaMs: 15, duracionMaxMs: 400 }), cambios = [], fin = [];
  e.estado.falla = true; await s.seguir(e.ctx, e.orden._id, { alCambio: (o, x) => cambios.push([o.estado, x.enVivo]), alTerminar: m => fin.push(m) });
  await hasta(() => e.estado.consultas >= 3); assert.deepEqual(cambios, []); e.estado.falla = false; e.estado.remoto = { estado: 'parcial', cantidadEjecutada: 1 };
  await hasta(() => cambios.length); assert.deepEqual(cambios[0], ['parcial', false]); await hasta(() => fin.length); assert.deepEqual(fin, ['tiempo']);
  const abiertos = await Promise.all(Array.from({ length: MAX_POR_USUARIO }, () => s.seguir(e.ctx, e.orden._id, { alCambio() {}, alTerminar: m => fin.push(m) })));
  await assert.rejects(s.seguir(e.ctx, e.orden._id, { alCambio() {} }), x => x.output.statusCode === 429); abiertos[0].parar();
  (await s.seguir(e.ctx, e.orden._id, { alCambio() {} })).parar(); s.cerrar(); assert.equal(s.total(), 0); assert.equal(fin.filter(m => m === 'apagado').length, MAX_POR_USUARIO - 1);
  await assert.rejects(s.seguir({ ...e.ctx, userId: randomUUID() }, e.orden._id, { alCambio() {} }), x => x.output.statusCode === 400, 'una orden ajena no se puede seguir');
});

test('SSE: abre, envía cada cambio y termina; sin sesión no abre y al desconectarse deja de consultar', async () => {
  const e = await escenario(), salt = 's', email = 'a@b.c';
  const app = createApp({ factory: e.factory, integraciones: e.integraciones, auth: createSessionService(e.factory, async () => [{ id: e.ctx.userId, email, salt, passwordHash: scryptSync('p', salt, 64).toString('hex') }]), quiet: true, webDir: null });
  const sv = app.listen(0, '127.0.0.1'); await once(sv, 'listening');
  const base = 'http://127.0.0.1:' + sv.address().port + prefix, ruta = base + '/ordenes/' + e.orden._id + '/seguimiento';
  try {
    assert.equal((await fetch(ruta)).status, 401);
    const token = (await (await fetch(base + '/sesiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'p', baseDatos: 'mongodb' }) })).json()).data.token;
    const h = { Authorization: 'Bearer ' + token };
    assert.equal((await fetch(base + '/ordenes/nada/seguimiento', { headers: h })).status, 400);
    const r = await fetch(ruta, { headers: h }); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/event-stream/); assert.equal(r.headers.get('content-encoding'), null);
    const lector = r.body.pipeThrough(new TextDecoderStream()).getReader(); let texto = '';
    const leer = async patron => { while (!patron.test(texto)) { const { done, value } = await lector.read(); if (done) return; texto += value; } };
    await leer(/event: orden[\s\S]*"aceptada"/); await hasta(() => e.estado.consultas === 1);
    e.estado.remoto = { estado: 'ejecutada', cantidadEjecutada: 1, precioPromedioEjecucion: 0.95 }; e.estado.avisar({ orden: { clientOrderId: 'clave-12345' } });
    await leer(/event: fin\ndata: \{"motivo":"final"\}/); assert.match(texto, /"estado":"ejecutada"/); assert.equal((await lector.read()).done, true);
    const repetida = await (await fetch(ruta, { headers: h })).text(); assert.match(repetida, /event: fin/); // ya terminada
    const bajas = e.estado.bajas; const otra = await crear('ordenes', e.ctx, { ...Object.fromEntries(['conexionId', 'configuracionId', 'tipo', 'precioLimite', 'vigencia', 'cantidad', 'componentes'].map(k => [k, e.orden[k]])), ordenExternaId: 'ext2', idempotencyKey: 'clave-67890', estado: 'aceptada', eventos: [{ tipo: 'enviada' }] }, e.factory);
    e.estado.remoto = { estado: 'aceptada', cantidadEjecutada: 0 };
    const control = new AbortController(); const p = await fetch(base + '/ordenes/' + otra._id + '/seguimiento', { headers: h, signal: control.signal }); await p.body.getReader().read(); control.abort(); await hasta(() => e.estado.bajas === bajas + 1);
  } finally { app.locals.cerrarConexiones(); sv.closeAllConnections(); sv.close(); }
});
