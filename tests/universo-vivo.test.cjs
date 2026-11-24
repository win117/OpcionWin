// Universo vivo: catálogo obtenido de proveedores, mapa, ranking automático y ficha (proveedores simulados, sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createUniversoVivo, combinarCotizacion, opcionesParaIv, TTL_ABIERTO_MS, PROPIETARIO_SISTEMA } = require('../dist/api/v1/services/universo-vivo.service');
const { createCatalogo, elegirCapitalizacion, sectorDeSic, trimestres } = require('../dist/api/v1/services/catalogo-universo.service');
const { conReintento, createScreener } = require('../dist/api/v1/services/screener.service');
const { createSecClient } = require('../dist/integrations/sec.client');

const DIA = 86400000, AHORA = Date.UTC(2026, 10, 24, 18); // martes 13:00 en Nueva York
const iso = t => new Date(t).toISOString();
const limite = () => Object.assign(new Error('429'), { name: 'IntegrationError', codigo: 'LIMITE' });

// 5 símbolos: dos clases de la misma empresa, uno extranjero, uno sin opciones y uno que dejó de cotizar.
function fakes({ abierto = true, fallarIv = 0 } = {}) {
  const llamadas = { cotizaciones: [], velas: [], opciones: 0, perfiles: [], listar: 0 };
  const estado = { precio: 100, abierto, caido: false, fallarIv, edadIv: 60000, sinCatalogo: false };
  const ACT = [['UNO', true], ['DOSA', true], ['DOSB', true], ['EXTR', true], ['SINOP', false], ['VIEJA', true]];
  const CIK = { UNO: '0000000001', DOSA: '0000000002', DOSB: '0000000002', EXTR: '0000000003', SINOP: '0000000004', VIEJA: '0000000005' };
  const integraciones = {
    alpaca: {
      feed: 'iex', configurado: true,
      listarActivos: async () => { llamadas.listar++; if (estado.sinCatalogo) throw Object.assign(new Error('red'), { name: 'IntegrationError', codigo: 'RED', mensaje: 'Sin red.' }); return ACT.map(([simbolo, opciones]) => ({ simbolo, nombre: simbolo + ' Corp Class A Common Stock', negociable: true, opciones })); },
      reloj: async () => ({ abierto: estado.abierto }),
      cotizacionesLote: async (lista, { feed } = {}) => {
        llamadas.cotizaciones.push({ n: lista.length, feed });
        if (estado.caido) throw Object.assign(new Error('red'), { name: 'IntegrationError', codigo: 'RED', mensaje: 'red' });
        return Object.fromEntries(lista.map(s => [s, { ultimo: feed ? 99 : estado.precio, cierre: 98, cierreAnterior: 95, volumen: 1e6, apertura: 96, maximo: 101, minimo: 94, fechaSesion: iso(AHORA - 13 * 3600000), fechaDato: iso(s === 'VIEJA' ? AHORA - 20 * DIA : AHORA - 60000) }]));
      },
      velasLote: async (lista, o) => { llamadas.velas.push(o.feed); return Object.fromEntries(lista.map((s, k) => [s, Array.from({ length: 260 }, (_, i) => { const c = 80 + (k ? -1 : 1) * i * 0.05 + Math.sin(i / 3); return { fecha: iso(AHORA - (260 - i) * DIA), apertura: c, maximo: c + 1, minimo: c - 1, cierre: c, volumen: 1e6 }; })])); },
      snapshotsOpciones: async s => { llamadas.opciones++; if (estado.fallarIv > 0) { estado.fallarIv--; throw limite(); } return [{ contratoExternoId: s + '261218C00100000', bid: 1, ask: 1.1, volatilidadImplicita: 0.4, griegas: {}, fechaDato: iso(AHORA - estado.edadIv) }]; },
    },
    sec: {
      tickers: async () => new Map(Object.entries(CIK).map(([s, cik]) => [s, { cik }])),
      marco: async ({ concepto, periodo }) => {
        if (concepto.endsWith('WeightedAverageNumberOfDilutedSharesOutstanding') && periodo === 'CY2026Q3') return [{ cik: CIK.UNO, valor: 5e8 }, { cik: CIK.DOSA, valor: 4e8 }, { cik: CIK.SINOP, valor: 9e9 }, { cik: CIK.VIEJA, valor: 3e8 }];
        if (concepto.endsWith('EntityCommonStockSharesOutstanding') && periodo === 'CY2026Q2I') return [{ cik: CIK.EXTR, valor: 8e8 }];
        if (concepto.endsWith('EntityPublicFloat') && periodo === 'CY2025Q2I') return [{ cik: CIK.UNO, valor: 4e10 }, { cik: CIK.DOSA, valor: 3e10 }];
        return [];
      },
      perfil: async cik => { llamadas.perfiles.push(cik); return { sic: cik === CIK.UNO ? 7372 : 3674, industria: cik === CIK.UNO ? 'Services-Prepackaged Software' : 'Semiconductors', presenta10Q: cik !== CIK.EXTR }; },
    },
  };
  return { integraciones, llamadas, estado };
}
const crear = (f, extra = {}) => createUniversoVivo({ integraciones: f.integraciones, factory: memoryFactory(), ahora: () => AHORA, ritmoIvMs: 0, esperar: async () => {}, esperarLimite: async () => {}, ...extra });

