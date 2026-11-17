// Core técnico: tendencia y estructura de precio (no incluye osciladores: eso es del core indicadores).
import { clamp, combinar, esNumero, finalizar, filtrarSenales, limpiarVelas, metrica, pendienteRegresion, promedio, sma, smaSerie } from './util.js';

export const VERSION = 'tecnico@1.0.1';
export const REQUIERE = ['velas'];

export const SENALES = [
  { nombre: 'precio_vs_sma50', etiqueta: 'Precio vs SMA50', descripcion: 'Distancia porcentual del precio a la media móvil simple de 50 velas.', pesoBase: 1 },
  { nombre: 'precio_vs_sma200', etiqueta: 'Precio vs SMA200', descripcion: 'Distancia porcentual del precio a la media móvil simple de 200 velas.', pesoBase: 1.5 },
  { nombre: 'cruce_sma50_200', etiqueta: 'Cruce SMA50/SMA200', descripcion: 'Posición relativa de la SMA50 frente a la SMA200 (cruce dorado / de la muerte).', pesoBase: 1 },
  { nombre: 'pendiente_20', etiqueta: 'Pendiente 20 velas', descripcion: 'Pendiente de regresión lineal de las últimas 20 velas, en % del precio medio.', pesoBase: 1 },
  { nombre: 'posicion_rango_52s', etiqueta: 'Posición en rango 52 semanas', descripcion: 'Ubicación del precio entre el mínimo y el máximo de 52 semanas.', pesoBase: 0.75 },
  { nombre: 'volumen_relativo_20', etiqueta: 'Volumen relativo 20', descripcion: 'Volumen de la última vela frente al promedio de 20, confirmando la dirección.', pesoBase: 0.5 },
];

const VENTANA_52S = 252;
const MIN_RANGO = 60;

export function evaluar(input = {}) {
  const velas = limpiarVelas(input.velas, input.fechaReferencia);
  const cierres = velas.map(v => v.cierre);
  const n = cierres.length;
  const ultimo = n ? cierres[n - 1] : null;
  const motivos = [];
  const datosFaltantes = [];
  const metricas = [];
  if (!n) datosFaltantes.push('velas');

  // Precio vs SMA50
  const sma50 = sma(cierres, 50);
  let s50 = null;
  if (sma50 != null && sma50 > 0) {
    const pct = (ultimo / sma50 - 1) * 100;
    s50 = Math.tanh(pct / 5);
    metricas.push(metrica('precio_vs_sma50', pct, '%', '50'));
    motivos.push(`Precio ${pct >= 0 ? 'sobre' : 'bajo'} SMA50 (${pct.toFixed(2)}%).`);
  } else datosFaltantes.push('velas<50');

  // Precio vs SMA200 y cruce de medias
  const sma200 = sma(cierres, 200);
  let s200 = null;
  let sCruce = null;
  if (sma200 != null && sma200 > 0) {
    const pct = (ultimo / sma200 - 1) * 100;
    s200 = Math.tanh(pct / 10);
    metricas.push(metrica('precio_vs_sma200', pct, '%', '200'));
    const dif = (sma50 / sma200 - 1) * 100;
    const estado = dif > 0 ? 1 : dif < 0 ? -1 : 0;
    sCruce = estado * Math.min(1, Math.abs(dif) / 5);
    metricas.push(metrica('cruce_sma50_200', estado, 'estado', '50/200'), metrica('diferencia_sma50_200', dif, '%', '50/200'));
    // Cruce reciente (últimas 20 velas)
    const s50s = smaSerie(cierres, 50);
    const s200s = smaSerie(cierres, 200);
    for (let i = Math.max(200, n - 20); i < n; i++) {
      const antes = s50s[i - 1] - s200s[i - 1];
      const ahora = s50s[i] - s200s[i];
      if (esNumero(antes) && antes <= 0 && ahora > 0) motivos.push('Cruce dorado (SMA50 cruza sobre SMA200) en las últimas 20 velas.');
      if (esNumero(antes) && antes >= 0 && ahora < 0) motivos.push('Cruce de la muerte (SMA50 cruza bajo SMA200) en las últimas 20 velas.');
    }
    motivos.push(`SMA50 ${estado >= 0 ? 'sobre' : 'bajo'} SMA200 (${dif.toFixed(2)}%).`);
  } else datosFaltantes.push('velas<200');

  // Pendiente de regresión lineal de 20 velas, en % del precio medio por vela
  let sPend = null;
  if (n >= 20) {
    const ventana = cierres.slice(-20);
    const m = promedio(ventana);
    if (m > 0) {
      const pend = (pendienteRegresion(ventana) / m) * 100;
      sPend = Math.tanh(pend / 0.5);
      metricas.push(metrica('pendiente_20', pend, '%/vela', '20'));
    }
  } else datosFaltantes.push('velas<20');

  // Posición en el rango de 52 semanas (máximo/mínimo intradía)
  let sRango = null;
  if (n >= MIN_RANGO) {
    const w = Math.min(VENTANA_52S, n);
    const ventana = velas.slice(-w);
    const max = Math.max(...ventana.map(v => v.maximo));
    const min = Math.min(...ventana.map(v => v.minimo));
    if (max > min) {
      const pos = clamp((ultimo - min) / (max - min), 0, 1);
      sRango = 2 * (pos - 0.5);
      metricas.push(metrica('posicion_rango_52s', pos, 'fraccion', `${w}`));
      metricas.push(metrica('distancia_maximo_pct', (max / ultimo - 1) * 100, '%', `${w}`), metrica('distancia_minimo_pct', (ultimo / min - 1) * 100, '%', `${w}`));
      if (w < VENTANA_52S) {
        datosFaltantes.push('velas<252');
        motivos.push(`Rango calculado con ${w} velas (menos de 52 semanas).`);
      }
    }
  } else datosFaltantes.push(`velas<${MIN_RANGO}`);

  // Volumen relativo: confirma la dirección de la última vela
  let sVol = null;
  const vols = velas.map(v => v.volumen);
  if (n >= 21 && vols.slice(-21).every(v => esNumero(v) && v >= 0)) {
    const media = promedio(vols.slice(-21, -1));
    if (media > 0) {
      const vr = vols[n - 1] / media;
      const dir = Math.sign(cierres[n - 1] - cierres[n - 2]);
      sVol = dir * clamp(vr - 1, 0, 1);
      metricas.push(metrica('volumen_relativo_20', vr, 'razon', '20'));
      if (vr > 1.5) motivos.push(`Volumen ${vr.toFixed(2)}× el promedio confirma la vela ${dir > 0 ? 'alcista' : dir < 0 ? 'bajista' : 'neutral'}.`);
    }
  } else datosFaltantes.push('volumen<21');

  const valores = { precio_vs_sma50: s50, precio_vs_sma200: s200, cruce_sma50_200: sCruce, pendiente_20: sPend, posicion_rango_52s: sRango, volumen_relativo_20: sVol };
  const { senales, motivo } = filtrarSenales(SENALES.map(s => ({ nombre: s.nombre, valor: valores[s.nombre], peso: s.pesoBase })), input.parametros);
  if (motivo) motivos.push(motivo);
  const c = combinar(senales);
  if (c.sesgo == null) motivos.push('Sin velas suficientes para evaluar tendencia (mínimo 20).');
  return finalizar({ ...c, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'tecnico' });
}
