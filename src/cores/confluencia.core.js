// Confluencia: combina las evaluaciones direccionales de los cores en compatibilidad por estrategia
// (contrato §2, ADR-002 y ADR-012). Función pura y síncrona.
//
// Notación (por core i usado): s_i = sesgo (−1..1), c_i = confianza (0..1), w_i = ponderación del usuario (≥ 0, 1 por defecto).
// Peso efectivo e_i = w_i · c_i. La cobertura interna del core ya está incluida en c_i
// (util.combinar: confianza = cobertura × (0.5·consistencia + 0.5·intensidad)), por eso no se multiplica de nuevo.
//   s̄ = Σ e_i s_i / Σ e_i                         sesgo combinado
//   D = sqrt(Σ e_i (s_i − s̄)² / Σ e_i)            dispersión (desviación estándar ponderada; 0..1 porque s ∈ [−1, 1])
//   A = clamp(1 − D, 0, 1)                         acuerdo entre cores (un solo core → D = 0, A = 1)
//   LONG_CALL = 50 + 50·s̄·A ; LONG_PUT = 50 − 50·s̄·A
//   IRON_CONDOR = 100 · Σ e_i (1 − |s_i|) / Σ e_i + ajusteVolatilidad   (promedio de neutralidades, no neutralidad del promedio)
//   confianza = (Σ w_i c_i / Σ w_i) · cobertura · A
import { clamp, esNumero, round } from './util.js';

export const VERSION = 'confluencia@1.1.0';
export const CORES = ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias'];
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];

// Puntos máximos que la volatilidad suma/resta al Iron Condor. Heurística (ADR-002): ±15 sobre 100 permite que la
// volatilidad desempate pero nunca supere a la estructura direccional (que aporta hasta 100 puntos).
export const AJUSTE_IV_MAX = 15;
// IV/HV20 − 1 que satura el ajuste: ±20 % de prima (o descuento) de la IV sobre la volatilidad realizada → ±15.
export const SENSIBILIDAD_IV_HV = 0.2;
// IV Rank neutro (mitad del rango anual) y amplitud que satura el ajuste (rank 80 → +15; rank 20 → −15).
export const IV_RANK_CENTRO = 50;
export const IV_RANK_ESCALA = 30;
// Umbral del texto "alcista/bajista/neutral" en los motivos (solo descriptivo, no altera el puntaje).
export const UMBRAL_DIRECCION = 0.1;
// Dispersión desde la que el motivo habla de contradicción entre cores (solo descriptivo).
export const UMBRAL_CONTRADICCION = 0.35;

/**
 * Ajuste ±AJUSTE_IV_MAX del Iron Condor: IV alta respecto a la volatilidad realizada favorece vender prima.
 *  - Con IV y HV20 (ambas fracción anual): ajuste = clamp((IV/HV20 − 1) / 0.2, −1, 1) · 15.
 *  - Si no, con IV Rank (0..100; valores ≤ 1 se interpretan como fracción): ajuste = clamp((rank − 50)/30, −1, 1) · 15.
 *  - Sin datos: null (no se ajusta).
 * Limitación: IV/HV > 1 es lo habitual (prima de riesgo de varianza), así que el centro en 1 favorece algo al Iron Condor.
 */
export const ajusteVolatilidad = (volatilidad = {}) => {
  const { ivActual, hv20, ivRank } = volatilidad || {};
  if (esNumero(ivActual) && esNumero(hv20) && ivActual > 0 && hv20 > 0) {
    const ratio = ivActual / hv20;
    return { ajuste: clamp((ratio - 1) / SENSIBILIDAD_IV_HV) * AJUSTE_IV_MAX, motivo: `IV/HV20 = ${ratio.toFixed(2)}`, ratio };
  }
  if (esNumero(ivRank) && ivRank >= 0 && ivRank <= 100) {
    const rank = ivRank <= 1 ? ivRank * 100 : ivRank; // acepta 0..1 o 0..100
    return { ajuste: clamp((rank - IV_RANK_CENTRO) / IV_RANK_ESCALA) * AJUSTE_IV_MAX, motivo: `IV Rank = ${rank.toFixed(0)}` };
  }
  return null;
};

/** Estadísticos de acuerdo entre cores: { sesgo s̄, dispersion D, acuerdo A, neutralidad media }. */
export const estadisticos = usados => {
  const sumaE = usados.reduce((a, u) => a + u.e, 0);
  if (!(sumaE > 0)) return null;
  const sesgo = clamp(usados.reduce((a, u) => a + u.e * u.sesgo, 0) / sumaE);
  const dispersion = clamp(Math.sqrt(usados.reduce((a, u) => a + u.e * (u.sesgo - sesgo) ** 2, 0) / sumaE), 0, 1);
  const neutralidad = usados.reduce((a, u) => a + u.e * (1 - Math.abs(u.sesgo)), 0) / sumaE;
  return { sesgo, dispersion, acuerdo: clamp(1 - dispersion, 0, 1), neutralidad };
};

const m = (nombre, valor, unidad) => (esNumero(valor) ? { nombre, valor: round(valor), unidad } : null);