test('Capitalización: descarta cifras con errores de unidades y respeta la coherente', () => {
  // Acciones × precio y flotante coinciden → acciones (se actualiza con el precio).
  assert.deepEqual(elegirCapitalizacion({ acciones: 1e9, flotante: 8e10, precio: 100, dineroDia: 6e8 }), { acciones: 1e9, capitalizacion: 1e11 });
  // Flotante reportado ×1000: se elige el que cuadra con lo negociado.
  assert.equal(elegirCapitalizacion({ acciones: 5e7, flotante: 6e12, precio: 100, dineroDia: 3e7 }).capitalizacion, 5e9);
  // Acciones mal reportadas: gana el flotante (y sin número de acciones).
  assert.deepEqual(elegirCapitalizacion({ acciones: 1e6, flotante: 5e10, precio: 100, dineroDia: 3e8 }), { acciones: null, capitalizacion: 5e10 });
  // Solo una cifra y no es creíble frente a lo negociado.
  assert.equal(elegirCapitalizacion({ acciones: null, flotante: 8e11, precio: 10, dineroDia: 3e7 }), null);
  assert.equal(elegirCapitalizacion({ acciones: 1e9, flotante: null, precio: 0, dineroDia: 1 }), null);
  assert.deepEqual(trimestres(3, new Date('2026-02-10')), ['CY2026Q1', 'CY2025Q4', 'CY2025Q3']);
});

test('Sector a partir del código SIC', () => {
  const casos = { 3674: 'Tecnología', 7372: 'Tecnología', 2834: 'Salud', 6324: 'Salud', 6022: 'Finanzas', 6798: 'Inmobiliario', 1311: 'Energía', 4911: 'Servicios públicos', 5331: 'Consumo básico', 2080: 'Consumo básico', 5961: 'Consumo discrecional', 3711: 'Consumo discrecional', 4813: 'Comunicación', 3312: 'Materiales', 3721: 'Industria y servicios' };
  for (const [sic, sector] of Object.entries(casos)) assert.equal(sectorDeSic(Number(sic)), sector, sic);
  assert.equal(sectorDeSic(null), 'Sin clasificar');
});

test('Catálogo: sale de los proveedores, reparte clases y exige opciones', async () => {
  const f = fakes();
  const lista = await createCatalogo({ integraciones: f.integraciones, ahora: () => AHORA }).construir();
  assert.ok(!lista.some(c => c.simbolo === 'SINOP'), 'sin opciones queda fuera');
  assert.equal(lista.find(c => c.simbolo === 'DOSA').acciones, 2e8, 'dos clases: se reparte');
  assert.equal(lista.find(c => c.simbolo === 'EXTR').porConfirmar, true);
  assert.equal(lista.find(c => c.simbolo === 'UNO').porConfirmar, false);
});

test('El código no contiene listas de empresas', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'data')), false);
});

