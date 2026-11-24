// Ticket y riesgo: lógica pura del frontend (web/src/utils, ESM) contra vectores conocidos y contra los cores del servidor,
// más la evaluación de configuraciones y los insumos de opciones de analisis.service (repositorio en memoria, sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { memoryFactory } = require('./helpers/memory.cjs');
const { createCola } = require('../dist/jobs/cola');
const { createAnalisis, cotizacionValida: validaServidor, primaDe, snapshotVigente } = require('../dist/api/v1/services/analisis.service');
const coreEstrategias = require('../dist/cores/estrategias.core');
const confluencia = require('../dist/cores/confluencia.core');
const tecnico = require('../dist/cores/tecnico.core');
const indicadores = require('../dist/cores/indicadores.core');

const DIA = 86400000;
const utilWeb = nombre => import(pathToFileURL(join(__dirname, '../web/src/utils', nombre)).href);
const eo = () => utilWeb('estrategiasOrden.js');
const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const opcion = (tipo, strike, bid, ask, extra = {}) => ({ contratoId: `${tipo}${strike}`, tipo, strike, bid, ask, ...extra });
const pata = (accion, tipo, strike, extra = {}) => ({ accion, item: opcion(tipo, strike, 1, 1.02, extra) });
const IC = (sp, lp, sc, lc) => [pata('sell', 'put', sp), pata('buy', 'put', lp), pata('sell', 'call', sc), pata('buy', 'call', lc)];

// ---------- 1) crédito ----------
test('camposPrecio: credito solo en órdenes límite de varias patas', async () => {
  const { camposPrecio, signoNeto } = await eo();
  assert.deepEqual(camposPrecio({ tipo: 'limit', limite: 1.234, credito: true, nPatas: 1 }), { precioLimite: 1.23 });
  assert.deepEqual(camposPrecio({ tipo: 'market', limite: null, credito: true, nPatas: 4 }), {});
  assert.deepEqual(camposPrecio({ tipo: 'limit', limite: 1.8, credito: true, nPatas: 4 }), { precioLimite: 1.8, credito: true });
  assert.deepEqual(camposPrecio({ tipo: 'limit', limite: 1.8, credito: false, nPatas: 2 }), { precioLimite: 1.8, credito: false });
  // La etiqueta de una venta suelta es crédito aunque no haya cotización; en multipata sin cotización no se adivina.
  assert.equal(signoNeto([pata('sell', 'put', 100)], null), 'credito');
  assert.equal(signoNeto([pata('buy', 'put', 100)], null), 'debito');
  assert.equal(signoNeto(IC(95, 90, 105, 110), null), null);
  assert.equal(signoNeto(IC(95, 90, 105, 110), 1.2), 'credito');
});

