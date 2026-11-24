// Universo vivo: catálogo obtenido de proveedores, mapa, ranking automático y ficha (proveedores simulados, sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createUniversoVivo, combinarCotizacion, TTL_ABIERTO_MS, PROPIETARIO_SISTEMA } = require('../dist/api/v1/services/universo-vivo.service');
const { createCatalogo, elegirCapitalizacion, sectorDeSic, trimestres } = require('../dist/api/v1/services/catalogo-universo.service');
const { conReintento, createScreener } = require('../dist/api/v1/services/screener.service');
const { createSecClient } = require('../dist/integrations/sec.client');

const DIA = 86400000, AHORA = Date.UTC(2026, 10, 24, 18); // martes 13:00 en Nueva York
const iso = t => new Date(t).toISOString();
const limite = () => Object.assign(new Error('429'), { name: 'IntegrationError', codigo: 'LIMITE' });

// 5 símbolos: dos clases de la misma empresa, uno extranjero, uno sin opciones y uno que dejó de cotizar.
function fakes({ abierto = true, fallarIv = 0 } = {}) {
  const llamadas = { cotizaciones: [], velas: [], opciones: 0, perfiles: [], listar: 0 };
  const estado = { precio: 100, abierto, caido: false, fallarIv };
  const ACT = [['UNO', true], ['DOSA', true], ['DOSB', true], ['EXTR', true], ['SINOP', false], ['VIEJA', true]];
  const CIK = { UNO: '0000000001', DOSA: '0000000002', DOSB: '0000000002', EXTR: '0000000003', SINOP: '0000000004', VIEJA: '0000000005' };
  const integraciones = {
    alpaca: {
      feed: 'iex', configurado: true,
      listarActivos: async () => { llamadas.listar++; return ACT.map(([simbolo, opciones]) => ({ simbolo, nombre: simbolo + ' Corp Class A Common Stock', negociable: true, opciones })); },
      reloj: async () => ({ abierto: estado.abierto }),
      cotizacionesLote: async (lista, { feed } = {}) => {
        llamadas.cotizaciones.push({ n: lista.length, feed });
        if (estado.caido) throw Object.assign(new Error('red'), { name: 'IntegrationError', codigo: 'RED', mensaje: 'red' });
        return Object.fromEntries(lista.map(s => [s, { ultimo: feed ? 99 : estado.precio, cierre: 98, cierreAnterior: 95, volumen: 1e6, apertura: 96, maximo: 101, minimo: 94, fechaSesion: iso(AHORA - 13 * 3600000), fechaDato: iso(s === 'VIEJA' ? AHORA - 20 * DIA : AHORA - 60000) }]));
      },
      velasLote: async (lista, o) => { llamadas.velas.push(o.feed); return Object.fromEntries(lista.map((s, k) => [s, Array.from({ length: 260 }, (_, i) => { const c = 80 + (k ? -1 : 1) * i * 0.05 + Math.sin(i / 3); return { fecha: iso(AHORA - (260 - i) * DIA), apertura: c, maximo: c + 1, minimo: c - 1, cierre: c, volumen: 1e6 }; })])); },
      snapshotsOpciones: async s => { llamadas.opciones++; if (estado.fallarIv > 0) { estado.fallarIv--; throw limite(); } return [{ contratoExternoId: s + '261218C00100000', bid: 1, ask: 1.1, volatilidadImplicita: 0.4, griegas: {} }]; },
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
  assert.equal(u.estado().fase, 'lista'); assert.equal(u.estado().conIv, 3, 'el límite del proveedor se reintenta, no se pierde el dato');
  assert.ok(f.llamadas.velas.every(x => x === 'sip'));
  const r = await createScreener({ integraciones: f.integraciones, factory: memoryFactory(), universo: u }).ranking({ userId: 'u', database: 'mongodb' }, { limite: 2 });
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
