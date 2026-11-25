// Lo que se dibuja en la gráfica: patrones de velas, historial, vela en vivo, y que los paneles den los mismos números que los cores del servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const coreIndicadores = require('../dist/cores/indicadores.core');
const coreTecnico = require('../dist/cores/tecnico.core');

const web = n => import(pathToFileURL(join(__dirname, '../web/src/utils', n)).href);
const T0 = Date.UTC(2025, 0, 6, 5) / 1000, DIA = 86400;
const serie = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { time: T0 + i * DIA, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c, volume: 1000 + i }; });
const cae = serie(30, i => 130 - i), sube = serie(30, i => 100 + i); // cuerpo 1, ATR 2
const mas = (base, ...velas) => [...base, ...velas.map(([open, high, low, close], k) => ({ time: T0 + (base.length + k) * DIA, open, high, low, close, volume: 1 }))];

test('patrones: cada forma se reconoce solo en su contexto', async () => {
  const { detectarPatrones, PATRONES } = await web('patrones.js');
  const ultimo = v => { const p = detectarPatrones(v).at(-1); return p && p.i === v.length - 1 ? p.tipo : null; };
  const casos = { // la serie que cae termina en 101; la que sube, en 129
    martillo: mas(cae, [101, 101.6, 97.5, 101.5]), martillo_invertido: mas(cae, [100.5, 104.5, 100.45, 101]), envolvente_alcista: mas(cae, [100.5, 103.2, 100, 103]),
    penetrante: mas(cae, [101, 101.2, 97.8, 98], [97, 100.4, 96.8, 100]), harami_alcista: mas(cae, [101, 101.2, 97.8, 98], [98.8, 100, 98.4, 99.8]),
    estrella_manana: mas(cae, [101, 101.2, 97.8, 98], [97.6, 98, 97, 97.3], [97.8, 101, 97.5, 100.5]),
    hombre_colgado: mas(sube, [129, 129.6, 125.5, 129.5]), estrella_fugaz: mas(sube, [129.5, 133.5, 129.4, 129]), envolvente_bajista: mas(sube, [129.5, 130, 126.8, 127]),
    nube_oscura: mas(sube, [129, 132.2, 128.8, 132], [133, 133.2, 129.6, 130]), harami_bajista: mas(sube, [129, 132.2, 128.8, 132], [131.2, 131.6, 130, 130.2]),
    estrella_tarde: mas(sube, [129, 132.2, 128.8, 132], [132.4, 133, 132, 132.7], [132.2, 132.5, 129, 129.5]),
    tres_soldados: mas(serie(30, () => 100), [100, 101.2, 99.8, 101], [100.5, 102.2, 100.3, 102], [101.5, 103.2, 101.3, 103]), tres_cuervos: mas(serie(30, () => 100), [100, 100.2, 98.8, 99], [99.5, 99.7, 97.8, 98], [98.5, 98.7, 96.8, 97]),
    doji: mas(sube, [129.5, 131, 128, 129.55]),
  };
  for (const [tipo, v] of Object.entries(casos)) { assert.equal(ultimo(v), tipo, tipo); assert.ok(PATRONES[tipo].nombre && PATRONES[tipo].texto && PATRONES[tipo].corto, tipo); }
  assert.deepEqual(Object.keys(casos).sort(), Object.keys(PATRONES).sort(), 'todos los patrones tienen prueba');
  assert.equal(ultimo(mas(sube, [129, 129.6, 125.5, 129.5])), 'hombre_colgado', 'la misma vela tras subir no es martillo'); assert.equal(ultimo(mas(serie(30, () => 100), [100, 100.3, 98, 100.25])), null, 'sin tendencia previa no hay martillo');
  assert.deepEqual(detectarPatrones([]), []); assert.deepEqual(detectarPatrones(serie(10, i => i + 1)), []);
  assert.deepEqual(detectarPatrones(Array.from({ length: 40 }, (_, i) => ({ time: i, open: 5, high: 5, low: 5, close: 5 }))), [], 'velas planas');
});

