// Core indicadores: osciladores de momentum y volatilidad (no incluye tendencia: eso es del core técnico).
// Entrada: velas diarias (Alpaca bars IEX) ≤ fechaReferencia y, opcional, snapshots de opciones cerca del dinero
// (Alpaca options snapshots, feed indicative: volatilidadImplicita en fracción anual).
// Señales direccionales: RSI, MACD, estocástico, Bollinger. Volatilidad (ATR%, HV20, HV60, IV) es no direccional:
// solo cuenta en la cobertura y alimenta el ajuste del Iron Condor en la confluencia.
import { atr, bollinger, clamp, combinar, DIA_MS, esNumero, estocastico, filtrarSenales, finalizar, limpiarVelas, macd, metrica, promedio, rsi, tiempo, volatilidadHistorica } from './util.js';

export const VERSION = 'indicadores@1.1.0';
export const REQUIERE = ['velas', 'opciones?'];
export const SENALES = [
  { nombre: 'rsi_14', etiqueta: 'RSI 14', descripcion: 'Índice de fuerza relativa de Wilder (sobrecompra/sobreventa).', pesoBase: 1 },
  { nombre: 'macd_hist', etiqueta: 'Histograma MACD', descripcion: 'Histograma del MACD (12, 26, 9): momentum de tendencia.', pesoBase: 1 },
  { nombre: 'estocastico_k', etiqueta: 'Estocástico %K', descripcion: 'Oscilador estocástico %K (14, 3).', pesoBase: 0.75 },
  { nombre: 'bollinger_pctb', etiqueta: 'Bollinger %B', descripcion: 'Posición del precio dentro de las bandas de Bollinger (20, 2).', pesoBase: 0.75 },
];

// ---- Constantes (fijas). Ventanas = definiciones estándar de cada indicador. pesoBase = heurística de experto
// (RSI y MACD son los osciladores más usados; estocástico y %B, más ruidosos, pesan 0.75). No hay ajuste estadístico.
export const RSI_N = 14; // Wilder (1978)
export const MACD_RAPIDA = 12; // Appel: EMA 12, EMA 26, señal EMA 9
export const MACD_LENTA = 26;
export const MACD_SENAL = 9;
export const ESTOCASTICO_K = 14; // Lane: %K 14, %D = SMA 3 de %K
export const ESTOCASTICO_D = 3;
export const BOLLINGER_N = 20; // Bollinger: SMA 20 ± 2 desviaciones (poblacionales)
export const BOLLINGER_K = 2;
export const ATR_N = 14; // Wilder
export const HV_CORTA = 20; // ≈ 1 mes bursátil
export const HV_LARGA = 60; // ≈ 3 meses bursátiles
// Zonas de sobrecompra/sobreventa: 70/30 (RSI, Wilder) y 80/20 (estocástico, Lane).
export const RSI_BAJO = 30;
export const RSI_ALTO = 70;
export const ESTOCASTICO_BAJO = 20;
export const ESTOCASTICO_ALTO = 80;
// Histograma MACD en % del precio que da tanh(1) ≈ 0.76 (heurística: 0.5 % del precio es momentum marcado).
export const ESCALA_MACD_PCT = 0.5;
// Régimen de volatilidad en expansión: HV20 > 1.5·HV60 reduce la confianza un 20 % (heurística: los osciladores fallan más en rupturas).
export const UMBRAL_EXPANSION_HV = 1.5;
export const FACTOR_CONFIANZA_EXPANSION = 0.8;
// IV aceptada: (0, 5] en fracción anual; valores mayores en el feed indicativo se consideran errores de cotización.
export const IV_MAXIMA = 5;

// Momentum que se atenúa en zonas extremas (sobrecompra/sobreventa) en vez de invertirse. Función continua por tramos:
//   bajo ≤ v ≤ alto: lineal, (v − 50)/(alto − 50) si v ≥ 50, (v − 50)/(50 − bajo) si v < 50  → −1..1
//   v > alto: 1 − (v − alto)/(100 − alto)  (de +1 en `alto` a 0 en 100)
//   v < bajo: −1 + (bajo − v)/bajo         (de −1 en `bajo` a 0 en 0)
export const senalOscilador = (valor, bajo, alto) => {
  const centro = 50;
  if (valor > alto) return clamp(1 - (valor - alto) / (100 - alto), 0, 1);
  if (valor < bajo) return clamp(-1 + (bajo - valor) / bajo, -1, 0);
  return valor >= centro ? (valor - centro) / (alto - centro) : (valor - centro) / (centro - bajo);
};