export function evaluar(input = {}) {
  const estrategia = input.estrategia;
  const motivos = [];
  if (!ESTRATEGIAS.includes(estrategia)) throw new TypeError(`Estrategia no soportada: ${estrategia}`);

  const evaluaciones = Array.isArray(input.evaluaciones) ? input.evaluaciones : [];
  let seleccionados = (Array.isArray(input.coresSeleccionados) ? input.coresSeleccionados : []).filter(c => CORES.includes(c));
  if (!seleccionados.length) seleccionados = [...new Set(evaluaciones.map(e => e && e.core).filter(c => CORES.includes(c)))];
  seleccionados = [...new Set(seleccionados)];

  const pesoDe = core => {
    const p = (input.ponderaciones || []).find(x => x && x.core === core);
    return p && esNumero(p.peso) && p.peso >= 0 ? p.peso : 1;
  };

  const usados = [];
  for (const core of seleccionados) {
    const ev = evaluaciones.find(e => e && e.core === core);
    if (!ev || !esNumero(ev.sesgo)) {
      motivos.push(`Core ${core} sin resultado: no se considera (no es evaluación negativa).`);
      continue;
    }
    const confianza = esNumero(ev.confianza) ? clamp(ev.confianza, 0, 1) : 0;
    const w = pesoDe(core);
    usados.push({ core, sesgo: clamp(ev.sesgo), confianza, w, e: w * confianza });
  }
  const cobertura = seleccionados.length ? usados.length / seleccionados.length : 0;
  const sumaE = usados.reduce((a, u) => a + u.e, 0);
  const ponderacionesEfectivas = seleccionados.map(core => {
    const u = usados.find(x => x.core === core);
    return { core, peso: u && sumaE > 0 ? round(u.e / sumaE) : 0 };
  });

  const est = estadisticos(usados);
  if (!est) {
    motivos.push(usados.length ? 'Todos los cores con resultado tienen confianza o peso cero: puntaje neutral 50.' : 'Ningún core seleccionado tiene resultado: puntaje neutral 50.');
    return { puntaje: 50, confianza: 0, cobertura: round(cobertura), sesgoCombinado: null, dispersion: null, acuerdo: null, metricas: [], motivos, ponderacionesEfectivas };
  }

  const { sesgo: s, dispersion: D, acuerdo: A, neutralidad } = est;
  const sumaW = usados.reduce((a, u) => a + u.w, 0);
  const confianzaMedia = sumaW > 0 ? usados.reduce((a, u) => a + u.w * u.confianza, 0) / sumaW : 0;
  const confianza = clamp(confianzaMedia * cobertura * A, 0, 1);

  let puntaje;
  let ajuste = null;
  if (estrategia === 'LONG_CALL') puntaje = 50 + 50 * s * A;
  else if (estrategia === 'LONG_PUT') puntaje = 50 - 50 * s * A;
  else {
    puntaje = 100 * neutralidad;
    const aj = ajusteVolatilidad(input.volatilidad);
    if (aj) {
      ajuste = aj.ajuste;
      puntaje += aj.ajuste;
      motivos.push(`Ajuste por volatilidad ${aj.ajuste >= 0 ? '+' : ''}${aj.ajuste.toFixed(1)} (${aj.motivo}).`);
    } else motivos.push('Sin datos de IV/HV: no se aplica ajuste de volatilidad.');
  }
  puntaje = clamp(puntaje, 0, 100);

  const dir = s > UMBRAL_DIRECCION ? 'alcista' : s < -UMBRAL_DIRECCION ? 'bajista' : 'neutral';
  const resumen = [`Sesgo combinado ${s.toFixed(3)} (${dir}) con ${usados.length}/${seleccionados.length} cores.`];
  if (usados.length > 1) {
    const pct = Math.round(D * 100);
    if (D >= UMBRAL_CONTRADICCION) {
      resumen.push(`Los cores se contradicen (dispersión ${D.toFixed(2)}): la señal direccional se reduce un ${pct} % y la confianza también.`);
    } else resumen.push(`Acuerdo entre cores ${A.toFixed(2)} (dispersión ${D.toFixed(2)}): la señal direccional se reduce un ${pct} %.`);
    if (estrategia === 'IRON_CONDOR') {
      resumen.push(`Neutralidad media de los cores ${neutralidad.toFixed(2)} (promedio de 1 − |sesgo| de cada core; un desacuerdo no cuenta como neutralidad).`);
    }
  }
  motivos.unshift(...resumen);

  const metricas = [
    m('sesgo_combinado', s, 'indice'),
    m('dispersion_cores', D, 'fraccion'),
    m('acuerdo_cores', A, 'fraccion'),
    m('neutralidad_media', neutralidad, 'fraccion'),
    m('confianza', confianza, 'fraccion'),
    m('cobertura', cobertura, 'fraccion'),
    ajuste != null ? m('ajuste_volatilidad', ajuste, 'puntos') : null,
  ].filter(Boolean);

  return {
    puntaje: round(puntaje, 2), confianza: round(confianza), cobertura: round(cobertura), sesgoCombinado: round(s),
    dispersion: round(D), acuerdo: round(A), metricas, motivos, ponderacionesEfectivas,
  };
}
