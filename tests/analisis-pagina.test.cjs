// Lógica pura de la página de análisis (web/src/utils/analisis.js, ESM): veredicto, razones, ejes y vigencia de datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const mod = () => import(pathToFileURL(join(__dirname, '../web/src/utils/analisis.js')).href);
const ev = (puntaje, motivos = []) => ({ puntaje, motivos });
const EVS = {
  fundamental: ev(93, ['Periodo base anual con cierre 2026-09-30.', 'Ingresos crecen 18.4% interanual.']),
  tecnico: ev(81.4, ['Precio sobre SMA50 (6.20%).']),
  indicadores: ev(11, ['RSI 38.2 bajo 50.', 'Histograma MACD negativo.']),
};
const CORES = ['tecnico', 'fundamental', 'indicadores'];

test('encaje: límites con el mismo redondeo a un decimal', async () => {
  const { encaje, titular } = await mod();
  assert.equal(encaje(59.95).texto, 'Encaja bien');
  assert.equal(encaje(59.94).texto, 'A medias');
  assert.equal(encaje(39.96).texto, 'A medias');
  assert.equal(encaje(39.94).texto, 'No encaja');
  assert.equal(encaje(null).texto, 'Sin datos');
  assert.equal(titular('LONG_CALL', 64), 'Long Call: encaja bien');
});

test('razones: dos a favor, una en contra y la contradicción', async () => {
  const { razones } = await mod();
  const r = razones('LONG_CALL', { cores: CORES, evaluaciones: EVS });
  assert.deepEqual(r.favor.map(x => x.titulo), ['Fundamental 93.0 alcista', 'Técnico 81.4 alcista']);
  assert.equal(r.favor[0].detalle, 'Ingresos crecen 18.4% interanual.');
  assert.deepEqual(r.contra, { titulo: 'Indicadores 11.0 bajista', detalle: 'RSI 38.2 bajo 50.' });
  assert.equal(r.contradiccion, 'Fundamental 93.0 alcista contra Indicadores 11.0 bajista');
  // El peso cambia el orden y un Long Put lee lo contrario.
  const put = razones('LONG_PUT', { cores: CORES, evaluaciones: EVS, pesos: [{ core: 'tecnico', peso: 0.8 }, { core: 'fundamental', peso: 0.1 }, { core: 'indicadores', peso: 0.1 }] });
  assert.deepEqual(put.favor.map(x => x.titulo), ['Indicadores 11.0 bajista']);
  assert.equal(put.contra.titulo, 'Técnico 81.4 alcista');
});

test('razones: sin oposición no hay contradicción y los factores sin puntaje no cuentan', async () => {
  const { razones } = await mod();
  const r = razones('LONG_CALL', { cores: ['tecnico', 'institucional'], evaluaciones: { tecnico: EVS.tecnico } });
  assert.equal(r.favor.length, 1);
  assert.equal(r.contra, null);
  assert.equal(r.contradiccion, null);
});

test('razones: el ajuste de volatilidad cuenta en el Iron Condor', async () => {
  const { razones } = await mod();
  const r = razones('IRON_CONDOR', {
    cores: ['tecnico'], evaluaciones: { tecnico: ev(50) }, pesos: [{ core: 'tecnico', peso: 1 }], puntaje: 108, motivos: ['Ajuste por volatilidad +8.0 (IV/HV 1.40).'],
  });
  assert.equal(r.favor.length, 2);
  assert.match(r.favor[1].titulo, /caras/);
  assert.equal(r.favor[1].detalle, 'IV/HV 1.40.');
});

test('motivoClaro: no usa un motivo que contradice la lectura', async () => {
  const { motivoClaro } = await mod();
  assert.equal(motivoClaro(ev(20, ['Precio sobre SMA50 (1%).'])), null);
  assert.equal(motivoClaro(ev(50, ['Precio sobre SMA50 (1%).'])), null);
  assert.match(motivoClaro(ev(80, ['4 noticias analizadas: 3 positivas, 1 negativas; sentimiento ponderado 0.60'])), /0\.60/);
});

test('movimientoEsperado: S·IV·√(días/365)', async () => {
  const { movimientoEsperado } = await mod();
  const m = movimientoEsperado(100, 0.4, 91.25);
  assert.ok(Math.abs(m.monto - 20) < 1e-9);
  assert.ok(Math.abs(m.arriba - 120) < 1e-9 && Math.abs(m.abajo - 80) < 1e-9);
  assert.equal(movimientoEsperado(100, null, 30), null);
  assert.equal(movimientoEsperado(100, 0.4, 0), null);
});

test('ticksRedondos: números redondos, dentro del rango y con el cero', async () => {
  const { ticksRedondos } = await mod();
  for (const [a, b, n] of [[-420, 1130, 6], [87.3, 141.9, 5], [0, 0.07, 4], [-12345, 98765, 5]]) {
    const t = ticksRedondos(a, b, n);
    assert.ok(t.length >= 2 && t.length <= n, `${a}..${b}: ${t}`);
    assert.ok(t.every(v => v >= a && v <= b));
    if (a < 0 && b > 0) assert.ok(t.includes(0));
  }
  assert.deepEqual(ticksRedondos(0, 10, 6), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(ticksRedondos(5, 5), []);
});

test('recursosAlDia: menos de 10 minutos, sin fallos y con el rango de contratos cubierto', async () => {
  const { recursosAlDia } = await mod();
  const ahora = Date.parse('2026-11-24T15:00:00Z');
  const s = (recurso, min, extra = {}) => ({ recurso, simbolos: ['ABC'], estado: 'completada', fallidos: 0, finalizadaEn: new Date(ahora - min * 60000).toISOString(), ...extra });
  const r = recursosAlDia([
    s('historicos', 3), s('noticias', 11), s('cotizaciones', 2, { estado: 'fallida' }), s('fundamentales', 2, { fallidos: 1 }), s('empresas', 1, { simbolos: ['OTRA'] }),
    s('contratos', 4, { diasVencimientoMin: 7, diasVencimientoMax: 60 }),
  ], 'ABC', { diasMin: 7, diasMax: 45 }, ahora);
  assert.deepEqual([...r], [['historicos', 3], ['contratos', 4]]);
  assert.equal(recursosAlDia([s('contratos', 4, { diasVencimientoMin: 7, diasVencimientoMax: 60 })], 'ABC', { diasMin: 0, diasMax: 90 }, ahora).size, 0);
  assert.equal(recursosAlDia([s('contratos', 4)], 'ABC', { diasMin: 7, diasMax: 60 }, ahora).size, 0);
});