// ---------- 2) cotizaciones ----------
test('cotizacionValida, mid y spread: misma regla en la web y en el servidor', async () => {
  const { cotizacionValida, mid, spreadPct } = await eo();
  const casos = [
    [{ bid: 0, ask: 2 }, false, null],
    [{ bid: 0, ask: 0 }, false, null],
    [{ bid: 0, ask: 0, ultimo: 1.5 }, false, 1.5],
    [{ bid: 2, ask: 1.5 }, false, null],
    [{ bid: 1, ask: null, ultimo: 0 }, false, null],
    [{ bid: 1, ask: 3 }, true, 2],
    [{ bid: 2, ask: 2 }, true, 2],
  ];
  for (const [item, valida, medio] of casos) {
    assert.equal(cotizacionValida(item), valida, JSON.stringify(item));
    assert.equal(validaServidor(item), valida);
    assert.equal(mid(item), medio);
    assert.equal(primaDe(item) ?? null, medio);
    if (!valida) assert.equal(spreadPct(item), null);
  }
  assert.equal(mid(null), null);
  cerca(spreadPct({ bid: 0.9, ask: 1.1 }), 0.2);
});
test('candidatosStrike: solo último precio no supera a cotizaciones reales ni se recomienda; sin liquidez no hay recomendación', async () => {
  const { candidatosStrike, rolesEstrategia } = await eo();
  const [rol] = rolesEstrategia('LONG_CALL');
  const g = delta => ({ griegas: { delta } });
  const items = [
    opcion('call', 100, 0, 0, { ultimo: 3, ...g(0.5) }), // Δ perfecta pero sin cotización
    opcion('call', 101, 2.9, 3.1, g(0.46)),
    opcion('call', 99, 1, 3, g(0.52)), // spread 100 %
  ];
  const c = candidatosStrike(rol, items, 100);
  assert.deepEqual(c.map(x => x.item.strike), [101, 99, 100]);
  assert.deepEqual(c.map(x => x.recomendable), [true, false, false]);
  const ilq = candidatosStrike(rol, [items[0], items[2]], 100);
  assert.ok(ilq.every(x => !x.recomendable));
  assert.match(ilq[0].motivo, /sin liquidez suficiente/);
  // Un strike líquido pero muy lejos del objetivo tampoco se recomienda.
  assert.equal(candidatosStrike(rol, [items[2], opcion('call', 130, 0.1, 0.11, g(0.05))], 100)[0].recomendable, false);
});
test('liquidez, costo del spread y antigüedad', async () => {
  const { liquidez, costoSpread, antiguedadCotizacion } = await eo();
  const p = (bid, ask, extra) => ({ accion: 'buy', item: { tipo: 'call', strike: 100, bid, ask, ...extra } });
  assert.deepEqual([liquidez([p(1, 1.05)])].map(l => [l.avisar, l.confirmar, l.insuficiente])[0], [false, false, false]);
  assert.deepEqual([liquidez([p(1, 1.15)])].map(l => [l.avisar, l.confirmar, l.insuficiente])[0], [true, false, false]);
  assert.deepEqual([liquidez([p(1, 1.26)])].map(l => [l.avisar, l.confirmar, l.insuficiente])[0], [true, true, false]);
  assert.deepEqual([liquidez([p(1, 1.4)])].map(l => [l.avisar, l.confirmar, l.insuficiente])[0], [true, true, true]);
  assert.equal(liquidez([p(0, 2)]).confirmar, true);
  cerca(costoSpread([p(1, 1.2), p(2, 2.1)], 3), 45); // (0.10 + 0.05) × 100 × 3
  assert.equal(costoSpread([p(1, 1.2), p(0, 2)]), null);
  const ahora = Date.parse('2026-11-23T18:00:00Z');
  const e = antiguedadCotizacion([p(1, 1, { fechaDato: '2026-11-23T17:55:00Z' }), p(1, 1, { fechaDato: '2026-11-23T15:00:00Z' })], ahora);
  assert.equal(e.texto, 'hace 3 h');
  assert.equal(antiguedadCotizacion([p(1, 1)], ahora), null);
});

// ---------- 3) riesgo genérico ----------
test('riesgo genérico: vectores conocidos', async () => {
  const { perfilRiesgo } = await eo();
  const r = (patas, neto, credito) => perfilRiesgo(patas, neto, credito, 1);
  const v = (x, ganancia, perdida, be) => assert.deepEqual([x.maxGanancia, x.maxPerdida, x.breakevens], [ganancia, perdida, be]);
  v(r([pata('sell', 'put', 95), pata('sell', 'call', 105)], 3, true), 300, null, [92, 108]); // short strangle
  v(r([pata('buy', 'call', 100), pata('sell', 'call', 110)], 4, false), 600, 400, [104]); // vertical de débito
  v(r([pata('sell', 'put', 100), pata('buy', 'put', 95)], 1.5, true), 150, 350, [98.5]); // vertical de crédito
  v(r(IC(95, 90, 105, 110), 0.5, false), -50, 550, []); // condor pagando débito: no puede ganar
  v(r(IC(100, 95, 98, 103), 3.5, true), 150, 150, [96.5, 101.5]); // condor cruzado
  v(r([pata('sell', 'call', 100)], 5, true), 500, null, [105]); // short call
  v(r([pata('buy', 'put', 100)], 5, false), 9500, 500, [95]); // long put
  v(r([pata('sell', 'put', 100)], 5, true), 500, 9500, [95]); // short put
  v(r([pata('buy', 'call', 100)], 16.2, false), null, 1620, [116.2]); // long call
  v(r(IC(95, 94, 105, 110), 1.8, true), 180, 320, [106.8]); // alas 1 / 5: sin breakeven inferior
  v(r([{ ...pata('buy', 'call', 100), proporcion: 1 }, { ...pata('sell', 'call', 110), proporcion: 2 }], 1, false), 900, null, [101, 119]); // ratio 1×2
  assert.equal(perfilRiesgo([pata('buy', 'call', 100)], null, false), null);
  assert.equal(perfilRiesgo([{ accion: 'buy', item: undefined }], 1, false), null);
  assert.equal(perfilRiesgo([pata('buy', 'call', 100)], 2, false, 3).maxPerdida, 600);
});
test('analyzePayoff: sin primas no hay números; los breakevens caen dentro de la gráfica', async () => {
  const { analyzePayoff } = await eo();
  const leg = (accion, tipo, strike, prima) => ({ accion, tipo, strike, cantidad: 1, multiplicador: 100, prima });
  assert.equal(analyzePayoff([leg('buy', 'call', 100, null)]), null);
  assert.equal(analyzePayoff([leg('buy', 'call', 100, 2), leg('sell', 'call', 110, undefined)]), null);
  assert.equal(analyzePayoff([]), null);
  const c = analyzePayoff([leg('buy', 'call', 100, 16.2)]);
  assert.deepEqual(c.breakevens, [116.2]);
  assert.ok(c.max > 116.2 && c.gainUnbounded && !c.lossUnbounded);
  assert.equal(c.maxLoss, -1620);
  const s = analyzePayoff([leg('sell', 'call', 100, 5)]);
  assert.ok(s.lossUnbounded && s.maxLoss === null);
  assert.equal(analyzePayoff([leg('buy', 'put', 100, 5)]).maxGain, 9500); // aunque la gráfica no llegue a 0
});
test('riesgo: web y core del servidor dan lo mismo', async () => {
  const { riesgoGenerico } = await eo();
  const leg = (accion, tipo, strike, prima, cantidad = 1) => ({ accion, tipo, strike, prima, precio: prima, cantidad, multiplicador: 100 });
  const casos = [
    [leg('buy', 'call', 100, 16.2)], [leg('buy', 'put', 100, 5)], [leg('sell', 'call', 100, 5)], [leg('sell', 'put', 95, 2), leg('sell', 'call', 105, 1)],
    [leg('sell', 'put', 95, 2), leg('buy', 'put', 94, 1), leg('sell', 'call', 105, 2), leg('buy', 'call', 110, 1.2)],
    [leg('buy', 'call', 100, 3), leg('sell', 'call', 110, 1, 2)],
  ];
  for (const legs of casos) {
    const w = riesgoGenerico(legs), s = coreEstrategias.perfilVencimiento(legs, 100);
    assert.equal(w.maxGanancia == null, s.gananciaMaxima == null);
    assert.equal(w.maxPerdida == null, s.perdidaMaxima == null);
    if (w.maxGanancia != null) cerca(w.maxGanancia, s.gananciaMaxima, 1e-3);
    if (w.maxPerdida != null) cerca(w.maxPerdida, s.perdidaMaxima, 1e-3);
    assert.equal(w.breakevens.length, s.breakevens.length);
    w.breakevens.forEach((b, i) => cerca(b, s.breakevens[i], 1e-3));
  }
});

