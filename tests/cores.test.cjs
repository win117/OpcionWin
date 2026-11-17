const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('../dist/cores/util');
const reglas = require('../dist/cores/reglas');
const tecnico = require('../dist/cores/tecnico.core');
const indicadores = require('../dist/cores/indicadores.core');
const fundamental = require('../dist/cores/fundamental.core');
const institucional = require('../dist/cores/institucional.core');
const noticias = require('../dist/cores/noticias.core');
const confluencia = require('../dist/cores/confluencia.core');
const estrategias = require('../dist/cores/estrategias.core');
const index = require('../dist/cores');

const REF = '2026-11-16T00:00:00.000Z';
const DIA = 86400000;
// Serie sintética determinista: tendencia lineal + oscilación senoidal.
const serie = (n, paso, base = 100) => Array.from({ length: n }, (_, i) => {
  const c = base + i * paso + Math.sin(i) * 0.8;
  return { fecha: new Date(Date.parse(REF) - (n - i) * DIA).toISOString(), apertura: c, maximo: c + 1, minimo: c - 1, cierre: c, volumen: 1000 + (i % 5) * 100 };
});
const metricaDe = (r, nombre) => (r.metricas.find(m => m.nombre === nombre) || {}).valor;
const verificarForma = r => {
  for (const k of ['sesgo', 'confianza', 'puntaje', 'cobertura', 'metricas', 'motivos', 'datosFaltantes', 'reglas']) assert.ok(k in r, `falta ${k}`);
  for (const m of r.metricas) assert.ok(Number.isFinite(m.valor), `${m.nombre} no finito`);
  if (r.sesgo != null) assert.equal(r.puntaje, Math.round((50 + 50 * r.sesgo) * 100) / 100);
  assert.ok(r.confianza >= 0 && r.confianza <= 1);
  assert.ok(r.cobertura >= 0 && r.cobertura <= 1);
};

