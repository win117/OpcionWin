// Decisión con los cinco cores: combinación, carga sin filtro en el universo, lectura masiva de 13F y aviso de análisis parcial.
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryFactory } = require('./helpers/memory.cjs');
const { combinarCores, coresDeFila, createScreener, evaluarCore } = require('../dist/api/v1/services/screener.service');
const { createUniversoVivo, VIGENCIA_CORE_MS } = require('../dist/api/v1/services/universo-vivo.service');
const { createSecClient } = require('../dist/integrations/sec.client');

const DIA = 86400000, AHORA = Date.UTC(2026, 10, 24, 18), iso = t => new Date(t).toISOString();
const CINCO = ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias'];
const ev = (sesgo, confianza = 0.8) => ({ sesgo, confianza, puntaje: 50 + 50 * sesgo, cobertura: 1, actualizadoEn: new Date(AHORA) });

test('combinarCores: los cinco votan; uno fuerte cambia el resultado y uno sin datos no cuenta', () => {
  const precio = { tecnico: ev(-0.2), indicadores: ev(-0.1) };
  const dos = combinarCores(precio).puntajes;
  const cinco = combinarCores({ ...precio, fundamental: ev(0.9), noticias: ev(0.7), institucional: ev(0.8) });
  assert.ok(dos.LONG_PUT > dos.LONG_CALL, 'con solo precio gana el put');
  assert.ok(cinco.puntajes.LONG_CALL > cinco.puntajes.LONG_PUT, 'los otros tres cambian la decisión');
  for (const nombre of ['Técnico', 'Fundamental', 'Institucional', 'Indicadores', 'Noticias']) assert.ok(cinco.factores.LONG_CALL.some(f => f.nombre === nombre), nombre);
  const sinDatos = combinarCores({ ...precio, noticias: { confianza: 0, cobertura: 0, actualizadoEn: new Date() } });
  assert.deepEqual(sinDatos.puntajes, dos, 'evaluado sin datos no es neutral: no vota');
  assert.equal(combinarCores({}).puntajes.LONG_CALL, null);
});

test('coresDeFila: distingue opinó, sin datos y pendiente', () => {
  const f = coresDeFila({ cores: { tecnico: ev(0.1), noticias: { confianza: 0 } } });
  assert.deepEqual(Object.fromEntries(f.map(c => [c.core, c.estado])), { tecnico: 'ok', fundamental: 'pendiente', institucional: 'pendiente', indicadores: 'pendiente', noticias: 'sin_datos' });
  assert.ok(coresDeFila({}).every(c => c.estado === 'pendiente'));
  assert.equal(evaluarCore('noticias', { noticias: [] }, iso(AHORA)).sesgo, undefined);
});