// ---------- 4) validación ----------
test('validarPatas: strikes cruzados, patas de más o acción cambiada', async () => {
  const { validarPatas } = await eo();
  assert.deepEqual(validarPatas('IRON_CONDOR', IC(95, 90, 105, 110)), []);
  assert.match(validarPatas('IRON_CONDOR', IC(100, 95, 98, 103)).join(), /por debajo del call vendido/);
  assert.match(validarPatas('IRON_CONDOR', IC(95, 96, 105, 110)).join(), /menor que el put vendido/);
  assert.match(validarPatas('IRON_CONDOR', IC(95, 90, 105, 110).slice(0, 2)).join(), /ya no forman/);
  assert.match(validarPatas('LONG_CALL', [pata('sell', 'call', 100)]).join(), /ya no forman/);
  assert.match(validarPatas('LONG_CALL', [pata('buy', 'call', 100), pata('buy', 'call', 105)]).join(), /ya no forman/);
  assert.deepEqual(validarPatas(null, [pata('sell', 'call', 100)]), []);
});

// ---------- 6) puntajes ----------
test('puntaje: se clasifica y se muestra con el mismo redondeo', async () => {
  const { direccion, veredicto, textoPuntaje, nombreConContexto } = await eo();
  assert.equal(textoPuntaje(59.5), '59.5');
  assert.equal(veredicto(59.5).texto, 'NEUTRAL');
  for (const x of [59.94, 59.949, 59.95, 59.96, 60, 39.94, 39.96, 40, 40.04, 40.06]) {
    assert.equal(veredicto(x).texto, veredicto(Number(textoPuntaje(x))).texto, String(x));
    assert.equal(direccion(x).texto, direccion(Number(textoPuntaje(x))).texto, String(x));
  }
  assert.equal(textoPuntaje(59.96), '60.0');
  assert.equal(veredicto(59.96).texto, 'COMPATIBLE');
  assert.equal(veredicto(null).texto, 'SIN DATOS');
  assert.match(nombreConContexto('AAPL', 'LONG_CALL', { puntaje: 59.5, fecha: '2026-11-23T10:00:00Z' }), /compat 59\.5/);
});
const evalCore = (core, sesgo, conf) => ({ core, puntaje: 50 + 50 * sesgo, metricas: [{ nombre: 'sesgo', valor: sesgo }, { nombre: 'confianza', valor: conf }] });
const ESCENARIOS = [
  [evalCore('tecnico', 0.62, 0.8), evalCore('indicadores', -0.31, 0.55), evalCore('noticias', 0.12, 0.4)],
  [evalCore('tecnico', 0.1, 0.9), evalCore('fundamental', -0.07, 0.33)],
  [evalCore('tecnico', 1, 0.7), evalCore('noticias', -1, 0.7)],
];
test('desglose: los puntos, la dispersión y el ajuste IV/HV suman el puntaje final', async () => {
  const { desglosePuntaje } = await eo();
  for (const evs of ESCENARIOS) for (const codigo of ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']) for (const volatilidad of [undefined, { ivActual: 0.33, hv20: 0.3 }]) {
    const cores = evs.map(e => e.core);
    const r = confluencia.evaluar({ estrategia: codigo, evaluaciones: evs.map(e => ({ core: e.core, sesgo: e.metricas[0].valor, confianza: e.metricas[1].valor })), coresSeleccionados: cores, volatilidad });
    const d = desglosePuntaje(codigo, cores, r.ponderacionesEfectivas, Object.fromEntries(evs.map(e => [e.core, e])), r.puntaje, r.motivos);
    cerca(d.filas.reduce((a, f) => a + f.puntos, 0), d.subtotal, 1e-6);
    cerca(d.subtotal + (d.dispersion ?? 0) + (d.ajusteIv ?? 0), d.final, 1e-6);
    cerca(d.final, r.puntaje, 0.051);
    if (codigo === 'IRON_CONDOR') {
      assert.equal(d.dispersion, null); // el condor no descuenta dispersión
      cerca(d.ajusteIv, volatilidad ? Math.min(7.5, 100 - d.subtotal) : 0, 0.11);
      assert.equal(d.motivoIv, volatilidad ? 'IV/HV20 = 1.10' : null);
    } else {
      assert.equal(d.ajusteIv, null);
      cerca(d.dispersion, -(d.subtotal - 50) * r.dispersion, 0.11);
    }
  }
  assert.equal(desglosePuntaje('LONG_CALL', ['tecnico'], [], {}, 50).subtotal, null);
});
test('confianza y dispersión reconstruidas en el cliente = confluencia.core', async () => {
  const { estadisticosConfluencia } = await eo();
  const ponderaciones = [{ core: 'tecnico', peso: 2 }, { core: 'noticias', peso: 0.5 }];
  for (const evs of ESCENARIOS) {
    const coresSeleccionados = [...evs.map(e => e.core), 'institucional']; // institucional sin resultado
    const r = confluencia.evaluar({ estrategia: 'LONG_CALL', evaluaciones: evs.map(e => ({ core: e.core, sesgo: e.metricas[0].valor, confianza: e.metricas[1].valor })), coresSeleccionados, ponderaciones });
    const est = estadisticosConfluencia(evs, ponderaciones, coresSeleccionados);
    cerca(est.dispersion, r.dispersion, 1e-4);
    cerca(est.confianza, r.confianza, 1e-4);
  }
  assert.equal(estadisticosConfluencia([], [], ['tecnico']), null);
});

