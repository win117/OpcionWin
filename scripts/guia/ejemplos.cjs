// Ejemplos numéricos de docs/guia-explicativa.md ejecutados con el código REAL compilado (dist/).
// Uso (PowerShell):  npm.cmd run build ; node scripts/guia/ejemplos.cjs [seccion]
// Secciones: basicos, tecnico, indicadores, fundamental, institucional, noticias, confluencia, bs, estrategias, orden, todo (defecto).
// Entradas sintéticas y deterministas (sin red, sin base de datos, sin reloj: la fecha de referencia es fija).
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const raiz = path.resolve(__dirname, '..', '..');
const dist = p => require(path.join(raiz, 'dist', p));
const util = dist('cores/util.js');
const tecnico = dist('cores/tecnico.core.js');
const indicadores = dist('cores/indicadores.core.js');
const fundamental = dist('cores/fundamental.core.js');
const institucional = dist('cores/institucional.core.js');
const noticias = dist('cores/noticias.core.js');
const confluencia = dist('cores/confluencia.core.js');
const estrategias = dist('cores/estrategias.core.js');
const bs = dist('cores/blackscholes.js');
const alpaca = dist('integrations/alpaca.client.js');

const REF = '2026-11-17T15:00:00.000Z';
const DIA = 86400000;
const r4 = x => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1e4) / 1e4);
const met = (r, n) => (r.metricas.find(m => m.nombre === n) || {}).valor;
const titulo = t => console.log('\n==== ' + t + ' ====');
const linea = (...a) => console.log(...a);
const resumen = (nombre, r) => linea(`${nombre}: sesgo ${r.sesgo} · confianza ${r.confianza} · cobertura ${r.cobertura} · puntaje ${r.puntaje}`);

// ---------- Serie de velas "DEMO": 280 sesiones, tendencia de largo plazo alcista y retroceso en las últimas 15 ----------
function velasDemo() {
  const n = 280;
  const out = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const ruido = 2.4 * Math.sin(i * 1.3) + 1.3 * Math.cos(i * 0.7);
    const paso = i < n - 15 ? 0.22 : -0.55; // sube ~0.22/día; últimas 15 sesiones baja ~0.55/día
    const previo = c;
    c = 100 + 0.22 * Math.min(i, n - 15) - 0.55 * Math.max(0, i - (n - 15)) + ruido;
    const apertura = i ? previo : c;
    const maximo = Math.max(apertura, c) + 0.6 + 0.2 * Math.abs(Math.sin(i));
    const minimo = Math.min(apertura, c) - 0.6 - 0.2 * Math.abs(Math.cos(i));
    const volumen = i === n - 1 ? 1_650_000 : Math.round(1_000_000 * (1 + 0.15 * Math.sin(i / 3)));
    out.push({ fecha: new Date(Date.parse('2026-11-16T21:00:00Z') - (n - 1 - i) * DIA).toISOString(), apertura, maximo, minimo, cierre: c, volumen });
    void paso;
  }
  return out;
}
const VELAS = velasDemo();
const CIERRES = VELAS.map(v => v.cierre);
const ULTIMO = CIERRES.at(-1);

// Opciones cercanas al dinero para el core indicadores (IV indicativa, fracción anual).
const OPCIONES = [
  { tipo: 'call', strike: Math.round(ULTIMO), vencimiento: '2026-12-18', volatilidadImplicita: 0.24 },
  { tipo: 'put', strike: Math.round(ULTIMO), vencimiento: '2026-12-18', volatilidadImplicita: 0.26 },
  { tipo: 'call', strike: Math.round(ULTIMO) + 2, vencimiento: '2026-12-18', volatilidadImplicita: 0.23 },
  { tipo: 'put', strike: Math.round(ULTIMO) - 2, vencimiento: '2026-12-18', volatilidadImplicita: 0.27 },
  { tipo: 'call', strike: Math.round(ULTIMO), vencimiento: '2026-11-01', volatilidadImplicita: 0.90 }, // vencido: se ignora
  { tipo: 'put', strike: Math.round(ULTIMO), vencimiento: '2026-12-18', volatilidadImplicita: 7.5 }, // absurda (>5): se ignora
];

const FUND = (() => {
  const p = (ini, fin, m, forma) => ({ periodoInicio: ini, periodoFin: fin, forma, metricas: Object.entries(m).map(([nombre, valor]) => ({ nombre, valor, unidad: 'USD' })) });
  return [
    p('2026-07-01', '2026-09-30', { ingresos: 12.0e9, utilidad_neta: 1.8e9, flujo_operativo: 2.6e9, pasivos: 30e9, capital: 20e9, activo_circulante: 15e9, pasivo_circulante: 10e9, eps_diluido: 1.42 }, '10-Q'),
    p('2026-04-01', '2026-06-30', { ingresos: 11.4e9, utilidad_neta: 1.6e9, flujo_operativo: 2.2e9 }, '10-Q'),
    p('2025-07-01', '2025-09-30', { ingresos: 10.5e9, utilidad_neta: 1.7e9, flujo_operativo: 2.1e9 }, '10-Q'),
    p('2025-01-01', '2025-12-31', { ingresos: 42.0e9, utilidad_neta: 6.5e9 }, '10-K'), // anual: no se mezcla con trimestres
  ];
})();