// Universo de 3 empresas; BAJA va mal en precio y bien en lo demás.
function fakes({ noticiasFallan = false, secFalla = false } = {}) {
  const llamadas = { noticias: [], fundamentales: [], masivo: 0, tenencias: [] };
  const NOMBRES = { SUBE: 'Sube Inc.', BAJA: 'Baja Inc.', PLANA: 'Plana Inc.' }, CIK = { SUBE: '0000000001', BAJA: '0000000002', PLANA: '0000000003' };
  const periodo = (fin, ingresos, utilidad) => ({ periodoInicio: iso(Date.parse(fin) - 90 * DIA).slice(0, 10), periodoFin: fin, forma: '10-Q',
    metricas: [['ingresos', ingresos], ['utilidad_neta', utilidad], ['activos', 1000], ['pasivos', 200], ['capital', 800], ['activo_circulante', 500], ['pasivo_circulante', 100], ['flujo_operativo', utilidad]].map(([nombre, valor]) => ({ nombre, valor, unidad: 'USD', periodo: 'CY' })) });
  const integraciones = {
    alpaca: {
      feed: 'iex', configurado: true, reloj: async () => ({ abierto: true }),
      listarActivos: async () => Object.entries(NOMBRES).map(([simbolo, nombre]) => ({ simbolo, nombre, negociable: true, opciones: true })),
      cotizacionesLote: async lista => Object.fromEntries(lista.map(s => [s, { ultimo: 100, cierre: 100, cierreAnterior: 99, volumen: 1e6, fechaSesion: iso(AHORA - 13 * 3600000), fechaDato: iso(AHORA) }])),
      velasLote: async lista => Object.fromEntries(lista.map(s => [s, Array.from({ length: 260 }, (_, i) => { const c = (s === 'BAJA' ? 250 - i * 0.5 : s === 'SUBE' ? 60 + i * 0.5 : 100) + Math.sin(i / 3); return { fecha: iso(AHORA - (260 - i) * DIA), apertura: c, maximo: c + 1, minimo: c - 1, cierre: c, volumen: 1e6 }; })])),
      snapshotsOpciones: async () => [],
      noticias: async ({ simbolos: [s] }) => { llamadas.noticias.push(s); if (noticiasFallan) throw Object.assign(new Error('x'), { codigo: 'PROVEEDOR', mensaje: 'caído' }); return s === 'PLANA' ? [] : [{ titulo: s + ' beats estimates, shares surge on strong growth', publicadaEn: iso(AHORA - 3600000) }]; },
    },
    sec: {
      tickers: async () => new Map(Object.entries(CIK).map(([s, cik]) => [s, { cik }])),
      marco: async ({ concepto, periodo: p }) => (concepto.endsWith('WeightedAverageNumberOfDilutedSharesOutstanding') && p === 'CY2026Q3' ? Object.values(CIK).map((cik, i) => ({ cik, valor: 5e8 - i * 1e8 })) : []),
      perfil: async () => ({ sic: 7372, industria: 'Software', presenta10Q: true }),
      fundamentales: async cik => { llamadas.fundamentales.push(cik); if (secFalla) throw Object.assign(new Error('x'), { codigo: 'PROVEEDOR', mensaje: 'caído' }); return [periodo('2026-09-30', 150, 40), periodo('2025-09-30', 100, 20)]; },
      cargarTenencias13F: async () => { llamadas.masivo += 1; },
      tenencias13F: async ({ nombreEmisor, soloMasivo }) => {
        llamadas.tenencias.push([nombreEmisor, soloMasivo]);
        if (nombreEmisor.startsWith('Plana')) throw Object.assign(new Error('no'), { codigo: 'NO_ENCONTRADO', mensaje: 'no' });
        return [['2026-09-30', 120], ['2026-06-30', 100]].map(([c, n]) => ({ fechaCorte: c, fechaPublicacion: c, tenencias: ['a', 'b', 'c'].map(id => ({ identificadorInstitucion: id, institucion: id, acciones: n })) }));
      },
    },
  };
  return { integraciones, llamadas };
}
const crear = (f, extra = {}) => createUniversoVivo({ integraciones: f.integraciones, factory: memoryFactory(), ahora: () => AHORA, ritmoIvMs: 0, ritmoSecMs: 0, esperar: async () => {}, esperarLimite: async () => {}, ...extra });