// ---------- 7) revisión ----------
test('métricas de la revisión: probabilidad igual a la del servidor, griegas en dólares y ratios', async () => {
  const { metricasOrden, rolesEstrategia } = await eo();
  const ahora = new Date('2026-11-23T15:00:00Z'), vencimiento = '2027-01-15', S = 100;
  const g = { delta: 0.2, theta: -0.03, vega: 0.1 };
  const p = (accion, tipo, strike, precio, iv) => ({ accion, item: { contratoId: tipo + strike, tipo, strike, bid: precio, ask: precio, volatilidadImplicita: iv, griegas: g } });
  const ordenes = [
    ['LONG_CALL', [p('buy', 'call', 100, 4, 0.3)]],
    ['LONG_PUT', [p('buy', 'put', 100, 4, 0.3)]],
    ['IRON_CONDOR', [p('sell', 'put', 95, 1.5, 0.32), p('buy', 'put', 90, 0.7, 0.35), p('sell', 'call', 105, 1.4, 0.28), p('buy', 'call', 110, 0.6, 0.27)]],
    ['IRON_CONDOR', [p('sell', 'put', 95, 1.5, 0.32), p('buy', 'put', 94, 0.7, 0.35), p('sell', 'call', 105, 1.6, 0.28), p('buy', 'call', 110, 0.6, 0.27)]], // ala put 1 < crédito 1.80
  ];
  for (const [codigo, patas] of ordenes) {
    const neto = patas.reduce((a, x) => a + (x.accion === 'sell' ? 1 : -1) * x.item.bid, 0);
    const m = metricasOrden({ patas, precioNeto: Math.abs(neto), credito: neto > 0, cantidad: 2, S, items: patas.map(x => x.item), vencimiento, patrimonio: 100000, ahora });
    const srv = coreEstrategias.evaluarConfiguracion({ estrategia: codigo, precioSubyacente: S, fechaReferencia: ahora.toISOString(),
      componentes: patas.map(x => ({ tipo: x.item.tipo, strike: x.item.strike, accion: x.accion, cantidad: 2, vencimiento, precio: x.item.bid, volatilidadImplicita: x.item.volatilidadImplicita })) });
    const met = n => srv.metricas.find(x => x.nombre === n)?.valor;
    assert.equal(srv.valida, true, srv.errores.join());
    cerca(m.probabilidad, met('probabilidad_ganancia'), 1e-4);
    cerca(m.riesgo.maxPerdida, met('perdida_maxima'), 1e-3);
    cerca(m.pctCuenta, met('perdida_maxima') / 100000, 1e-6);
    if (codigo === 'IRON_CONDOR') {
      cerca(m.creditoAncho, neto / 5);
      cerca(m.retornoRiesgo, m.riesgo.maxGanancia / m.riesgo.maxPerdida);
      cerca(m.delta, 0);
    } else {
      cerca(m.delta, 0.2 * 200); cerca(m.theta, -0.03 * 200); cerca(m.vega, 0.1 * 200);
      assert.equal(m.creditoAncho, null);
      cerca(m.movimiento.monto, 100 * 0.3 * Math.sqrt((Date.parse('2027-01-15T20:00:00Z') - ahora) / (365 * DIA)), 1e-9);
    }
  }
  // Sin IV no se inventa probabilidad ni movimiento esperado; riesgo ilimitado no tiene retorno ni % de cuenta.
  const sinIv = metricasOrden({ patas: [p('sell', 'call', 105, 1, undefined)], precioNeto: 1, credito: true, S, items: [], vencimiento, patrimonio: 1000, ahora });
  assert.deepEqual([sinIv.probabilidad, sinIv.movimiento, sinIv.retornoRiesgo, sinIv.pctCuenta, sinIv.riesgo.maxPerdida], [null, null, null, null, null]);
  assert.match(rolesEstrategia('IRON_CONDOR')[0].ayuda, /≈80 % por lado; ≈60 % ambos lados/);
});
test('notas de asignación y vencimiento', async () => {
  const { notasVencimiento } = await eo();
  const ic = notasVencimiento(IC(95, 90, 105, 110), 100, 30).join(' ');
  assert.match(ic, /Asignación anticipada/); assert.match(ic, /entre el strike vendido y el comprado/);
  assert.match(notasVencimiento([pata('sell', 'put', 110)], 100, 30).join(' '), /ya está dentro del dinero/);
  const compra = notasVencimiento([pata('buy', 'call', 100)], 100, 3).join(' ');
  assert.match(compra, /se pierde toda la prima/); assert.match(compra, /Quedan 3 días/); assert.doesNotMatch(compra, /Asignación/);
});