export function evaluar(input = {}) {
  const velas = limpiarVelas(input.velas, input.fechaReferencia);
  const cierres = velas.map(v => v.cierre);
  const ultimo = cierres.length ? cierres[cierres.length - 1] : null;
  const motivos = [];
  const datosFaltantes = [];
  const metricas = [];
  const falta = (cond, etiqueta) => { if (cond) datosFaltantes.push(etiqueta); };

  if (!velas.length) datosFaltantes.push('velas');

  // RSI 14 (Wilder)
  const vRsi = rsi(cierres, RSI_N);
  falta(vRsi == null, 'velas<15');
  const sRsi = vRsi == null ? null : senalOscilador(vRsi, RSI_BAJO, RSI_ALTO);
  metricas.push(metrica('rsi_14', vRsi, 'indice', String(RSI_N)));
  if (vRsi != null) {
    if (vRsi > RSI_ALTO) motivos.push(`RSI ${vRsi.toFixed(1)} en sobrecompra: momentum alcista atenuado.`);
    else if (vRsi < RSI_BAJO) motivos.push(`RSI ${vRsi.toFixed(1)} en sobreventa: momentum bajista atenuado.`);
    else motivos.push(`RSI ${vRsi.toFixed(1)} ${vRsi >= 50 ? 'sobre' : 'bajo'} 50.`);
  }

  // MACD 12/26/9: histograma normalizado como % del precio (0.5% ≈ señal fuerte)
  const vMacd = macd(cierres, MACD_RAPIDA, MACD_LENTA, MACD_SENAL);
  falta(vMacd == null, 'velas<34');
  let sMacd = null;
  if (vMacd && ultimo > 0) {
    sMacd = Math.tanh(((vMacd.histograma / ultimo) * 100) / ESCALA_MACD_PCT);
    metricas.push(metrica('macd_hist', vMacd.histograma, 'precio', '12/26/9'));
    motivos.push(`Histograma MACD ${vMacd.histograma >= 0 ? 'positivo' : 'negativo'}.`);
  }

  // Estocástico 14/3
  const vEst = estocastico(velas, ESTOCASTICO_K, ESTOCASTICO_D); // limpiarVelas ya garantiza OHLC finitos
  falta(vEst == null, 'velas<16');
  const sEst = vEst == null ? null : senalOscilador(vEst.k, ESTOCASTICO_BAJO, ESTOCASTICO_ALTO);
  if (vEst) {
    metricas.push(metrica('estocastico_k', vEst.k, 'indice', '14'), metrica('estocastico_d', vEst.d, 'indice', '3'));
  }

  // Bollinger 20,2: %B centrado en 0.5
  const vBol = bollinger(cierres, BOLLINGER_N, BOLLINGER_K);
  falta(vBol == null, 'velas<20');
  const sBol = vBol == null ? null : clamp(2 * (vBol.pctB - 0.5)); // %B 0 → −1, 0.5 → 0, 1 → +1 (fuera de bandas satura)
  if (vBol) metricas.push(metrica('bollinger_pctb', vBol.pctB, 'fraccion', '20,2'));

  // Volatilidad (no direccional): ATR%, HV20, HV60
  const vAtr = atr(velas, ATR_N);
  const atrPct = vAtr != null && ultimo > 0 ? (vAtr / ultimo) * 100 : null;
  metricas.push(metrica('atr_pct', atrPct, '%', '14'));
  const hv20 = volatilidadHistorica(cierres, HV_CORTA);
  const hv60 = volatilidadHistorica(cierres, HV_LARGA);
  falta(hv20 == null, 'velas<21');
  falta(hv60 == null, 'velas<61');
  metricas.push(metrica('hv_20', hv20, 'fraccion_anual', '20'), metrica('hv_60', hv60, 'fraccion_anual', '60'));

  // IV vs HV si hay opciones: promedio simple de la IV de los contratos vigentes (no vencidos a la fecha de referencia).
  const subVol = [atrPct, hv20, hv60];
  const ref = tiempo(input.fechaReferencia);
  const opciones = (Array.isArray(input.opciones) ? input.opciones : [])
    .filter(o => o && (ref == null || tiempo(o.vencimiento) == null || tiempo(o.vencimiento) >= ref - DIA_MS));
  if (opciones.length) {
    const ivs = opciones.map(o => o.volatilidadImplicita).filter(v => esNumero(v) && v > 0 && v <= IV_MAXIMA);
    const iv = ivs.length ? promedio(ivs) : null;
    subVol.push(iv);
    if (iv == null) datosFaltantes.push('opciones.volatilidadImplicita');
    metricas.push(metrica('iv_promedio', iv, 'fraccion_anual'));
    if (iv != null && hv20 > 0) {
      const ratio = iv / hv20;
      metricas.push(metrica('iv_hv_ratio', ratio, 'razon', '20'));
      motivos.push(`IV promedio ${(iv * 100).toFixed(1)}% vs HV20 ${(hv20 * 100).toFixed(1)}% (razón ${ratio.toFixed(2)}).`);
    }
  }

  const valores = { rsi_14: sRsi, macd_hist: sMacd, estocastico_k: sEst, bollinger_pctb: sBol };
  const { senales: direccionales, motivo: motivoSenales } = filtrarSenales(SENALES.map(s => ({ nombre: s.nombre, valor: valores[s.nombre], peso: s.pesoBase })), input.parametros);
  if (motivoSenales) motivos.push(motivoSenales);
  const c = combinar(direccionales);
  const total = direccionales.length + subVol.length;
  const calculadas = direccionales.filter(s => s.valor != null).length + subVol.filter(v => v != null).length;
  const cobertura = total ? calculadas / total : 0;
  // Confianza: la de combinar (calculada con la cobertura direccional) reescalada a la cobertura total (direccional + volatilidad).
  let confianza = c.confianza * (cobertura / (c.cobertura || 1));

  // Régimen de volatilidad en expansión: reduce confianza de las señales de momentum.
  if (hv20 != null && hv60 != null && hv60 > 0 && hv20 / hv60 > UMBRAL_EXPANSION_HV) {
    confianza *= FACTOR_CONFIANZA_EXPANSION;
    motivos.push('Volatilidad en expansión (HV20 > 1.5×HV60): confianza reducida.');
  }
  if (c.sesgo == null) motivos.push('Sin velas suficientes para osciladores de momentum.');

  return finalizar({ sesgo: c.sesgo, confianza, cobertura, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'indicadores' });
}