test('Universo: evalúa los cinco cores de todas las empresas, sin filtro previo', async () => {
  const f = fakes(), u = crear(f);
  await u.actualizarAhora();
  assert.deepEqual(f.llamadas.noticias.sort(), ['BAJA', 'PLANA', 'SUBE']); assert.equal(f.llamadas.fundamentales.length, 3);
  assert.equal(f.llamadas.masivo, 1, 'una sola lectura 13F para todas'); assert.ok(f.llamadas.tenencias.every(t => t[1] === true));
  const e = u.estado();
  assert.deepEqual(e.porCore, Object.fromEntries(CINCO.map(c => [c, 3]))); assert.equal(e.completas, 3); assert.equal(e.fase, 'lista');
  const baja = u.filas().find(x => x.simbolo === 'BAJA');
  assert.ok(baja.cores.tecnico.sesgo < 0 && baja.cores.fundamental.sesgo > 0 && baja.cores.noticias.sesgo > 0 && baja.cores.institucional.sesgo > 0);
  assert.ok(baja.factores.LONG_CALL.some(x => x.nombre === 'Fundamental'));
  const r = await createScreener({ factory: memoryFactory(), universo: u }).ranking({ userId: 'u', database: 'mongodb' }, { limite: 5 });
  const plana = r.estrategias.LONG_CALL.find(x => x.simbolo === 'PLANA');
  assert.equal(plana.cores.find(c => c.core === 'institucional').estado, 'sin_datos');
  assert.equal((await u.mapa()).items.find(i => i.simbolo === 'SUBE').coresEvaluados, 5);
  assert.equal((await u.ficha('SUBE')).cores.length, 5);
});

test('Universo: cada core se renueva a su ritmo y lo guardado se reutiliza tras un reinicio', async () => {
  let t = AHORA;
  const f = fakes(), factory = memoryFactory(), u = crear(f, { factory, ahora: () => t });
  await u.actualizarAhora();
  const g = fakes(), v = crear(g, { factory, ahora: () => t });
  await v.recuperar();
  assert.equal(v.estado().completas, 3, 'los cinco cores sobreviven al reinicio');
  await v.actualizarAhora();
  assert.equal(g.llamadas.noticias.length + g.llamadas.fundamentales.length + g.llamadas.masivo, 0, 'nada vencido: no se pide');
  t += VIGENCIA_CORE_MS.noticias + 1;
  await v.actualizarAhora();
  assert.equal(g.llamadas.noticias.length, 3); assert.equal(g.llamadas.fundamentales.length, 0);
});

test('Universo: si un proveedor falla, los demás cores siguen y se avisa', async () => {
  const f = fakes({ noticiasFallan: true }), u = crear(f), original = console.error;
  console.error = () => {};
  try { await u.actualizarAhora(); } finally { console.error = original; }
  const e = u.estado();
  assert.equal(e.porCore.noticias, 0); assert.equal(e.porCore.fundamental, 3); assert.equal(e.porCore.institucional, 3); assert.equal(e.completas, 0);
  assert.ok(u.filas().every(x => Number.isFinite(x.puntajes.LONG_CALL)), 'el ranking sigue disponible');
});