// ---------- 8) señales ----------
const velasSerie = f => Array.from({ length: 260 }, (_, i) => { const c = f(i); return { time: Math.floor(Date.UTC(2025, 0, 2) / 1000) + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }; });
const SERIES = [
  i => 100 + i * 0.5 + Math.sin(i / 3) * 2, i => 300 - i * 0.6 + Math.sin(i / 5) * 3,
  i => 100 + Math.sin(i / 20) * 15, i => 150 + Math.sin(i / 9) * 8 - (i > 200 ? (i - 200) * 0.4 : 0), i => 100 + Math.cos(i / 40) * 20,
];
test('señales del cliente: las de tendencia coinciden en signo con los cores del servidor', async () => {
  const { estadoSenales, confluencia: contar } = await utilWeb('senales.js');
  for (const f of SERIES) {
    const velas = velasSerie(f);
    const srvVelas = velas.map(v => ({ fecha: new Date(v.time * 1000).toISOString(), apertura: v.open, maximo: v.high, minimo: v.low, cierre: v.close, volumen: v.volume }));
    const fechaReferencia = new Date((velas.at(-1).time + 86400) * 1000).toISOString();
    const metricas = [...tecnico.evaluar({ velas: srvVelas, fechaReferencia }).metricas, ...indicadores.evaluar({ velas: srvVelas, fechaReferencia }).metricas];
    const estado = estadoSenales(velas);
    const esperado = { precio_sma50: 'precio_vs_sma50', precio_sma200: 'precio_vs_sma200', sma50_200: 'cruce_sma50_200', macd: 'macd_hist' };
    for (const [id, metrica] of Object.entries(esperado)) {
      const v = metricas.find(m => m.nombre === metrica).valor;
      assert.equal(estado.find(s => s.id === id).direccion, v > 0 ? 'alcista' : v < 0 ? 'bajista' : 'neutral', id);
    }
    // Osciladores: informativos, fuera del recuento.
    const info = estado.filter(s => ['rsi', 'estocastico', 'bollinger'].includes(s.id));
    assert.equal(info.length, 3);
    assert.ok(info.every(s => s.direccion === 'informativo' && /\(informativo\)$/.test(s.detalle)));
    const c = contar(estado);
    assert.equal(c.total, 4);
    assert.equal(c.alcistas.length + c.bajistas.length + c.neutrales.length, 4);
    assert.equal(contar(estado, ['indicadores']).total, 1);
    assert.equal(contar(estado, ['indicadores']).excluidas, 3);
  }
});
test('eventos: RSI nunca es compra ni venta', async () => {
  const { eventosSenales } = await utilWeb('senales.js');
  const ev = SERIES.flatMap(f => eventosSenales(velasSerie(f)));
  const rsi = ev.filter(e => e.origen === 'rsi');
  assert.ok(rsi.length > 0);
  assert.ok(rsi.every(e => e.lado === 'info' && /informativo/.test(e.texto)));
  assert.ok(ev.filter(e => e.origen !== 'rsi').every(e => ['compra', 'venta'].includes(e.lado)));
});