test('Cotización: IEX en sesión, cierre oficial con el mercado cerrado y primeros minutos', () => {
  const iex = { ultimo: 101, fechaDato: 'x' }, hoy = '2026-11-24';
  const sip = { ultimo: 100, cierre: 100, cierreAnterior: 80, volumen: 5, maximo: 100, minimo: 79, fechaSesion: '2026-11-24T05:00:00Z' };
  assert.deepEqual([combinarCotizacion(iex, sip, { abierto: true, hoy })].map(q => [q.precio, q.cambioPct, q.maximo, q.volumen])[0], [101, 0.2625, 101, 5]);
  assert.equal(combinarCotizacion(iex, sip, { abierto: false, hoy }).precio, 100);
  const temprano = combinarCotizacion(iex, { ...sip, fechaSesion: '2026-11-23T05:00:00Z' }, { abierto: true, hoy });
  assert.equal(temprano.cierreAnterior, 100); assert.equal(temprano.cambioPct, 0.01); assert.equal(temprano.volumen, null);
  assert.equal(combinarCotizacion(null, null, { abierto: true, hoy }), null);
  assert.equal(combinarCotizacion(iex, null, { abierto: true, hoy: '2026-11-24' }).precio, 101);
});

test('Pasada completa: ranking automático, IV, perfiles y descarte de extranjeras y bajas', async () => {
  const f = fakes({ fallarIv: 2 }), u = crear(f);
  assert.equal(u.listo(), false);
  await u.actualizarAhora();
  const m = await u.mapa();
  assert.deepEqual(m.items.map(i => i.simbolo).sort(), ['DOSA', 'DOSB', 'UNO'], 'VIEJA no cotiza; EXTR no presenta 10-Q');
  const uno = m.items.find(i => i.simbolo === 'UNO');
  assert.equal(uno.nombre, 'UNO Corp'); assert.equal(uno.sector, 'Tecnología'); assert.equal(uno.precio, 100); assert.equal(uno.capitalizacion, 5e10);
  assert.ok(uno.puntajes.LONG_CALL >= 0 && uno.cambio5d != null);
  assert.equal(uno.ivPromedio, 0.4); assert.ok(uno.hv20 > 0);
  assert.equal(u.estado().fase, 'lista'); assert.equal(u.estado().conIv, 3, 'el límite del proveedor se reintenta, no se pierde el dato');
  assert.ok(f.llamadas.velas.every(x => x === 'sip'));
  const r = await createScreener({ factory: memoryFactory(), universo: u }).ranking({ userId: 'u', database: 'mongodb' }, { limite: 2 });
  assert.equal(r.estrategias.LONG_CALL.length, 2); assert.equal(r.universo.total, 3); assert.equal(r.universo.fase, 'lista');
});

test('Mapa: caché, una sola actualización simultánea y último valor si el proveedor falla', async () => {
  let t = AHORA;
  const f = fakes(), u = crear(f, { ahora: () => t });
  await Promise.all([u.mapa(), u.mapa(), u.mapa()]);
  const base = f.llamadas.cotizaciones.length;
  await u.mapa();
  assert.equal(f.llamadas.cotizaciones.length, base, 'dentro del TTL no se consulta');
  t += TTL_ABIERTO_MS + 1; f.estado.precio = 110;
  const [a, b] = await Promise.all([u.mapa(), u.mapa()]);
  assert.equal(f.llamadas.cotizaciones.length, base + 2, 'IEX + consolidado, una sola vez');
  assert.equal(a.items.find(i => i.simbolo === 'UNO').precio, 110); assert.equal(b.desactualizado, false);
  t += TTL_ABIERTO_MS + 1; f.estado.caido = true;
  const c = await u.mapa();
  assert.equal(c.desactualizado, true); assert.equal(c.items.find(i => i.simbolo === 'UNO').precio, 110);
});

test('Ficha: datos en vivo, símbolo inválido o fuera del universo', async () => {
  const f = fakes(), u = crear(f);
  await u.actualizarAhora();
  const x = await u.ficha('UNO');
  assert.equal(x.velas.length, 260); assert.ok(x.maximo52 > x.minimo52); assert.ok(x.resumenes.LONG_CALL); assert.equal(x.maximo, 101);
  await assert.rejects(u.ficha('NOESTA'), e => e.output.statusCode === 404);
  await assert.rejects(u.ficha('../x'), e => e.output.statusCode === 400);
});