test('SEC: lectura masiva de 13F, una descarga por tabla para todas las empresas', async () => {
  const fila = (nombre, cusip, n, extra = '') => `<infoTable><nameOfIssuer>${nombre}</nameOfIssuer><titleOfClass>COM${extra}</titleOfClass><cusip>${cusip}</cusip><value>${n * 10}</value><shrsOrPrnAmt><sshPrnamt>${n}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>`;
  const pedidos = [];
  const ciks = ['0000000011', '0000000012', '0000000013'];
  const cuerpoTexto = t => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => t });
  const sub = 'ACCESSION_NUMBER\tSUBMISSIONTYPE\tCIK\tPERIODOFREPORT\n' + ciks.map((c, i) => `A${i}\t13F-HR\t${Number(c)}\t30-SEP-2026`).join('\n');
  const sum = 'ACCESSION_NUMBER\tTABLEVALUETOTAL\n' + ciks.map((c, i) => `A${i}\t${900 - i}`).join('\n');
  // Zip mínimo sin compresión con las dos tablas del ranking.
  const zip = (() => { const partes = [], dir = []; let pos = 0; for (const [n, t] of [['SUBMISSION.tsv', sub], ['SUMMARYPAGE.tsv', sum]]) { const nb = Buffer.from(n), d = Buffer.from(t), l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(nb.length, 26); partes.push(l, nb, d); const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(pos, 42); dir.push(c, nb); pos += 30 + nb.length + d.length; } const dirb = Buffer.concat(dir), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(2, 10); fin.writeUInt32LE(dirb.length, 12); fin.writeUInt32LE(pos, 16); return Buffer.concat([...partes, dirb, fin]); })();
  const fetch = async (u, init) => {
    pedidos.push(u);
    if (u.includes('form-13f-data-sets')) return cuerpoTexto('<a href="/files/2026q3_form13f.zip">x</a>');
    if (u.endsWith('form13f.zip')) { const r = /bytes=(-?)(\d+)-?(\d*)/.exec(init.headers.Range); const ini = r[1] ? Math.max(0, zip.length - Number(r[2])) : Number(r[2]), fin = r[1] ? zip.length : Math.min(zip.length, Number(r[3]) + 1); return { ok: true, status: 206, headers: { get: () => `bytes ${ini}-${fin - 1}/${zip.length}` }, arrayBuffer: async () => { const b = zip.subarray(ini, fin); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; }
    const s = /submissions\/CIK(\d+)/.exec(u);
    if (s) return cuerpoTexto(JSON.stringify({ name: 'Gestora ' + Number(s[1]), filings: { recent: { form: ['13F-HR', '13F-HR'], accessionNumber: [`${s[1]}-26-000002`, `${s[1]}-26-000001`], filingDate: ['2026-11-10', '2026-08-10'], reportDate: ['2026-09-30', '2026-06-30'] } } }));
    if (u.endsWith('index.json')) return cuerpoTexto(JSON.stringify({ directory: { item: [{ name: 'infotable.xml' }, { name: 'primary_doc.xml' }] } }));
    if (u.endsWith('infotable.xml')) { const nuevo = u.includes('26000002'); if (u.includes('/13/') && nuevo) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' }; return cuerpoTexto('<t>' + fila('UNO CORP', '111111101', nuevo ? 120 : 100) + fila('UNO CORP', '111111101', 5, ' PFD') + fila('DOS &amp; CO', '222222202', 50) + '</t>'); }
    throw new Error('inesperado ' + u);
  };
  const sec = createSecClient({ userAgent: 'prueba', fetch, esperar: async () => {}, ahora: () => AHORA });
  await Promise.all([sec.cargarTenencias13F(), sec.cargarTenencias13F()]);
  const tablas = pedidos.filter(u => u.endsWith('infotable.xml')).length;
  assert.equal(tablas, 6, '3 instituciones × 2 cortes, una vez cada una');
  const r = await sec.tenencias13F({ nombreEmisor: 'Uno Corporation (Delaware)', soloMasivo: true });
  assert.deepEqual(r.map(c => [c.fechaCorte, c.tenencias.length, c.tenencias[0].acciones]), [['2026-09-30', 2, 120], ['2026-06-30', 3, 100]], 'sin preferentes; la tabla que falló no inventa datos');
  assert.equal((await sec.tenencias13F({ nombreEmisor: 'Dos & Company', soloMasivo: true }))[0].tenencias[0].acciones, 50);
  assert.equal(pedidos.filter(u => u.endsWith('infotable.xml')).length, tablas, 'otra empresa no vuelve a descargar nada');
  assert.equal(r[0].tenencias[0].institucion, 'Gestora 11');
});

test('Web: participacion distingue completo, sin datos y desactivado', async () => {
  const { participacion } = await import('../web/src/utils/analisis.js');
  const evs = Object.fromEntries(CINCO.map(c => [c, { puntaje: 60 }]));
  assert.equal(participacion(CINCO, evs).completo, true);
  const p = participacion(CINCO.filter(c => c !== 'noticias'), { ...evs, institucional: { puntaje: null } });
  assert.equal(p.opinan, 3); assert.equal(p.completo, false);
  assert.deepEqual(p.faltan, [{ core: 'institucional', motivo: 'sin datos' }, { core: 'noticias', motivo: 'desactivado' }]);
});
