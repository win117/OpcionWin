// Core indicadores: osciladores de momentum y volatilidad (no incluye tendencia: eso es del core técnico).
import { atr, bollinger, clamp, combinar, esNumero, estocastico, finalizar, limpiarVelas, macd, metrica, promedio, rsi, volatilidadHistorica } from './util.js';

export const VERSION = 'indicadores@1.0.0';
export const REQUIERE = ['velas', 'opciones?'];

// Momentum que se atenúa en zonas extremas (sobrecompra/sobreventa) en vez de invertirse.
const senalOscilador = (valor, bajo, alto) => {
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
  const vRsi = rsi(cierres, 14);
  falta(vRsi == null, 'velas<15');
  const sRsi = vRsi == null ? null : senalOscilador(vRsi, 30, 70);
  metricas.push(metrica('rsi_14', vRsi, 'indice', '14'));
  if (vRsi != null) {
    if (vRsi > 70) motivos.push(`RSI ${vRsi.toFixed(1)} en sobrecompra: momentum alcista atenuado.`);
    else if (vRsi < 30) motivos.push(`RSI ${vRsi.toFixed(1)} en sobreventa: momentum bajista atenuado.`);
    else motivos.push(`RSI ${vRsi.toFixed(1)} ${vRsi >= 50 ? 'sobre' : 'bajo'} 50.`);
  }

  // MACD 12/26/9: histograma normalizado como % del precio (0.5% ≈ señal fuerte)
  const vMacd = macd(cierres, 12, 26, 9);
  falta(vMacd == null, 'velas<34');
  let sMacd = null;
  if (vMacd && ultimo > 0) {
    sMacd = Math.tanh(((vMacd.histograma / ultimo) * 100) / 0.5);
    metricas.push(metrica('macd_hist', vMacd.histograma, 'precio', '12/26/9'));
    motivos.push(`Histograma MACD ${vMacd.histograma >= 0 ? 'positivo' : 'negativo'}.`);
  }

  // Estocástico 14/3
  const vEst = velas.every(v => esNumero(v.maximo) && esNumero(v.minimo)) ? estocastico(velas, 14, 3) : null;
  falta(vEst == null, 'velas<16');
  const sEst = vEst == null ? null : senalOscilador(vEst.k, 20, 80);
  if (vEst) {
    metricas.push(metrica('estocastico_k', vEst.k, 'indice', '14'), metrica('estocastico_d', vEst.d, 'indice', '3'));
  }

  // Bollinger 20,2: %B centrado en 0.5
  const vBol = bollinger(cierres, 20, 2);
  falta(vBol == null, 'velas<20');
  const sBol = vBol == null ? null : clamp(2 * (vBol.pctB - 0.5));
  if (vBol) metricas.push(metrica('bollinger_pctb', vBol.pctB, 'fraccion', '20,2'));

  // Volatilidad (no direccional): ATR%, HV20, HV60
  const vAtr = atr(velas, 14);
  const atrPct = vAtr != null && ultimo > 0 ? (vAtr / ultimo) * 100 : null;
  metricas.push(metrica('atr_pct', atrPct, '%', '14'));
  const hv20 = volatilidadHistorica(cierres, 20);
  const hv60 = volatilidadHistorica(cierres, 60);
  falta(hv20 == null, 'velas<21');
  falta(hv60 == null, 'velas<61');
  metricas.push(metrica('hv_20', hv20, 'fraccion_anual', '20'), metrica('hv_60', hv60, 'fraccion_anual', '60'));

  // IV vs HV si hay opciones
  const subVol = [atrPct, hv20, hv60];
  const opciones = Array.isArray(input.opciones) ? input.opciones : [];
  if (opciones.length) {
    const ivs = opciones.map(o => o && o.volatilidadImplicita).filter(v => esNumero(v) && v > 0);
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

  const direccionales = [
    { nombre: 'rsi_14', valor: sRsi, peso: 1 },
    { nombre: 'macd_hist', valor: sMacd, peso: 1 },
    { nombre: 'estocastico_k', valor: sEst, peso: 0.75 },
    { nombre: 'bollinger_pctb', valor: sBol, peso: 0.75 },
  ];
  const c = combinar(direccionales);
  const total = direccionales.length + subVol.length;
  const calculadas = direccionales.filter(s => s.valor != null).length + subVol.filter(v => v != null).length;
  const cobertura = total ? calculadas / total : 0;
  let confianza = c.confianza * (cobertura / (c.cobertura || 1));

  // Régimen de volatilidad en expansión: reduce confianza de las señales de momentum.
  if (hv20 != null && hv60 != null && hv60 > 0 && hv20 / hv60 > 1.5) {
    confianza *= 0.8;
    motivos.push('Volatilidad en expansión (HV20 > 1.5×HV60): confianza reducida.');
  }
  if (c.sesgo == null) motivos.push('Sin velas suficientes para osciladores de momentum.');

  return finalizar({ sesgo: c.sesgo, confianza, cobertura, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'indicadores' });
}