test('Persistencia: un reinicio recupera el ranking al instante y sin volver a pedir perfiles', async () => {
  const f = fakes(), factory = memoryFactory();
  await crear(f, { factory }).actualizarAhora();
  const g = fakes(), u = crear(g, { factory });
  await u.recuperar();
  assert.equal(u.listo(), true); assert.equal(u.filas().length, 3);
  assert.equal(g.llamadas.listar + g.llamadas.velas.length, 0, 'sin llamar a proveedores');
  await u.actualizarAhora();
  assert.ok(!g.llamadas.perfiles.includes('0000000001'), 'el giro ya conocido se reutiliza');
  assert.equal((await factory('screener', { userId: 'otro', database: 'mongodb' }).list({})).length, 0);
  assert.equal((await factory('screener', { userId: PROPIETARIO_SISTEMA, database: 'mongodb' }).list({})).length, 3);
});

test('Catálogo caído: espera creciente de 1 a 30 minutos, error visible y recuperación', async () => {
  let t = AHORA;
  const f = fakes(), u = crear(f, { ahora: () => t });
  f.estado.sinCatalogo = true;
  await u.actualizarAhora();
  assert.equal(u.estado().fase, 'error'); assert.match(u.estado().catalogo.error, /Sin red/); assert.match(u.estado().aviso, /Sin red/);
  assert.equal(u.estado().catalogo.actualizadoEn, null);
  for (const [espera, esperadas] of [[30000, 1], [31000, 2], [61000, 2], [60000, 3]]) { t += espera; await u.actualizarAhora(); assert.equal(f.llamadas.listar, esperadas); }
  await assert.rejects(u.mapa(), e => e.output.statusCode === 503);
  assert.equal(f.llamadas.listar, 3, 'durante la espera no se consulta al proveedor');
  for (let i = 0; i < 6; i++) { t += 30 * 60000; await u.actualizarAhora(); }
  assert.equal(f.llamadas.listar, 9, 'la espera no pasa de 30 minutos');
  f.estado.sinCatalogo = false; t += 30 * 60000;
  await u.actualizarAhora();
  assert.equal(u.estado().fase, 'lista'); assert.equal(u.estado().catalogo.error, undefined); assert.ok(u.estado().catalogo.actualizadoEn);
});

