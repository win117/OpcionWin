// Core técnico: tendencia y estructura de precio (no incluye osciladores: eso es del core indicadores).
// Entrada: velas diarias OHLCV ascendentes (Alpaca bars, feed IEX). Solo velas con fecha ≤ fechaReferencia (util.limpiarVelas).
// Cada sub-señal se lleva a −1..1 con la función indicada en su comentario; sesgo, confianza y cobertura salen de util.combinar.
// Limitación: si la última vela diaria es la sesión en curso (parcial), su volumen y cierre son provisionales.
import { clamp, combinar, esNumero, finalizar, filtrarSenales, limpiarVelas, metrica, pendienteRegresion, promedio, sma, smaSerie } from './util.js';

export const VERSION = 'tecnico@1.1.0';
export const REQUIERE = ['velas'];

export const SENALES = [
  { nombre: 'precio_vs_sma50', etiqueta: 'Precio vs SMA50', descripcion: 'Distancia porcentual del precio a la media móvil simple de 50 velas.', pesoBase: 1 },
  { nombre: 'precio_vs_sma200', etiqueta: 'Precio vs SMA200', descripcion: 'Distancia porcentual del precio a la media móvil simple de 200 velas.', pesoBase: 1.5 },
  { nombre: 'cruce_sma50_200', etiqueta: 'Cruce SMA50/SMA200', descripcion: 'Posición relativa de la SMA50 frente a la SMA200 (cruce dorado / de la muerte).', pesoBase: 1 },
  { nombre: 'pendiente_20', etiqueta: 'Pendiente 20 velas', descripcion: 'Pendiente de regresión lineal de las últimas 20 velas, en % del precio medio.', pesoBase: 1 },
  { nombre: 'posicion_rango_52s', etiqueta: 'Posición en rango 52 semanas', descripcion: 'Ubicación del precio entre el mínimo y el máximo de 52 semanas.', pesoBase: 0.75 },
  { nombre: 'volumen_relativo_20', etiqueta: 'Volumen relativo 20', descripcion: 'Volumen de la última vela frente al promedio de 20, confirmando la dirección.', pesoBase: 0.5 },
];