// ---------- util ----------
test('util: SMA y SMA serie', () => {
  assert.equal(util.sma([1, 2, 3, 4, 5], 3), 4);
  assert.equal(util.sma([1, 2], 3), null);
  assert.deepEqual(util.smaSerie([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
});
test('util: RSI de Wilder con valores conocidos', () => {
  assert.equal(util.rsi([10, 11, 10, 11], 2), 75);
  assert.equal(util.rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14), 100);
  assert.equal(util.rsi(Array.from({ length: 20 }, (_, i) => 20 - i), 14), 0);
  assert.equal(util.rsi([1, 2, 3], 14), null);
});
test('util: EMA, Bollinger, pendiente y volatilidad histórica', () => {
  assert.equal(util.ema([2, 4, 6, 8], 3), 6); // semilla 4, luego 8*0.5+4*0.5
  const b = util.bollinger(Array(20).fill(10), 20, 2);
  assert.equal(b.pctB, 0.5);
  assert.equal(util.pendienteRegresion([1, 3, 5, 7]), 2);
  assert.equal(util.volatilidadHistorica(Array(30).fill(50), 20), 0);
  const alterna = Array.from({ length: 22 }, (_, i) => (i % 2 ? 110 : 100));
  const r = Math.log(1.1);
  const esperado = Math.sqrt((20 * r * r) / 19 * 1) * Math.sqrt(252); // media 0 con 10 subidas y 10 bajadas
  assert.ok(Math.abs(util.volatilidadHistorica(alterna, 20) - esperado) < 1e-9);
});
test('util: ATR con rango constante y MACD de serie plana', () => {
  const v = Array.from({ length: 20 }, () => ({ maximo: 11, minimo: 9, cierre: 10 }));
  assert.equal(util.atr(v, 14), 2);
  assert.equal(util.macd(Array(40).fill(10)).histograma, 0);
  assert.equal(util.macd(Array(30).fill(10)), null);
});

// ---------- reglas ----------
test('reglas: operadores', () => {
  assert.equal(reglas.comparar(5, 'gt', 4), true);
  assert.equal(reglas.comparar(5, 'lte', 5), true);
  assert.equal(reglas.comparar(5, 'eq', 5), true);
  assert.equal(reglas.comparar(5, 'ne', 5), false);
  assert.equal(reglas.comparar(5, 'between', 1, 10), true);
  assert.equal(reglas.comparar(11, 'between', 1, 10), false);
  assert.equal(reglas.comparar(5, 'between', 1), null);
  assert.equal(reglas.comparar(5, 'xx', 1), null);
});
test('reglas: no obligatorias suman/restan peso hacia la dirección del sesgo', () => {
  const metricas = [{ nombre: 'rsi_14', valor: 60 }];
  const ok = reglas.aplicarReglas({ sesgo: 0.4, confianza: 0.5, metricas, reglas: [{ criterio: 'rsi_14', operador: 'gt', valorReferencia: 50, peso: 10 }] });
  assert.equal(ok.puntaje, 80);
  assert.equal(ok.reglas[0].cumplida, true);
  const no = reglas.aplicarReglas({ sesgo: -0.4, confianza: 0.5, metricas, reglas: [{ criterio: 'rsi_14', operador: 'lt', valorReferencia: 50, peso: 10 }] });
  assert.equal(no.puntaje, 40); // 30 + 10 (resta en dirección bajista)
  const acotado = reglas.aplicarReglas({ sesgo: 0.9, confianza: 1, metricas, reglas: [{ criterio: 'rsi_14', operador: 'gt', valorReferencia: 50, peso: 30 }] });
  assert.equal(acotado.puntaje, 100);
});
test('reglas: obligatoria incumplida fuerza neutral y confianza 0; inactivas se ignoran; métrica faltante', () => {
  const r = reglas.aplicarReglas({
    sesgo: 0.8, confianza: 0.9, metricas: [{ nombre: 'rsi_14', valor: 60 }],
    reglas: [
      { criterio: 'rsi_14', operador: 'lt', valorReferencia: 50, peso: 5, obligatoria: true },
      { criterio: 'rsi_14', operador: 'gt', valorReferencia: 0, peso: 50, activo: false },
      { criterio: 'no_existe', operador: 'gt', valorReferencia: 0, peso: 5 },
    ],
  });
  assert.equal(r.puntaje, 50);
  assert.equal(r.confianza, 0);
  assert.equal(r.sesgo, 0);
  assert.equal(r.reglas.length, 2);
  assert.equal(r.reglas[1].cumplida, null);
  assert.ok(r.datosFaltantes.includes('metrica:no_existe'));
  assert.ok(r.motivos.some(m => m.includes('obligatoria')));
});

// ---------- técnico ----------
test('técnico: tendencia alcista → sesgo > 0 y forma del contrato', () => {
  const r = tecnico.evaluar({ fechaReferencia: REF, velas: serie(260, 0.5) });
  verificarForma(r);
  assert.ok(r.sesgo > 0.3);
  assert.equal(r.cobertura, 1);
  assert.equal(metricaDe(r, 'cruce_sma50_200'), 1);
  assert.equal(tecnico.VERSION, 'tecnico@1.0.0');
});
test('técnico: tendencia bajista → sesgo < 0', () => {
  const r = tecnico.evaluar({ fechaReferencia: REF, velas: serie(260, -0.3, 200) });
  assert.ok(r.sesgo < -0.3);
  assert.equal(metricaDe(r, 'cruce_sma50_200'), -1);
});
test('técnico: datos insuficientes → cobertura reducida y datosFaltantes', () => {
  const r = tecnico.evaluar({ fechaReferencia: REF, velas: serie(30, 0.5) });
  verificarForma(r);
  assert.ok(r.cobertura < 1 && r.cobertura > 0);
  assert.ok(r.datosFaltantes.includes('velas<200'));
  assert.ok(r.datosFaltantes.includes('velas<50'));
  const vacio = tecnico.evaluar({ fechaReferencia: REF, velas: [] });
  assert.equal(vacio.sesgo, null);
  assert.equal(vacio.puntaje, null);
  assert.equal(vacio.cobertura, 0);
});
test('técnico: ignora velas posteriores a fechaReferencia y es determinista', () => {
  const velas = serie(260, 0.5);
  const ref = velas[100].fecha;
  const a = tecnico.evaluar({ fechaReferencia: ref, velas });
  const b = tecnico.evaluar({ fechaReferencia: ref, velas: velas.slice(0, 101) });
  assert.deepEqual(a, b);
  assert.ok(a.datosFaltantes.includes('velas<200'));
});
test('técnico: regla obligatoria aplicada sobre métrica del core', () => {
  const r = tecnico.evaluar({ fechaReferencia: REF, velas: serie(260, 0.5), reglas: [{ criterio: 'precio_vs_sma50', operador: 'lt', valorReferencia: 0, peso: 1, obligatoria: true, activo: true }] });
  assert.equal(r.puntaje, 50);
  assert.equal(r.confianza, 0);
  assert.equal(r.reglas[0].cumplida, false);
});

// ---------- indicadores ----------
test('indicadores: métricas de momentum y volatilidad, sin métricas de tendencia', () => {
  const r = indicadores.evaluar({ fechaReferencia: REF, velas: serie(100, 0.5) });
  verificarForma(r);
  for (const n of ['rsi_14', 'macd_hist', 'estocastico_k', 'bollinger_pctb', 'atr_pct', 'hv_20', 'hv_60']) assert.ok(metricaDe(r, n) != null, n);
  for (const n of ['precio_vs_sma50', 'pendiente_20']) assert.equal(metricaDe(r, n), undefined);
  assert.ok(r.sesgo > 0);
});
test('indicadores: IV vs HV con opciones', () => {
  const r = indicadores.evaluar({ fechaReferencia: REF, velas: serie(100, 0.5), opciones: [{ tipo: 'call', strike: 150, vencimiento: REF, volatilidadImplicita: 0.3 }, { tipo: 'put', strike: 140, vencimiento: REF, volatilidadImplicita: 0.5 }] });
  assert.equal(metricaDe(r, 'iv_promedio'), 0.4);
  assert.ok(metricaDe(r, 'iv_hv_ratio') > 0);
});
test('indicadores: pocas velas → sesgo null o cobertura parcial', () => {
  const r = indicadores.evaluar({ fechaReferencia: REF, velas: serie(10, 1) });
  assert.equal(r.sesgo, null);
  assert.ok(r.datosFaltantes.includes('velas<15'));
  const p = indicadores.evaluar({ fechaReferencia: REF, velas: serie(25, 1) });
  assert.ok(p.sesgo != null && p.cobertura < 1);
  assert.ok(p.datosFaltantes.includes('velas<61'));
});

// ---------- fundamental ----------
const periodo = (ini, fin, metricas, forma) => ({ periodoInicio: ini, periodoFin: fin, forma, metricas: Object.entries(metricas).map(([nombre, valor]) => ({ nombre, valor, unidad: 'USD' })) });
test('fundamental: compara anual vs anual y calcula razones', () => {
  const r = fundamental.evaluar({
    fechaReferencia: REF,
    fundamentales: [
      periodo('2024-01-01', '2024-12-31', { ingresos: 1000, utilidad_neta: 100, flujo_operativo: 150 }, '10-K'),
      periodo('2025-01-01', '2025-12-31', { ingresos: 1200, utilidad_neta: 150, flujo_operativo: 240, pasivos: 500, capital: 1000, activo_circulante: 300, pasivo_circulante: 150 }, '10-K'),
      periodo('2025-07-01', '2025-09-30', { ingresos: 9999, utilidad_neta: 1 }, '10-Q'), // trimestre: no se mezcla con anual
    ],
  });
  verificarForma(r);
  // El trimestre (fin 2025-09-30) es anterior al anual de 2025-12-31; el base es el anual más reciente.
  assert.equal(metricaDe(r, 'crecimiento_ingresos_yoy'), 20);
  assert.equal(metricaDe(r, 'crecimiento_utilidad_yoy'), 50);
  assert.equal(metricaDe(r, 'margen_neto'), 12.5);
  assert.equal(metricaDe(r, 'margen_flujo_operativo'), 20);
  assert.equal(metricaDe(r, 'deuda_capital'), 0.5);
  assert.equal(metricaDe(r, 'razon_corriente'), 2);
  assert.ok(r.sesgo > 0);
  assert.equal(r.cobertura, 1);
});
test('fundamental: trimestre vs mismo trimestre del año previo', () => {
  const r = fundamental.evaluar({
    fechaReferencia: REF,
    fundamentales: [
      periodo('2026-07-01', '2026-09-30', { ingresos: 80, utilidad_neta: -10 }),
      periodo('2026-04-01', '2026-06-30', { ingresos: 200, utilidad_neta: 50 }),
      periodo('2025-07-01', '2025-09-30', { ingresos: 100, utilidad_neta: 10 }),
    ],
  });
  assert.equal(metricaDe(r, 'crecimiento_ingresos_yoy'), -20);
  assert.equal(metricaDe(r, 'crecimiento_utilidad_yoy'), -200);
  assert.ok(r.sesgo < 0);
  assert.ok(r.datosFaltantes.includes('deuda_capital'));
});
test('fundamental: sin datos → sesgo null', () => {
  const r = fundamental.evaluar({ fechaReferencia: REF, fundamentales: [] });
  verificarForma(r);
  assert.equal(r.sesgo, null);
  assert.ok(r.datosFaltantes.includes('fundamentales'));
});

// ---------- institucional ----------
const tenencia = (id, acciones) => ({ institucion: id, identificadorInstitucion: id, acciones, valorReportado: acciones * 10, unidad: 'USD' });
test('institucional: compara los dos cortes más recientes', () => {
  const r = institucional.evaluar({
    fechaReferencia: REF,
    reportes: [
      { fechaCorte: '2026-03-31', fechaPublicacion: '2026-05-15', tenencias: [tenencia('A', 1000), tenencia('B', 1000), tenencia('C', 500)] },
      { fechaCorte: '2026-06-30', fechaPublicacion: '2026-08-14', tenencias: [tenencia('A', 1500), tenencia('B', 800), tenencia('D', 700)] },
      { fechaCorte: '2025-12-31', fechaPublicacion: '2026-02-14', tenencias: [tenencia('A', 1)] },
    ],
  });
  verificarForma(r);
  assert.equal(metricaDe(r, 'cambio_acciones_pct'), 20); // 3000 / 2500
  assert.equal(metricaDe(r, 'instituciones_aumentan'), 1);
  assert.equal(metricaDe(r, 'instituciones_disminuyen'), 1);
  assert.equal(metricaDe(r, 'instituciones_nuevas'), 1);
  assert.equal(metricaDe(r, 'instituciones_salen'), 1);
  assert.ok(r.sesgo > 0);
  assert.ok(r.motivos.some(m => m.includes('45 días')));
});
test('institucional: un solo corte o reporte no publicado aún → sin sesgo', () => {
  const r = institucional.evaluar({
    fechaReferencia: '2026-07-01T00:00:00Z',
    reportes: [
      { fechaCorte: '2026-03-31', fechaPublicacion: '2026-05-15', tenencias: [tenencia('A', 1000)] },
      { fechaCorte: '2026-06-30', fechaPublicacion: '2026-08-14', tenencias: [tenencia('A', 2000)] },
    ],
  });
  assert.equal(r.sesgo, null);
  assert.ok(r.datosFaltantes.includes('reportes<2'));
});

// ---------- noticias ----------
test('noticias: léxico con negación (inglés y español)', () => {
  assert.ok(noticias.puntuarTexto('Apple beats estimates, shares surge').puntaje > 0);
  assert.ok(noticias.puntuarTexto('Company did not beat estimates').puntaje < 0);
  assert.ok(noticias.puntuarTexto('Las acciones caen tras pérdidas').puntaje < 0);
  assert.ok(noticias.puntuarTexto('Resultados sin pérdidas').puntaje > 0);
  assert.equal(noticias.puntuarTexto('The constructor meeting').puntaje, 0);
});
test('noticias: decaimiento por antigüedad prioriza lo reciente', () => {
  const dias = d => new Date(Date.parse(REF) - d * DIA).toISOString();
  const r = noticias.evaluar({
    fechaReferencia: REF,
    noticias: [
      { titulo: 'Shares surge on record profits', publicadaEn: dias(0.5), proveedor: 'x' },
      { titulo: 'Stock plunges after fraud probe', publicadaEn: dias(20), proveedor: 'x' },
      { titulo: 'Stock plunges after fraud probe', publicadaEn: dias(20), proveedor: 'y' }, // duplicado
      { titulo: 'Futura: crash', publicadaEn: dias(-1), proveedor: 'x' }, // posterior a la referencia
    ],
  });
  verificarForma(r);
  assert.equal(metricaDe(r, 'noticias_analizadas'), 2);
  assert.equal(metricaDe(r, 'noticias_positivas'), 1);
  assert.equal(metricaDe(r, 'noticias_negativas'), 1);
  assert.ok(r.sesgo > 0.5);
});
test('noticias: sin noticias → sesgo null', () => {
  const r = noticias.evaluar({ fechaReferencia: REF, noticias: [] });
  assert.equal(r.sesgo, null);
  assert.ok(r.datosFaltantes.includes('noticias'));
});

// ---------- confluencia ----------
const evals = [
  { core: 'tecnico', sesgo: 0.6, confianza: 1, puntaje: 80, cobertura: 1 },
  { core: 'noticias', sesgo: 0.2, confianza: 0.5, puntaje: 60, cobertura: 1 },
];
test('confluencia: LONG_CALL y LONG_PUT con promedio ponderado peso×confianza', () => {
  const base = { evaluaciones: evals, ponderaciones: [{ core: 'tecnico', peso: 1 }, { core: 'noticias', peso: 2 }], coresSeleccionados: ['tecnico', 'noticias', 'fundamental'] };
  const call = confluencia.evaluar({ ...base, estrategia: 'LONG_CALL' });
  assert.equal(call.sesgoCombinado, 0.4); // (1·0.6 + 1·0.2)/2
  assert.equal(call.puntaje, 70);
  assert.equal(call.cobertura, 0.6667);
  assert.deepEqual(call.ponderacionesEfectivas, [{ core: 'tecnico', peso: 0.5 }, { core: 'noticias', peso: 0.5 }, { core: 'fundamental', peso: 0 }]);
  const put = confluencia.evaluar({ ...base, estrategia: 'LONG_PUT' });
  assert.equal(put.puntaje, 30);
});
test('confluencia: IRON_CONDOR con ajuste de IV', () => {
  const base = { estrategia: 'IRON_CONDOR', evaluaciones: [{ core: 'tecnico', sesgo: 0.2, confianza: 1 }], coresSeleccionados: ['tecnico'] };
  assert.equal(confluencia.evaluar(base).puntaje, 80);
  assert.equal(confluencia.evaluar({ ...base, volatilidad: { ivActual: 0.36, hv20: 0.3 } }).puntaje, 95);
  assert.equal(confluencia.evaluar({ ...base, volatilidad: { ivActual: 0.15, hv20: 0.3 } }).puntaje, 65);
  assert.equal(confluencia.evaluar({ ...base, evaluaciones: [{ core: 'tecnico', sesgo: 0, confianza: 1 }], volatilidad: { ivActual: 0.6, hv20: 0.3 } }).puntaje, 100);
});
test('confluencia: sin resultados → puntaje 50, cobertura 0; estrategia inválida lanza', () => {
  const r = confluencia.evaluar({ estrategia: 'LONG_CALL', evaluaciones: [{ core: 'tecnico', sesgo: null }], coresSeleccionados: ['tecnico'] });
  assert.equal(r.puntaje, 50);
  assert.equal(r.cobertura, 0);
  assert.equal(r.sesgoCombinado, null);
  assert.throws(() => confluencia.evaluar({ estrategia: 'STRADDLE' }));
});

// ---------- estrategias ----------
const pata = (tipo, accion, strike, precio, extra = {}) => ({ tipo, accion, strike, precio, cantidad: 1, vencimiento: '2026-12-18', ...extra });
const met = (r, n) => (r.metricas.find(m => m.nombre === n) || {}).valor;
test('estrategias: LONG_CALL con ganancia ilimitada', () => {
  const r = estrategias.evaluarConfiguracion({ estrategia: 'LONG_CALL', componentes: [pata('call', 'buy', 100, 2.5, { cantidad: 2 })], precioSubyacente: 110 });
  assert.equal(r.valida, true);
  assert.equal(met(r, 'prima_neta'), -500);
  assert.equal(met(r, 'perdida_maxima'), 500);
  assert.equal(met(r, 'ganancia_maxima'), null);
  assert.equal(met(r, 'breakeven'), 102.5);
  assert.equal(met(r, 'resultado_vencimiento_precio_actual'), 1500);
});
test('estrategias: LONG_PUT y validación de tipo/acción', () => {
  const r = estrategias.evaluarConfiguracion({ estrategia: 'LONG_PUT', componentes: [pata('put', 'buy', 50, 2)] });
  assert.equal(met(r, 'ganancia_maxima'), 4800);
  assert.equal(met(r, 'breakeven'), 48);
  const mal = estrategias.evaluarConfiguracion({ estrategia: 'LONG_PUT', componentes: [pata('call', 'buy', 50, 2)] });
  assert.equal(mal.valida, false);
  assert.equal(mal.metricas.length, 0);
});
const condor = () => [pata('put', 'buy', 90, 1), pata('put', 'sell', 95, 2.5), pata('call', 'sell', 105, 2.5), pata('call', 'buy', 110, 1)];
test('estrategias: IRON_CONDOR payoff', () => {
  const r = estrategias.evaluarConfiguracion({ estrategia: 'IRON_CONDOR', componentes: condor(), precioSubyacente: 100 });
  assert.equal(r.valida, true, r.errores.join());
  assert.equal(met(r, 'prima_neta'), 300);
  assert.equal(met(r, 'ganancia_maxima'), 300);
  assert.equal(met(r, 'perdida_maxima'), 200);
  assert.equal(met(r, 'breakeven_inferior'), 92);
  assert.equal(met(r, 'breakeven_superior'), 108);
  assert.equal(met(r, 'resultado_vencimiento_precio_actual'), 300);
  assert.equal(estrategias.payoff(condor(), 80), -200);
  assert.equal(estrategias.payoff(condor(), 120), -200);
});
test('estrategias: IRON_CONDOR errores de validación', () => {
  const casos = [
    [condor().slice(0, 3), /4 componentes/],
    [condor().map((c, i) => (i === 3 ? { ...c, vencimiento: '2027-01-15' } : c)), /mismo vencimiento/],
    [condor().map((c, i) => (i === 0 ? { ...c, cantidad: 2 } : c)), /cantidades iguales/],
    [condor().map((c, i) => (i === 1 ? { ...c, strike: 106 } : c)), /Strikes/],
    [condor().map((c, i) => (i === 0 ? { ...c, accion: 'sell' } : c)), /1 put comprado/],
    [condor().map((c, i) => (i === 0 ? { ...c, strike: -1 } : c)), /strike/],
  ];
  for (const [componentes, patron] of casos) {
    const r = estrategias.evaluarConfiguracion({ estrategia: 'IRON_CONDOR', componentes });
    assert.equal(r.valida, false);
    assert.ok(r.errores.some(e => patron.test(e)), `${patron} en ${r.errores}`);
  }
});
test('estrategias: sin precios no calcula montos; delta neta si hay griegas', () => {
  const r = estrategias.evaluarConfiguracion({ estrategia: 'LONG_CALL', componentes: [{ ...pata('call', 'buy', 100), precio: undefined, griegas: { delta: 0.55 } }] });
  assert.equal(r.valida, true);
  assert.equal(met(r, 'prima_neta'), undefined);
  assert.equal(met(r, 'delta_neta'), 55);
});

// ---------- index ----------
test('index: exporta cores con VERSION, REQUIERE y evaluar', () => {
  assert.deepEqual(Object.keys(index.cores).sort(), ['fundamental', 'indicadores', 'institucional', 'noticias', 'tecnico']);
  for (const [nombre, core] of Object.entries(index.cores)) {
    assert.equal(core.VERSION, `${nombre}@1.0.0`);
    assert.ok(Array.isArray(core.REQUIERE));
    const r = core.evaluar({ fechaReferencia: REF, velas: [], fundamentales: [], reportes: [], noticias: [], reglas: [] });
    verificarForma(r);
    assert.equal(r.sesgo, null);
  }
  assert.equal(typeof index.confluencia.evaluar, 'function');
  assert.equal(typeof index.estrategias.evaluarConfiguracion, 'function');
  assert.equal(typeof index.reglas.aplicarReglas, 'function');
});