const t13 = (id, nombre, acciones) => ({ institucion: nombre, identificadorInstitucion: id, acciones, valorReportado: acciones * 150, unidad: 'USD' });
const REPORTES = [
  { fechaCorte: '2026-09-30', fechaPublicacion: '2026-11-13', tenencias: [
    t13('0002100119', 'Vanguard Capital Management LLC', 52_000_000), t13('0002012383', 'BlackRock, Inc.', 44_500_000),
    t13('0000093751', 'State Street Corp', 21_000_000), t13('0000315066', 'FMR LLC', 9_800_000),
    t13('0001214717', 'Geode Capital Management, LLC', 6_300_000), t13('0000895421', 'Morgan Stanley', 3_000_000)] },
  { fechaCorte: '2026-06-30', fechaPublicacion: '2026-08-14', tenencias: [
    t13('0002100119', 'Vanguard Capital Management LLC', 50_000_000), t13('0002012383', 'BlackRock, Inc.', 45_000_000),
    t13('0000093751', 'State Street Corp', 20_000_000), t13('0000315066', 'FMR LLC', 11_000_000),
    t13('0001214717', 'Geode Capital Management, LLC', 6_000_000), t13('0000019617', 'JPMorgan Chase & Co', 2_500_000)] },
];

const hace = d => new Date(Date.parse(REF) - d * DIA).toISOString();
const NOTICIAS = [
  { titulo: 'DEMO significantly beats estimates as cloud revenue surges', resumen: '', publicadaEn: hace(0.5) },
  { titulo: 'Analyst warns of slowing demand in Europe', resumen: '', publicadaEn: hace(2) },
  { titulo: 'DEMO shares slightly lower after guidance cut', resumen: '', publicadaEn: hace(4) },
  { titulo: 'DEMO did not miss estimates, regulator says', resumen: '', publicadaEn: hace(6) },
  { titulo: 'DEMO to host investor day in December', resumen: '', publicadaEn: hace(1) },
  { titulo: 'DEMO significantly beats estimates as cloud revenue surges', resumen: 'duplicado de otro proveedor', publicadaEn: hace(0.4) },
  { titulo: 'DEMO record quarter', resumen: '', publicadaEn: hace(40) }, // fuera de la ventana de 30 días
];