// ---------- 9) vencimiento ----------
test('elegirVencimiento: cercano al objetivo de la estrategia, dentro del rango y nunca vencido', async () => {
  const { elegirVencimiento, vencimientosVigentes } = await eo();
  const hoy = new Date(2026, 10, 23, 10);
  const lista = ['2026-10-16', '2026-11-20', '2026-11-27', '2026-12-04', '2026-12-18', '2026-12-31', '2027-01-08', '2027-02-19'];
  assert.equal(elegirVencimiento(lista, hoy, 7, 60, 'LONG_CALL'), '2027-01-08'); // 46 d
  assert.equal(elegirVencimiento(lista, hoy, 7, 60, 'IRON_CONDOR'), '2026-12-31'); // 38 d
  assert.equal(elegirVencimiento(lista, hoy, 7, 30, 'LONG_PUT'), '2026-12-18'); // respeta el máximo del usuario
  assert.equal(elegirVencimiento(lista, hoy, 60, 120, 'LONG_CALL'), '2027-02-19'); // y el mínimo
  assert.equal(elegirVencimiento(lista, hoy, 200, 300, 'LONG_CALL'), '2027-01-08'); // nada en rango: el futuro más cercano al objetivo
  assert.equal(elegirVencimiento(['2026-10-16', '2026-11-20'], hoy, 7, 60, 'LONG_CALL'), null);
  assert.equal(elegirVencimiento([], hoy), null);
  assert.equal(elegirVencimiento(['2026-11-23', '2026-11-27'], hoy, 7, 60), '2026-11-27');
  assert.deepEqual(vencimientosVigentes(lista, hoy).slice(0, 2), ['2026-11-27', '2026-12-04']);
});
test('reconstruirPatas: conserva los strikes más cercanos, avisa y rearma si dejan de ser válidos', async () => {
  const { reconstruirPatas, construirPatas } = await eo();
  const cadena = strikes => strikes.flatMap(k => [opcion('put', k, 1, 1.05), opcion('call', k, 1, 1.05)]);
  const ids = r => r.legs.map(l => l.contratoId);
  const igual = reconstruirPatas('IRON_CONDOR', IC(95, 90, 105, 110), cadena([85, 90, 95, 100, 105, 110]), 100);
  assert.deepEqual(ids(igual), ['put95', 'put90', 'call105', 'call110']);
  assert.match(igual.aviso, /se conservaron los strikes/);
  const cerca_ = reconstruirPatas('IRON_CONDOR', IC(95, 90, 105, 110), cadena([88, 94, 100, 106, 112]), 100);
  assert.deepEqual(ids(cerca_), ['put94', 'put88', 'call106', 'call112']);
  assert.match(cerca_.aviso, /Put 95 → 94/);
  // Solo dos strikes por debajo del precio actual: los más cercanos se cruzan, así que se arma de nuevo.
  const mal = reconstruirPatas('IRON_CONDOR', IC(95, 90, 105, 110), cadena([60, 98, 99, 140]), 100);
  assert.match(mal.aviso, /se armó de nuevo/);
  assert.deepEqual(ids(mal), ['put98', 'put60', 'call99', 'call140']);
  assert.ok(reconstruirPatas('LONG_CALL', [pata('buy', 'call', 100)], [opcion('put', 100, 1, 1)], 100).error);
  // construirPatas usa la misma recomendación que la tabla de strikes.
  assert.deepEqual(construirPatas('LONG_CALL', [opcion('call', 100, 0, 0, { ultimo: 2 }), opcion('call', 101, 1, 1.05)], 100).legs.map(l => l.contratoId), ['call101']);
  assert.match(construirPatas('LONG_CALL', [], 100).error, /vigente/);
});