test('Arranque: con datos guardados la fase es «lista» aunque el proveedor esté caído', async () => {
  const f = fakes(), factory = memoryFactory();
  await crear(f, { factory }).actualizarAhora();
  const g = fakes(); g.estado.sinCatalogo = true; g.estado.caido = true;
  const u = crear(g, { factory });
  u.iniciar();
  try {
    for (let i = 0; i < 50 && !u.listo(); i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(u.estado().fase, 'lista'); assert.equal(u.filas().length, 3);
  } finally { u.detener(); }
});

test('Guardado: una fila inválida no impide guardar las demás y queda registrada', async () => {
  const f = fakes(), factory = memoryFactory(), previa = f.integraciones.alpaca.velasLote;
  f.integraciones.alpaca.velasLote = async (l, o) => { const v = await previa(l, o); v.UNO[100].maximo = undefined; return v; };
  const errores = [], original = console.error;
  console.error = (...a) => errores.push(a.join(' '));
  try { await crear(f, { factory }).actualizarAhora(); } finally { console.error = original; }
  const filas = await factory('screener', { userId: PROPIETARIO_SISTEMA, database: 'mongodb' }).list({});
  assert.deepEqual(filas.map(x => x.document.simbolo).sort(), ['DOSA', 'DOSB']);
  assert.ok(errores.some(e => /1 fila\(s\) no se guardan\. UNO/.test(e)), errores.join('|'));
});

test('Movimientos: alzas, bajas y volumen inusual desde memoria, sin consultar proveedores', async () => {
  let t = AHORA;
  const f = fakes(), u = crear(f, { ahora: () => t });
  assert.deepEqual(u.movimientos(), { abierto: null, actualizadoEn: null, desactualizado: true, total: 0, alzas: [], bajas: [], volumenInusual: [] });
  const previa = f.integraciones.alpaca.cotizacionesLote;
  f.integraciones.alpaca.cotizacionesLote = async (l, o) => { const q = await previa(l, o); if (q.DOSA) q.DOSA.ultimo = 90; if (q.DOSB) q.DOSB.volumen = 3e6; return q; };
  await u.actualizarAhora();
  const antes = JSON.stringify(f.llamadas), m = u.movimientos();
  assert.equal(JSON.stringify(f.llamadas), antes);
  assert.equal(m.abierto, true); assert.equal(m.desactualizado, false); assert.equal(m.total, 3);
  assert.deepEqual(m.alzas.map(i => i.simbolo), ['DOSB', 'UNO']); assert.deepEqual(m.bajas.map(i => i.simbolo), ['DOSA']);
  assert.deepEqual(m.volumenInusual.map(i => [i.simbolo, i.volumenRelativo]), [['DOSB', 3], ['DOSA', 1], ['UNO', 1]]);
  assert.deepEqual(m.alzas[1], { simbolo: 'UNO', nombre: 'UNO Corp', precio: 100, cambioPct: 0.052632, volumenRelativo: 1, capitalizacion: 5e10 });
  t += TTL_ABIERTO_MS + 1;
  assert.equal(u.movimientos().desactualizado, true);
});

test('Volatilidad implícita: solo opciones de menos de una sesión y en el dinero', async () => {
  const velas = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'].map(d => ({ fecha: d + 'T05:00:00Z' }));
  const op = (strike, fechaDato, extra = {}) => ({ strike, tipo: 'call', vencimiento: '2026-12-18', volatilidadImplicita: 0.3, fechaDato, ...extra });
  const base = { precio: 100, velas, hoy: '2026-11-24' }, hoy = '2026-11-24T16:00:00Z', ayer = '2026-11-23T20:00:00Z';
  // Abierto: valen hoy y la sesión anterior; cerrado (con la sesión de hoy terminada): solo hoy.
  const lista = [op(95, hoy), op(99, hoy), op(102, ayer), op(101, '2026-11-20T20:00:00Z'), op(100, null), op(100, hoy, { volatilidadImplicita: null })];
  assert.deepEqual(opcionesParaIv(lista, { ...base, abierto: true }).map(o => o.strike), [99, 102]);
  assert.deepEqual(opcionesParaIv(lista, { ...base, abierto: false }).map(o => o.strike), [99, 95]);
  // Fin de semana: la última sesión es la del viernes.
  assert.deepEqual(opcionesParaIv([op(100, '2026-11-20T20:00:00Z'), op(101, '2026-11-19T20:00:00Z')], { precio: 100, velas: velas.slice(0, 2), hoy: '2026-11-22', abierto: false }).map(o => o.strike), [100]);
  const f = fakes(), u = crear(f);
  f.estado.edadIv = 5 * DIA;
  await u.actualizarAhora();
  assert.equal(u.estado().conIv, 0, 'una IV de hace 5 días no se usa');
});

test('conReintento: reintenta solo el límite del proveedor', async () => {
  let n = 0;
  assert.equal(await conReintento(async () => { if (++n < 3) throw limite(); return 'ok'; }, { esperar: async () => {} }), 'ok');
  await assert.rejects(conReintento(async () => { throw new Error('otro'); }, { esperar: async () => assert.fail('no debe esperar') }));
  n = 0; await assert.rejects(conReintento(async () => { n++; throw limite(); }, { intentos: 2, esperar: async () => {} })); assert.equal(n, 2);
});

test('SEC: marco y perfil se normalizan; periodo sin datos → lista vacía', async () => {
  const resp = (status, cuerpo) => ({ ok: status === 200, status, headers: { get: () => null }, text: async () => JSON.stringify(cuerpo) });
  const sec = createSecClient({ userAgent: 'prueba', esperar: async () => {}, fetch: async u => (u.includes('CY2026Q9') || u.includes('CY2020Q1') ? resp(404, {}) : u.includes('frames') ? resp(200, { data: [{ cik: 7, val: 10 }, { cik: 8, val: 'x' }] }) : resp(200, { name: 'A', sic: '7372', sicDescription: 'Software', filings: { recent: { form: ['8-K', '10-Q'] } } })) });
  assert.deepEqual(await sec.marco({ concepto: 'dei/EntityPublicFloat', unidad: 'USD', periodo: 'CY2025Q2I' }), [{ cik: '0000000007', valor: 10 }]);
  assert.deepEqual(await sec.marco({ concepto: 'dei/EntityPublicFloat', unidad: 'USD', periodo: 'CY2020Q1I' }), []);
  await assert.rejects(sec.marco({ concepto: '../x', unidad: 'USD', periodo: 'CY2025Q2I' }), e => e.codigo === 'VALIDACION');
  const p = await sec.perfil(7);
  assert.equal(p.sic, 7372); assert.equal(p.presenta10Q, true);
});