const secciones = {
  basicos() {
    titulo('BÁSICOS: retornos, volatilidad y √252');
    const c = [100, 102, 99, 101, 104, 103];
    const simples = c.slice(1).map((x, i) => x / c[i] - 1);
    const logs = c.slice(1).map((x, i) => Math.log(x / c[i]));
    linea('cierres', c.join(', '));
    linea('retornos simples', simples.map(r4).join(', '), '| suma', r4(simples.reduce((a, b) => a + b, 0)), '| compuesto real', r4(c.at(-1) / c[0] - 1));
    linea('retornos log    ', logs.map(r4).join(', '), '| suma', r4(logs.reduce((a, b) => a + b, 0)), '| ln(103/100)', r4(Math.log(1.03)));
    const media = logs.reduce((a, b) => a + b, 0) / logs.length;
    const desv = util.desviacion(logs, true);
    linea('media log', r4(media), '| desv. muestral diaria', r4(desv), '| ×√252 =', r4(desv * Math.sqrt(252)), '| util.volatilidadHistorica(c,5) =', r4(util.volatilidadHistorica(c, 5)));
    linea('√252 =', r4(Math.sqrt(252)), '| √21 =', r4(Math.sqrt(21)), '| 0.30/√252 =', r4(0.30 / Math.sqrt(252)));
    linea('SMA3 de los cierres =', util.smaSerie(c, 3).map(r4).join(', '));
    linea('EMA3 (α = 2/4 = 0.5) =', util.emaSerie(c, 3).map(r4).join(', '));
    linea('RSI(5) de los cierres =', r4(util.rsi(c, 5)));
    linea('pendienteRegresion(c) =', r4(util.pendienteRegresion(c)), 'USD/vela');
    linea('tanh(0.5), tanh(1), tanh(2), tanh(3) =', [0.5, 1, 2, 3].map(x => r4(Math.tanh(x))).join(', '));
  },

  tecnico() {
    titulo('CORE TÉCNICO (serie DEMO de 280 velas)');
    const sma50 = util.sma(CIERRES, 50), sma200 = util.sma(CIERRES, 200);
    const v20 = CIERRES.slice(-20);
    const w = VELAS.slice(-252);
    const max = Math.max(...w.map(v => v.maximo)), min = Math.min(...w.map(v => v.minimo));
    const volMedia = util.promedio(VELAS.slice(-21, -1).map(v => v.volumen));
    linea('último cierre', r4(ULTIMO), '| cierre previo', r4(CIERRES.at(-2)), '| SMA50', r4(sma50), '| SMA200', r4(sma200));
    linea('pendiente 20 (USD/vela)', r4(util.pendienteRegresion(v20)), '| promedio 20', r4(util.promedio(v20)));
    linea('máx 252', r4(max), '| mín 252', r4(min), '| vol. último', VELAS.at(-1).volumen, '| vol. medio 20 previas', r4(volMedia));
    const r = tecnico.evaluar({ velas: VELAS, fechaReferencia: REF });
    for (const m of r.metricas) linea('  métrica', m.nombre, m.valor, m.unidad);
    const mapa = {
      precio_vs_sma50: x => Math.tanh(x / 5), precio_vs_sma200: x => Math.tanh(x / 10), pendiente_20: x => Math.tanh(x / 0.5),
      posicion_rango_52s: x => 2 * (x - 0.5),
    };
    let sp = 0, spv = 0, spa = 0;
    for (const s of tecnico.SENALES) {
      let v;
      if (s.nombre === 'cruce_sma50_200') v = util.clamp(met(r, 'diferencia_sma50_200') / 5);
      else if (s.nombre === 'volumen_relativo_20') v = Math.sign(CIERRES.at(-1) - CIERRES.at(-2)) * util.clamp(met(r, 'volumen_relativo_20') - 1, 0, 1);
      else v = mapa[s.nombre](met(r, s.nombre));
      sp += s.pesoBase; spv += s.pesoBase * v; spa += s.pesoBase * Math.abs(v);
      linea(`  señal ${s.nombre.padEnd(20)} valor ${r4(v)}  peso ${s.pesoBase}  p·v ${r4(s.pesoBase * v)}`);
    }
    linea('  Σp', sp, '| Σp·v', r4(spv), '| Σp·|v|', r4(spa), '| sesgo', r4(spv / sp), '| consistencia', r4(Math.abs(spv) / spa), '| intensidad', r4(spa / sp));
    resumen('  resultado', r);
    r.motivos.forEach(m => linea('  motivo:', m));
    const pocas = tecnico.evaluar({ velas: VELAS.slice(-30), fechaReferencia: REF });
    resumen('  con solo 30 velas', pocas); linea('  datosFaltantes', pocas.datosFaltantes.join(', '));
    const filtrado = tecnico.evaluar({ velas: VELAS, fechaReferencia: REF, parametros: { indicadores: ['precio_vs_sma200', 'pendiente_20'] } });
    resumen('  solo precio_vs_sma200 + pendiente_20', filtrado);
    const conRegla = tecnico.evaluar({ velas: VELAS, fechaReferencia: REF, reglas: [{ core: 'tecnico', criterio: 'precio_vs_sma200', operador: 'gt', valorReferencia: 0, peso: 5, obligatoria: false }] });
    resumen('  regla no obligatoria precio_vs_sma200 gt 0 peso 5', conRegla);
    const obligatoria = tecnico.evaluar({ velas: VELAS, fechaReferencia: REF, reglas: [{ core: 'tecnico', criterio: 'pendiente_20', operador: 'gt', valorReferencia: 0, peso: 1, obligatoria: true }] });
    resumen('  regla OBLIGATORIA pendiente_20 gt 0', obligatoria);
  },

  indicadores() {
    titulo('CORE INDICADORES (serie DEMO + opciones)');
    const m = util.macd(CIERRES), e = util.estocastico(VELAS), b = util.bollinger(CIERRES);
    linea('RSI14', r4(util.rsi(CIERRES, 14)), '| MACD', r4(m.macd), 'señal', r4(m.senal), 'hist', r4(m.histograma), '| hist % precio', r4(m.histograma / ULTIMO * 100));
    linea('%K', r4(e.k), '%D', r4(e.d), '| Bollinger media', r4(b.media), 'sup', r4(b.superior), 'inf', r4(b.inferior), '%B', r4(b.pctB));
    linea('ATR14', r4(util.atr(VELAS, 14)), '| HV20', r4(util.volatilidadHistorica(CIERRES, 20)), '| HV60', r4(util.volatilidadHistorica(CIERRES, 60)));
    linea('senalOscilador RSI(30/70):', [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 100].map(v => `${v}→${r4(indicadores.senalOscilador(v, 30, 70))}`).join('  '));
    linea('senalOscilador Est(20/80):', [0, 10, 20, 35, 50, 65, 80, 90, 100].map(v => `${v}→${r4(indicadores.senalOscilador(v, 20, 80))}`).join('  '));
    const r = indicadores.evaluar({ velas: VELAS, opciones: OPCIONES, fechaReferencia: REF });
    for (const x of r.metricas) linea('  métrica', x.nombre, x.valor, x.unidad);
    const sR = indicadores.senalOscilador(met(r, 'rsi_14'), 30, 70);
    const sM = Math.tanh((met(r, 'macd_hist') / ULTIMO * 100) / 0.5);
    const sE = indicadores.senalOscilador(met(r, 'estocastico_k'), 20, 80);
    const sB = util.clamp(2 * (met(r, 'bollinger_pctb') - 0.5));
    linea('  señales: rsi', r4(sR), '| macd', r4(sM), '| est', r4(sE), '| %B', r4(sB));
    const c = util.combinar([{ valor: sR, peso: 1 }, { valor: sM, peso: 1 }, { valor: sE, peso: 0.75 }, { valor: sB, peso: 0.75 }]);
    linea('  combinar →', JSON.stringify({ sesgo: r4(c.sesgo), confianza: r4(c.confianza), cobertura: c.cobertura }), '| cobertura total = (4 dir + 4 vol)/(4+4)');
    resumen('  resultado', r);
    r.motivos.forEach(x => linea('  motivo:', x));
    const sinOpc = indicadores.evaluar({ velas: VELAS, fechaReferencia: REF });
    resumen('  sin opciones', sinOpc);
  },

  fundamental() {
    titulo('CORE FUNDAMENTAL (trimestres DEMO)');
    const r = fundamental.evaluar({ fundamentales: FUND, fechaReferencia: REF });
    for (const x of r.metricas) linea('  métrica', x.nombre, x.valor, x.unidad, x.periodo || '');
    const v = {
      ing: Math.tanh(met(r, 'crecimiento_ingresos_yoy') / 10), ut: Math.tanh(met(r, 'crecimiento_utilidad_yoy') / 20),
      mn: Math.tanh(met(r, 'margen_neto') / 10), dc: util.clamp(1.5 - met(r, 'deuda_capital')), rc: util.clamp(met(r, 'razon_corriente') - 1),
      fo: Math.tanh(met(r, 'margen_flujo_operativo') / 15),
    };
    linea('  señales', JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)]))));
    const sp = 1.5 + 1 + 1 + 1 + 0.75 + 1;
    const spv = 1.5 * v.ing + v.ut + v.mn + v.dc + 0.75 * v.rc + v.fo;
    const spa = 1.5 * Math.abs(v.ing) + Math.abs(v.ut) + Math.abs(v.mn) + Math.abs(v.dc) + 0.75 * Math.abs(v.rc) + Math.abs(v.fo);
    linea('  Σp', sp, 'Σp·v', r4(spv), 'Σp|v|', r4(spa), 'sesgo', r4(spv / sp), 'consistencia', r4(Math.abs(spv) / spa), 'intensidad', r4(spa / sp));
    resumen('  resultado', r);
    r.motivos.forEach(x => linea('  motivo:', x));
    const negativo = fundamental.evaluar({ fechaReferencia: REF, fundamentales: [{ ...FUND[0], metricas: FUND[0].metricas.map(x => (x.nombre === 'capital' ? { ...x, valor: -2e9 } : x)) }, FUND[2]] });
    linea('  capital negativo → deuda_capital señal −1; sesgo', negativo.sesgo);
    const perdida = fundamental.evaluar({ fechaReferencia: REF, fundamentales: [
      { periodoInicio: '2026-07-01', periodoFin: '2026-09-30', metricas: [{ nombre: 'ingresos', valor: 100 }, { nombre: 'utilidad_neta', valor: -5 }] },
      { periodoInicio: '2025-07-01', periodoFin: '2025-09-30', metricas: [{ nombre: 'ingresos', valor: 90 }, { nombre: 'utilidad_neta', valor: -20 }] }] });
    linea('  pérdida −20 → −5: crecimiento_utilidad_yoy =', met(perdida, 'crecimiento_utilidad_yoy'), '% (|U1| en el denominador)');
  },

  institucional() {
    titulo('CORE INSTITUCIONAL (13F DEMO)');
    const r = institucional.evaluar({ reportes: REPORTES, fechaReferencia: REF });
    for (const x of r.metricas) linea('  métrica', x.nombre, x.valor, x.unidad, x.periodo || '');
    const pct = met(r, 'cambio_acciones_pct');
    linea('  señal cambio tanh(', pct, '/10) =', r4(Math.tanh(pct / 10)), '| amplitud', met(r, 'amplitud_instituciones'));
    resumen('  resultado', r);
    r.motivos.forEach(x => linea('  motivo:', x));
    const split = institucional.evaluar({ fechaReferencia: REF, reportes: [
      { fechaCorte: '2026-06-30', fechaPublicacion: '2026-08-14', tenencias: [t13('A', 'A', 10_100), t13('B', 'B', 19_800), t13('C', 'C', 50_500)] },
      { fechaCorte: '2026-03-31', fechaPublicacion: '2026-05-15', tenencias: [t13('A', 'A', 1_000), t13('B', 'B', 2_000), t13('C', 'C', 5_000)] }] });
    linea('  split: razones 10.1, 9.9, 10.1 → factor', met(split, 'factor_split'), '| cambio', met(split, 'cambio_acciones_pct'), '% | sesgo', split.sesgo);
    linea('  detectarSplit([2.02,1.98,2.0]) =', institucional.detectarSplit([2.02, 1.98, 2.0]), '| detectarSplit([1.3,1.2,1.25]) =', institucional.detectarSplit([1.3, 1.2, 1.25]), '| con 2 instituciones [10,10] =', institucional.detectarSplit([10, 10]));
    const viejo = institucional.evaluar({ reportes: REPORTES, fechaReferencia: '2027-03-01T00:00:00Z' });
    linea('  mismo 13F evaluado el 2027-03-01 (152 días desde el corte): confianza', viejo.confianza, 'vs', r.confianza);
  },

  noticias() {
    titulo('CORE NOTICIAS (titulares DEMO, referencia ' + REF + ')');
    for (const n of NOTICIAS.slice(0, 5)) {
      const p = noticias.puntuarTexto(n.titulo);
      const edad = (Date.parse(REF) - Date.parse(n.publicadaEn)) / DIA;
      linea(`  "${n.titulo}" edad ${r4(edad)} d → pos ${p.positivo} neg ${p.negativo} p ${r4(p.puntaje)} f ${r4(p.fuerza)} decaimiento ${r4(0.5 ** (edad / 3))} peso ${r4(0.5 ** (edad / 3) * p.fuerza)}`);
    }
    const r = noticias.evaluar({ noticias: NOTICIAS, fechaReferencia: REF });
    for (const x of r.metricas) linea('  métrica', x.nombre, x.valor, x.unidad, x.periodo || '');
    resumen('  resultado', r);
    r.motivos.forEach(x => linea('  motivo:', x));
    const vm10 = noticias.evaluar({ noticias: NOTICIAS, fechaReferencia: REF, parametros: { vidaMediaDias: 10 } });
    resumen('  vidaMediaDias = 10', vm10);
    linea('  0.5^(1/3), 0.5^(2/3), 0.5^(4/3), 0.5^(6/3) =', [1, 2, 4, 6].map(d => r4(0.5 ** (d / 3))).join(', '), '| λ = ln2/3 =', r4(Math.log(2) / 3));
    linea('  1 − e^(−x/2) para x = 0.5, 1, 2, 4:', [0.5, 1, 2, 4].map(x => r4(1 - Math.exp(-x / 2))).join(', '));
  },

  confluencia() {
    titulo('CONFLUENCIA con los 5 cores DEMO');
    const ev = {
      tecnico: tecnico.evaluar({ velas: VELAS, fechaReferencia: REF }),
      indicadores: indicadores.evaluar({ velas: VELAS, opciones: OPCIONES, fechaReferencia: REF }),
      fundamental: fundamental.evaluar({ fundamentales: FUND, fechaReferencia: REF }),
      institucional: institucional.evaluar({ reportes: REPORTES, fechaReferencia: REF }),
      noticias: noticias.evaluar({ noticias: NOTICIAS, fechaReferencia: REF }),
    };
    const evaluaciones = Object.entries(ev).map(([core, r]) => ({ core, sesgo: r.sesgo, confianza: r.confianza }));
    const cores = Object.keys(ev);
    const vol = { ivActual: met(ev.indicadores, 'iv_promedio'), hv20: met(ev.indicadores, 'hv_20') };
    for (const e of evaluaciones) linea(`  ${e.core.padEnd(13)} s ${e.sesgo}  c ${e.confianza}  e = 1·c = ${e.confianza}`);
    const sumaE = evaluaciones.reduce((a, e) => a + e.confianza, 0);
    const sbar = evaluaciones.reduce((a, e) => a + e.confianza * e.sesgo, 0) / sumaE;
    const D = Math.sqrt(evaluaciones.reduce((a, e) => a + e.confianza * (e.sesgo - sbar) ** 2, 0) / sumaE);
    const N = evaluaciones.reduce((a, e) => a + e.confianza * (1 - Math.abs(e.sesgo)), 0) / sumaE;
    linea('  a mano: Σe', r4(sumaE), '| s̄', r4(sbar), '| D', r4(D), '| A', r4(1 - D), '| N̄', r4(N), '| IV', vol.ivActual, 'HV20', vol.hv20, '| IV/HV', r4(vol.ivActual / vol.hv20));
    linea('  aportes a s̄ (e·s):', evaluaciones.map(e => `${e.core} ${r4(e.confianza * e.sesgo)}`).join(', '));
    linea('  aportes a D (e·(s−s̄)²):', evaluaciones.map(e => `${e.core} ${r4(e.confianza * (e.sesgo - sbar) ** 2)}`).join(', '));
    for (const estrategia of confluencia.ESTRATEGIAS) {
      const r = confluencia.evaluar({ estrategia, evaluaciones, coresSeleccionados: cores, ponderaciones: cores.map(core => ({ core, peso: 1 })), volatilidad: vol });
      linea(`  ${estrategia.padEnd(11)} puntaje ${r.puntaje}  confianza ${r.confianza}  s̄ ${r.sesgoCombinado}  D ${r.dispersion}  A ${r.acuerdo}`);
      if (estrategia === 'IRON_CONDOR') { r.motivos.forEach(x => linea('    motivo:', x)); linea('    ponderacionesEfectivas', JSON.stringify(r.ponderacionesEfectivas)); }
    }
    const pesos = [{ core: 'tecnico', peso: 3 }, { core: 'indicadores', peso: 1 }, { core: 'fundamental', peso: 1 }, { core: 'institucional', peso: 1 }, { core: 'noticias', peso: 0 }];
    for (const estrategia of confluencia.ESTRATEGIAS) {
      const r = confluencia.evaluar({ estrategia, evaluaciones, coresSeleccionados: cores, ponderaciones: pesos, volatilidad: vol });
      linea(`  pesos técnico 3, noticias 0 → ${estrategia.padEnd(11)} ${r.puntaje}  (s̄ ${r.sesgoCombinado}, A ${r.acuerdo})`);
    }
    linea('  ajusteVolatilidad para IV/HV = 0.8, 0.9, 1.0, 1.1, 1.2, 1.3:', [0.8, 0.9, 1, 1.1, 1.2, 1.3].map(x => r4(confluencia.ajusteVolatilidad({ ivActual: x * 0.3, hv20: 0.3 }).ajuste)).join(', '));
    titulo('CASO NVDA (ADR-012), confianzas 0.8');
    const nv = [['fundamental', 1], ['tecnico', -0.6], ['indicadores', -0.8], ['noticias', 0]].map(([core, sesgo]) => ({ core, sesgo, confianza: 0.8 }));
    for (const estrategia of confluencia.ESTRATEGIAS) {
      const r = confluencia.evaluar({ estrategia, evaluaciones: nv, coresSeleccionados: nv.map(e => e.core) });
      linea(`  ${estrategia.padEnd(11)} 1.1.0 → ${r.puntaje}  (s̄ ${r.sesgoCombinado}, D ${r.dispersion}, A ${r.acuerdo}, confianza ${r.confianza})`);
    }
    linea('  1.0.0 (a mano): IC = 100(1−|−0.1|) = 90 ; LONG_PUT = 50 + 50·0.1 = 55 ; LONG_CALL = 45');
  },

  bs() {
    titulo('BLACK-SCHOLES');
    const libro = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };
    const c = bs.opcion({ ...libro, tipo: 'call' }), p = bs.opcion({ ...libro, tipo: 'put' });
    linea('  libro: d1', r4(c.d1), 'd2', r4(c.d2), 'N(d1)', r4(bs.cdf(c.d1)), 'N(d2)', r4(bs.cdf(c.d2)), '| call', r4(c.precio), 'put', r4(p.precio));
    linea('  paridad: C − P =', r4(c.precio - p.precio), '| S − K·e^(−rT) =', r4(100 - 100 * Math.exp(-0.05)));
    linea('  griegas call: Δ', r4(c.delta), 'Γ', c.gamma.toFixed(6), 'Θ/día', c.theta.toFixed(5), 'vega/pt', r4(c.vega), 'rho/pt', r4(c.rho), '| put Δ', r4(p.delta), 'Θ/día', p.theta.toFixed(5));
    linea('  IV recuperada desde 10.4506:', r4(bs.volatilidadImplicita({ ...libro, tipo: 'call', precio: 10.4506 })));
    linea('  cdf(0), cdf(1), cdf(1.645), cdf(1.96), cdf(−1.96):', [0, 1, 1.645, 1.96, -1.96].map(x => bs.cdf(x).toFixed(7)).join(', '));
    const T = 30 / 365;
    const base = { S: 100, K: 100, T, r: 0.04, sigma: 0.30 };
    const c30 = bs.opcion({ ...base, tipo: 'call' }), p30 = bs.opcion({ ...base, tipo: 'put' });
    linea('  ATM 30 días, σ 30 %, r 4 %: call', r4(c30.precio), 'put', r4(p30.precio), '| d1', r4(c30.d1), 'd2', r4(c30.d2));
    linea('    call Δ', r4(c30.delta), 'Γ', r4(c30.gamma), 'Θ/día', r4(c30.theta), 'vega', r4(c30.vega), 'rho', r4(c30.rho), '| put Δ', r4(p30.delta), 'Θ/día', r4(p30.theta));
    const up = bs.opcion({ ...base, S: 101, tipo: 'call' }), sigUp = bs.opcion({ ...base, sigma: 0.31, tipo: 'call' }), dia = bs.opcion({ ...base, T: 29 / 365, tipo: 'call' });
    linea('    verificación por diferencias: precio(S=101) − precio(S=100) =', r4(up.precio - c30.precio), '| Δ(101) − Δ(100) =', r4(up.delta - c30.delta));
    linea('      precio(σ=31 %) − precio(σ=30 %) =', r4(sigUp.precio - c30.precio), '| precio(T=29d) − precio(T=30d) =', r4(dia.precio - c30.precio));
    for (const K of [90, 95, 100, 105, 110]) {
      const cc = bs.opcion({ ...base, K, tipo: 'call' }), pp = bs.opcion({ ...base, K, tipo: 'put' });
      linea(`    K ${K}: call ${r4(cc.precio)} (Δ ${r4(cc.delta)}, N(d2) ${r4(cc.probabilidadITM)}, intrínseco ${Math.max(0, 100 - K)}, extrínseco ${r4(cc.precio - Math.max(0, 100 - K))}) | put ${r4(pp.precio)} (Δ ${r4(pp.delta)}, N(−d2) ${r4(pp.probabilidadITM)})`);
    }
    linea('  probabilidadSobre(S=100, X=105, T=30d, σ=0.30):', r4(bs.probabilidadSobre({ S: 100, X: 105, T, r: 0.04, sigma: 0.3 })));
  },

  estrategias() {
    titulo('ESTRATEGIAS: payoff al vencimiento por precio final (por 1 contrato, USD)');
    const V = '2026-12-18';
    const LC = [{ tipo: 'call', accion: 'buy', strike: 100, cantidad: 1, vencimiento: V, precio: 3.60, volatilidadImplicita: 0.30, griegas: { delta: 0.53 } }];
    const LP = [{ tipo: 'put', accion: 'buy', strike: 100, cantidad: 1, vencimiento: V, precio: 3.00, volatilidadImplicita: 0.31, griegas: { delta: -0.46 } }];
    const IC = [
      { tipo: 'put', accion: 'buy', strike: 90, cantidad: 1, vencimiento: V, precio: 0.60, volatilidadImplicita: 0.32 },
      { tipo: 'put', accion: 'sell', strike: 95, cantidad: 1, vencimiento: V, precio: 1.50, volatilidadImplicita: 0.30 },
      { tipo: 'call', accion: 'sell', strike: 105, cantidad: 1, vencimiento: V, precio: 1.40, volatilidadImplicita: 0.27 },
      { tipo: 'call', accion: 'buy', strike: 110, cantidad: 1, vencimiento: V, precio: 0.50, volatilidadImplicita: 0.26 },
    ];
    linea('  S_T   LongCall  LongPut  IronCondor');
    for (let S = 80; S <= 120; S += 5) linea(`  ${String(S).padEnd(5)} ${String(r4(estrategias.payoff(LC, S))).padStart(8)} ${String(r4(estrategias.payoff(LP, S))).padStart(8)} ${String(r4(estrategias.payoff(IC, S))).padStart(10)}`);
    for (const [nombre, comp] of [['LONG_CALL', LC], ['LONG_PUT', LP], ['IRON_CONDOR', IC]]) {
      const r = estrategias.evaluarConfiguracion({ estrategia: nombre, componentes: comp, precioSubyacente: 100, fechaReferencia: REF });
      linea(`  ${nombre}:`, r.metricas.map(m => `${m.nombre}=${m.valor}`).join(' · '));
    }
    const T = estrategias.anosHastaVencimiento(V, REF);
    linea('  T =', r4(T), 'años (', r4(T * 365), 'días )');
    const crédito = 1.80;
    linea('  IC a mano: P[S_T > 93.20; σ 0.30] =', r4(bs.probabilidadSobre({ S: 100, X: 95 - crédito, T, r: 0.04, sigma: 0.30 })), '| P[S_T > 106.80; σ 0.27] =', r4(bs.probabilidadSobre({ S: 100, X: 105 + crédito, T, r: 0.04, sigma: 0.27 })));
    const malo = estrategias.validar('IRON_CONDOR', [IC[0], IC[1], { ...IC[2], strike: 94 }, IC[3]]);
    linea('  validación strikes desordenados:', malo.join(' | '));

    titulo('TSLA iron condor (ticket real; IV y vencimiento SUPUESTOS para Black-Scholes)');
    const VT = '2026-12-01'; // SUPUESTO: el ticket no guarda aquí el vencimiento real
    const TT = estrategias.anosHastaVencimiento(VT, REF);
    const TS = [
      { tipo: 'put', accion: 'buy', strike: 342.5, cantidad: 1, vencimiento: VT, precio: 2.39 },
      { tipo: 'put', accion: 'sell', strike: 352.5, cantidad: 1, vencimiento: VT, precio: 3.97 },
      { tipo: 'call', accion: 'sell', strike: 407.5, cantidad: 1, vencimiento: VT, precio: 2.90 },
      { tipo: 'call', accion: 'buy', strike: 417.5, cantidad: 1, vencimiento: VT, precio: 1.51 },
    ].map(c => ({ ...c, volatilidadImplicita: bs.volatilidadImplicita({ tipo: c.tipo, precio: c.precio, S: 380.15, K: c.strike, T: TT, r: 0.04 }) }));
    linea('  T =', r4(TT), '| IV implícitas desde las mids:', TS.map(c => `${c.tipo} ${c.strike}: ${r4(c.volatilidadImplicita)} (Δ ${r4(bs.opcion({ tipo: c.tipo, S: 380.15, K: c.strike, T: TT, r: 0.04, sigma: c.volatilidadImplicita }).delta)})`).join(', '));
    const rt = estrategias.evaluarConfiguracion({ estrategia: 'IRON_CONDOR', componentes: TS, precioSubyacente: 380.15, fechaReferencia: REF });
    linea('  ', rt.metricas.map(m => `${m.nombre}=${m.valor}`).join(' · '));
    rt.motivos.forEach(x => linea('   motivo:', x));
    linea('  payoff TSLA por S_T:', [330, 342.5, 349.53, 352.5, 380.15, 407.5, 410.47, 417.5, 430].map(S => `${S}→${r4(estrategias.payoff(TS, S))}`).join('  '));
  },

  async orden() {
    titulo('ORDEN: reglas de la interfaz (web/src/utils/estrategiasOrden.js) y cuerpo Alpaca');
    const eo = await import(pathToFileURL(path.join(raiz, 'web', 'src', 'utils', 'estrategiasOrden.js')).href);
    const hoy = new Date(2026, 10, 17);
    linea('  elegirVencimiento([2026-11-20, 2026-11-28, 2026-12-18], hoy 2026-11-17) =', eo.elegirVencimiento(['2026-11-20', '2026-11-28', '2026-12-18'], hoy));
    if (eo.diasHasta) { // selector de vencimiento con rango (si la versión del código lo incluye)
      const v = ['2026-11-20', '2026-11-28', '2026-12-04', '2026-12-18', '2026-12-24', '2027-01-15'];
      linea('  vencimientos', v.join(', '), '→ días', v.map(x => eo.diasHasta(x, hoy)).join(', '));
      linea('  elegirVencimiento(…, 7, 60) =', eo.elegirVencimiento(v, hoy, 7, 60), '| (…, 30, 45) =', eo.elegirVencimiento(v, hoy, 30, 45), '| (…, 50, 55) =', eo.elegirVencimiento(v, hoy, 50, 55));
    }
    // Cadena sintética TSLA (S = 380.15, un vencimiento a 14 días), strikes cada 2.5, primas y deltas de Black-Scholes con σ 0.45.
    const S = 380.15, T = estrategias.anosHastaVencimiento('2026-12-01', REF);
    const items = [];
    for (let K = 285; K <= 475; K += 2.5) for (const tipo of ['call', 'put']) { // ±25 % del precio, como la sincronización
      const o = bs.opcion({ tipo, S, K, T, r: 0.04, sigma: 0.45 });
      items.push({ contratoId: `${tipo}-${K}`, tipo, strike: K, bid: Math.max(0.01, o.precio - 0.05), ask: o.precio + 0.05, griegas: { delta: o.delta } });
    }
    for (const codigo of ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']) {
      const { legs, error } = eo.construirPatas(codigo, items, S);
      linea(`  construirPatas ${codigo}:`, error || legs.map(l => `${l.accion} ${l.contratoId} (Δ ${r4(items.find(i => i.contratoId === l.contratoId).griegas.delta)})`).join(', '));
    }
    linea('  ancho objetivo de alas = 2.5 % · 380.15 =', r4(S * 0.025));
    const sinGriegas = items.map(i => ({ ...i, griegas: null }));
    const { legs: lsg } = eo.construirPatas('IRON_CONDOR', sinGriegas, S);
    linea('  sin griegas (fallback 0.95·S =', r4(S * 0.95), ', 1.05·S =', r4(S * 1.05), '):', lsg.map(l => `${l.accion} ${l.contratoId}`).join(', '));
    // Ticket real TSLA: mids 2.39 / 3.97 / 2.90 / 1.51.
    const it = (tipo, strike, m) => ({ tipo, strike, bid: m - 0.05, ask: m + 0.05 });
    const patas = [
      { accion: 'sell', item: it('put', 352.5, 3.97) }, { accion: 'buy', item: it('put', 342.5, 2.39) },
      { accion: 'sell', item: it('call', 407.5, 2.90) }, { accion: 'buy', item: it('call', 417.5, 1.51) },
    ];
    const neto = eo.netoMid(patas);
    const precio = eo.redondearPrecio(neto);
    linea('  netoMid =', r4(neto), '| redondearPrecio =', precio, '| redondearPrecio(3.42) =', eo.redondearPrecio(3.42), '| redondearPrecio(0.034) =', eo.redondearPrecio(0.034));
    linea('  perfilRiesgo(1 contrato) =', JSON.stringify(eo.perfilRiesgo(patas, precio, neto > 0, 1)));
    linea('  perfilRiesgo(3 contratos) =', JSON.stringify(eo.perfilRiesgo(patas, precio, neto > 0, 3)));
    const cuerpo = alpaca.construirCuerpoOrden({ clientOrderId: '7f9c1e2a-demo-0001', tipo: 'limit', vigencia: 'day', cantidad: 1, precioLimite: 2.97, credito: true, componentes: [
      { simbolo: 'TSLA261201P00342500', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 },
      { simbolo: 'TSLA261201P00352500', accion: 'sell', intencion: 'sell_to_open', proporcion: 1 },
      { simbolo: 'TSLA261201C00407500', accion: 'sell', intencion: 'sell_to_open', proporcion: 1 },
      { simbolo: 'TSLA261201C00417500', accion: 'buy', intencion: 'buy_to_open', proporcion: 1 }] });
    linea('  construirCuerpoOrden →', JSON.stringify(cuerpo));
    linea('  precioLimiteAlpaca(0.4567, true, true) =', alpaca.precioLimiteAlpaca(0.4567, true, true), '| (6.2, false, false) =', alpaca.precioLimiteAlpaca(6.2, false, false));
    linea('  mapearEstadoOrden: new→', alpaca.mapearEstadoOrden('new'), '| done_for_day con 1 ejecutado →', alpaca.mapearEstadoOrden('done_for_day', 1), '| desconocido →', alpaca.mapearEstadoOrden('xyz'));
  },
};

(async () => {
  const pedida = process.argv[2] || 'todo';
  const lista = pedida === 'todo' ? Object.keys(secciones) : [pedida];
  for (const s of lista) {
    if (!secciones[s]) { console.error('Sección desconocida: ' + s); process.exit(1); }
    await secciones[s]();
  }
})();