// ---------- 10 y 11) sondeo y rango de días ----------
test('ticket: usa la actualización de la orden (sin lanzar sincronizaciones) y flujo envía el rango de días', () => {
  const ticket = readFileSync(join(__dirname, '../web/src/components/TicketOrden.jsx'), 'utf8');
  assert.match(ticket, /\/actualizacion`/);
  assert.doesNotMatch(ticket, /acciones\.sincronizar/);
  assert.match(ticket, /POLL_MS = 3000/);
  const flujo = readFileSync(join(__dirname, '../web/src/pages/analizar/flujo.js'), 'utf8');
  assert.match(flujo, /diasVencimientoMin: diasMin, diasVencimientoMax: diasMax \} : \{\}\) \};/);
  assert.match(flujo, /filtros: parametros/);
});
test('snapshotVigente: 2 días naturales, 4 con fin de semana o feriado', () => {
  const ok = (a, b) => snapshotVigente(a + 'T18:00:00Z', new Date(b + 'T15:00:00Z'));
  assert.equal(ok('2026-11-17', '2026-11-19'), true);
  assert.equal(ok('2026-11-16', '2026-11-19'), false); // lunes → jueves
  assert.equal(ok('2026-11-20', '2026-11-23'), true); // viernes → lunes
  assert.equal(ok('2026-11-19', '2026-11-23'), true);
  assert.equal(ok('2026-11-18', '2026-11-23'), false);
  assert.equal(ok('2026-11-24', '2026-11-27'), true); // Acción de Gracias en medio
  assert.equal(snapshotVigente(undefined, new Date()), false);
});

// ---------- 5 y 11) servidor ----------
const ctx = { database: 'mongodb', userId: 'u1' };
const iso = ms => new Date(ms).toISOString();
async function escenario({ snaps, cotizaciones = [], velas = [], contrato = {}, componente = {} }) {
  const factory = memoryFactory(), cola = createCola();
  const crear = (n, d) => factory(n, ctx).create({ usuarioId: 'u1', ...d });
  const vencimiento = iso(Date.now() + 35 * DIA).slice(0, 10);
  await crear('empresas', { _id: 'e1', simbolo: 'TEST', nombre: 'Test' });
  await crear('estrategias', { _id: 's1', codigo: 'LONG_CALL', nombre: 'Long Call' });
  await crear('contratos', { _id: 'c1', empresaId: 'e1', simbolo: 'TESTC100', contratoExternoId: 'TESTC100', proveedor: 'alpaca', tipo: 'call', strike: 100, vencimiento, multiplicador: 100, ...contrato });
  let n = 0;
  for (const s of snaps) await crear('datos-mercado', { _id: 's' + n++, empresaId: 'e1', contratoId: 'c1', tipo: 'snapshot_opcion', volatilidadImplicita: 0.3, ...s, fuente: { proveedor: 'alpaca', fechaDato: iso(s.t ?? Date.now()) } });
  for (const c of cotizaciones) await crear('datos-mercado', { _id: 'q' + n++, empresaId: 'e1', tipo: 'cotizacion', ultimo: c.ultimo, fuente: { proveedor: 'alpaca', fechaDato: iso(c.t) } });
  for (const v of velas) await crear('datos-mercado', { _id: 'v' + n++, empresaId: 'e1', tipo: 'vela', intervalo: v.intervalo || '1Day', apertura: v.cierre, maximo: v.cierre, minimo: v.cierre, cierre: v.cierre, volumen: 1, fuente: { proveedor: 'alpaca', fechaDato: iso(v.t) } });
  await crear('configuraciones', { _id: 'cfg', empresaId: 'e1', estrategiaId: 's1', nombre: 'x', parametros: {}, componentes: [{ _id: 'k', contratoId: 'c1', accion: 'buy', cantidad: 1, proporcion: 1, ...componente }] });
  const analisis = createAnalisis({ cola, factory });
  const leer = async t => { await cola.vaciar(); return (await factory('evaluaciones', ctx).get(t._id)).document; };
  return {
    evaluar: async () => leer(await analisis.evaluarConfiguracion(ctx, 'cfg', {})),
    core: async (core, parametros) => leer(await analisis.ejecutarCore(ctx, core, { empresaId: 'e1', parametros })),
  };
}
const met = (e, n) => e.metricas.find(m => m.nombre === n)?.valor;
test('configuración: proporción, multiplicador del contrato y última cotización como subyacente', async () => {
  const ahora = Date.now();
  const x = await escenario({
    snaps: [{ bid: 1.9, ask: 2.1 }], componente: { cantidad: 2, proporcion: 3 }, contrato: { multiplicador: 10 },
    cotizaciones: [{ ultimo: 108, t: ahora - 3600000 }, { ultimo: 110, t: ahora - 60000 }], velas: [{ cierre: 90, t: ahora - 1000 }],
  });
  const e = await x.evaluar();
  assert.equal(e.estado, 'completada', e.error);
  assert.equal(met(e, 'prima_neta'), -120); // 2 × 2 contratos × 3 × 10
  assert.equal(met(e, 'resultado_vencimiento_precio_actual'), 480); // (110 − 100 − 2) × 6 × 10
  assert.equal(met(e, 'configuracion_valida'), 1);
  assert.equal(e.cobertura, 1);
});
test('configuración: sin cotización usa la última vela de su intervalo', async () => {
  const ahora = Date.now();
  const x = await escenario({ snaps: [{ bid: 2, ask: 2 }], velas: [{ cierre: 105, t: ahora - DIA }, { cierre: 500, t: ahora, intervalo: '1Hour' }] });
  assert.equal(met(await x.evaluar(), 'resultado_vencimiento_precio_actual'), 300);
});
test('configuración: 0/0, bid 0 y snapshots viejos son dato faltante, no precio 0', async () => {
  for (const snap of [{ bid: 0, ask: 0 }, { bid: 0, ask: 2 }, { bid: 1, ask: 1.2, t: Date.now() - 6 * DIA }]) {
    const e = await (await escenario({ snaps: [snap] })).evaluar();
    assert.equal(e.estado, 'completada', e.error);
    assert.equal(met(e, 'prima_neta'), undefined);
    assert.equal(met(e, 'perdida_maxima'), undefined);
    assert.equal(e.cobertura, 0);
    assert.match(e.datosFaltantes.join(), snap.t ? /cotización vigente de TESTC100/ : /precio de TESTC100/);
  }
  const ultimo = await (await escenario({ snaps: [{ bid: 0, ask: 0, ultimo: 1.5 }] })).evaluar();
  assert.equal(met(ultimo, 'prima_neta'), -150);
});
test('configuración inválida o vencida: sin montos y configuracion_valida = 0', async () => {
  const vendida = await (await escenario({ snaps: [{ bid: 1, ask: 1.1 }], componente: { accion: 'sell' } })).evaluar();
  assert.equal(met(vendida, 'configuracion_valida'), 0);
  assert.equal(vendida.cobertura, 0);
  assert.match(vendida.motivos[0], /requiere comprar/);
  const vencida = await (await escenario({ snaps: [{ bid: 1, ask: 1.1 }], contrato: { vencimiento: '2026-01-16' } })).evaluar();
  assert.equal(met(vencida, 'configuracion_valida'), 0);
  assert.equal(met(vencida, 'prima_neta'), undefined);
  assert.match(vencida.motivos.join(), /ya venció/);
});
test('insumos: iv_promedio respeta el rango de días e ignora snapshots viejos informándolo', async () => {
  const velas = Array.from({ length: 70 }, (_, i) => ({ cierre: 100 + Math.sin(i), t: Date.now() - (70 - i) * DIA }));
  const x = await escenario({ snaps: [{ bid: 1, ask: 1.1 }], velas });
  assert.equal(met(await x.core('indicadores', { diasVencimientoMin: 30, diasVencimientoMax: 45 }), 'iv_promedio'), 0.3);
  assert.equal(met(await x.core('indicadores', { diasVencimientoMin: 0, diasVencimientoMax: 20 }), 'iv_promedio'), undefined);
  const viejo = await (await escenario({ snaps: [{ bid: 1, ask: 1.1, t: Date.now() - 6 * DIA }], velas })).core('indicadores', {});
  assert.equal(met(viejo, 'iv_promedio'), undefined);
  assert.match(viejo.datosFaltantes.join(), /1 de 1 cotizaciones ignoradas por antiguas/);
});