test('historial de un patrón: acierto, media y base comparables', async () => {
  const { historialPatrones } = await web('patrones.js');
  const v = serie(40, i => 100 + (i % 2 ? 1 : 0)), p = [{ i: 10, tipo: 'martillo', lado: 'alcista' }, { i: 11, tipo: 'martillo', lado: 'alcista' }, { i: 12, tipo: 'doji', lado: 'info' }, { i: 38, tipo: 'martillo', lado: 'alcista' }];
  const h = historialPatrones(v, p, 5);
  assert.deepEqual(Object.keys(h), ['martillo']); assert.equal(h.martillo.n, 2, 'los que aún no tienen 5 sesiones no cuentan'); assert.equal(h.martillo.aciertos, 0.5); assert.ok(Math.abs(h.martillo.base - 18 / 35) < 1e-9);
});

test('vela en vivo: agrega o actualiza la del día y nunca inventa', async () => {
  const { conVelaEnVivo } = await web('patrones.js');
  const v = serie(5, i => 100 + i), hoy = t => new Date(t * 1000 + 15 * 3600000).toISOString();
  const vivo = { abierto: true, apertura: 105, maximo: 107, minimo: 104, precio: 106, volumen: 50, actualizadoEn: hoy(v.at(-1).time + DIA) };
  const mas1 = conVelaEnVivo(v, vivo); assert.equal(mas1.length, 6); assert.equal(mas1.at(-1).time, v.at(-1).time + DIA); assert.deepEqual([mas1.at(-1).open, mas1.at(-1).high, mas1.at(-1).low, mas1.at(-1).close, mas1.at(-1).enVivo], [105, 107, 104, 106, true]);
  const mismo = conVelaEnVivo(v, { ...vivo, actualizadoEn: hoy(v.at(-1).time) }); assert.equal(mismo.length, 5); assert.equal(mismo.at(-1).close, 106); assert.equal(mismo.at(-1).low, Math.min(104, v.at(-1).low));
  for (const x of [null, { ...vivo, abierto: false }, { ...vivo, maximo: null }, { ...vivo, precio: 0 }, { ...vivo, actualizadoEn: hoy(v[0].time) }]) assert.equal(conVelaEnVivo(v, x), v);
  assert.equal(conVelaEnVivo(v, { ...vivo, precio: 110 }).at(-1).high, 110);
});

test('los paneles y la tendencia dan los mismos números que los cores del servidor', async () => {
  const ind = await web('indicadores.js'), { rectaTendencia } = await web('patrones.js');
  const v = serie(260, i => 100 + i * 0.1 + Math.sin(i / 4) * 6 + Math.cos(i / 9) * 3), c = v.map(x => x.close), ref = new Date((v.at(-1).time + 3600) * 1000).toISOString();
  const entrada = { simbolo: 'X', fechaReferencia: ref, velas: v.map(x => ({ fecha: new Date(x.time * 1000).toISOString(), apertura: x.open, maximo: x.high, minimo: x.low, cierre: x.close, volumen: x.volume })), opciones: [], parametros: {}, reglas: [] };
  const m = [...coreIndicadores.evaluar(entrada).metricas, ...coreTecnico.evaluar(entrada).metricas], met = n => m.find(x => x.nombre === n)?.valor;
  const cerca = (a, b, n) => assert.ok(Math.abs(a - b) < 1e-3, `${n}: ${a} != ${b}`);
  cerca(ind.rsiSerie(c).at(-1), met('rsi_14'), 'rsi'); cerca(ind.macdSerie(c).hist.at(-1), met('macd_hist'), 'macd'); cerca(ind.estocasticoSerie(v).k.at(-1), met('estocastico_k'), 'estocástico'); cerca(ind.bollingerSerie(c).pctB.at(-1), met('bollinger_pctb'), 'bollinger');
  const recta = rectaTendencia(v), medio = c.slice(-20).reduce((a, b) => a + b, 0) / 20; assert.equal(recta.length, 20); cerca((recta[1].value - recta[0].value) / medio * 100, met('pendiente_20'), 'pendiente'); assert.deepEqual(rectaTendencia(v.slice(0, 5)), []);
});