// ---- Constantes (fijas; no las cambia el perfil). Los pesoBase de SENALES son heurísticas de experto, no un ajuste estadístico:
// se da más peso a la tendencia de largo plazo (SMA200) y menos a señales ruidosas de una sola vela (volumen).
// Ventanas: convenciones estándar del análisis técnico (SMA 50/200 = tendencia de mediano/largo plazo).
export const SMA_CORTA = 50;
export const SMA_LARGA = 200;
// Escalas de saturación de tanh: con x = escala la señal vale tanh(1) ≈ 0.76; con 2·escala ≈ 0.96.
// 5 % sobre la SMA50 y 10 % sobre la SMA200 son desvíos "claros" en acciones de gran capitalización (heurística).
export const ESCALA_SMA50_PCT = 5;
export const ESCALA_SMA200_PCT = 10;
// Separación SMA50/SMA200 (en %) que satura la señal del cruce: clamp(dif/5, −1, 1).
export const ESCALA_CRUCE_PCT = 5;
// Velas hacia atrás en las que se reporta un cruce dorado/de la muerte reciente (≈ 1 mes bursátil).
export const VENTANA_CRUCE_RECIENTE = 20;
// Ventana de la pendiente de regresión (≈ 1 mes bursátil) y escala: 0.5 %/vela ≈ 10 % al mes es una tendencia fuerte.
export const VENTANA_PENDIENTE = 20;
export const ESCALA_PENDIENTE_PCT = 0.5;
// 52 semanas ≈ 252 sesiones bursátiles (convención NYSE). Mínimo 60 velas (≈ 3 meses) para que el rango sea informativo.
export const VENTANA_52S = 252;
export const MIN_RANGO = 60;
// Volumen relativo: promedio de las 20 velas previas (sin la última, para no compararla consigo misma).
export const VENTANA_VOLUMEN = 20;
// Volumen relativo desde el que se menciona en los motivos (solo descriptivo).
export const UMBRAL_VOLUMEN_MOTIVO = 1.5;

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
  const sma50 = sma(cierres, SMA_CORTA);
  let s50 = null;
  if (sma50 != null && sma50 > 0) {
    const pct = (ultimo / sma50 - 1) * 100;
    s50 = Math.tanh(pct / ESCALA_SMA50_PCT);
    metricas.push(metrica('precio_vs_sma50', pct, '%', '50'));
    motivos.push(`Precio ${pct >= 0 ? 'sobre' : 'bajo'} SMA50 (${pct.toFixed(2)}%).`);
  } else datosFaltantes.push('velas<50');

  // Precio vs SMA200 y cruce de medias
  const sma200 = sma(cierres, SMA_LARGA);
  let s200 = null;
  let sCruce = null;
  if (sma200 != null && sma200 > 0) {
    const pct = (ultimo / sma200 - 1) * 100;
    s200 = Math.tanh(pct / ESCALA_SMA200_PCT);
    metricas.push(metrica('precio_vs_sma200', pct, '%', '200'));
    const dif = (sma50 / sma200 - 1) * 100;
    const estado = dif > 0 ? 1 : dif < 0 ? -1 : 0;
    sCruce = estado * Math.min(1, Math.abs(dif) / ESCALA_CRUCE_PCT); // = clamp(dif/5)
    metricas.push(metrica('cruce_sma50_200', estado, 'estado', '50/200'), metrica('diferencia_sma50_200', dif, '%', '50/200'));
    // Cruce reciente (últimas 20 velas): cambio de signo de SMA50 − SMA200 entre velas consecutivas.
    const s50s = smaSerie(cierres, SMA_CORTA);
    const s200s = smaSerie(cierres, SMA_LARGA);
    for (let i = Math.max(SMA_LARGA, n - VENTANA_CRUCE_RECIENTE); i < n; i++) {
      const antes = s50s[i - 1] - s200s[i - 1];
      const ahora = s50s[i] - s200s[i];
      if (esNumero(antes) && antes <= 0 && ahora > 0) motivos.push('Cruce dorado (SMA50 cruza sobre SMA200) en las últimas 20 velas.');
      if (esNumero(antes) && antes >= 0 && ahora < 0) motivos.push('Cruce de la muerte (SMA50 cruza bajo SMA200) en las últimas 20 velas.');
    }
    motivos.push(`SMA50 ${estado >= 0 ? 'sobre' : 'bajo'} SMA200 (${dif.toFixed(2)}%).`);
  } else datosFaltantes.push('velas<200');

  // Pendiente de regresión lineal de 20 velas, en % del precio medio por vela
  let sPend = null;
  if (n >= VENTANA_PENDIENTE) {
    const ventana = cierres.slice(-VENTANA_PENDIENTE);
    const m = promedio(ventana);
    if (m > 0) {
      const pend = (pendienteRegresion(ventana) / m) * 100;
      sPend = Math.tanh(pend / ESCALA_PENDIENTE_PCT);
      metricas.push(metrica('pendiente_20', pend, '%/vela', String(VENTANA_PENDIENTE)));
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
      sRango = 2 * (pos - 0.5); // lineal: mínimo → −1, punto medio → 0, máximo → +1
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
  if (n >= VENTANA_VOLUMEN + 1 && vols.slice(-(VENTANA_VOLUMEN + 1)).every(v => esNumero(v) && v >= 0)) {
    const media = promedio(vols.slice(-(VENTANA_VOLUMEN + 1), -1));
    if (media > 0) {
      const vr = vols[n - 1] / media;
      const dir = Math.sign(cierres[n - 1] - cierres[n - 2]);
      // Solo el exceso de volumen confirma: vr ≤ 1 → 0; vr ≥ 2 → ±1 según la dirección de la última vela.
      sVol = dir * clamp(vr - 1, 0, 1);
      metricas.push(metrica('volumen_relativo_20', vr, 'razon', String(VENTANA_VOLUMEN)));
      if (vr > UMBRAL_VOLUMEN_MOTIVO) motivos.push(`Volumen ${vr.toFixed(2)}× el promedio confirma la vela ${dir > 0 ? 'alcista' : dir < 0 ? 'bajista' : 'neutral'}.`);
    }
  } else datosFaltantes.push('volumen<21');

  const valores = { precio_vs_sma50: s50, precio_vs_sma200: s200, cruce_sma50_200: sCruce, pendiente_20: sPend, posicion_rango_52s: sRango, volumen_relativo_20: sVol };
  const { senales, motivo } = filtrarSenales(SENALES.map(s => ({ nombre: s.nombre, valor: valores[s.nombre], peso: s.pesoBase })), input.parametros);
  if (motivo) motivos.push(motivo);
  const c = combinar(senales);
  if (c.sesgo == null) motivos.push('Sin velas suficientes para evaluar tendencia (mínimo 20).');
  return finalizar({ ...c, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'tecnico' });
}
