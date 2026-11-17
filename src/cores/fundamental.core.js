// Core fundamental: crecimiento, márgenes, apalancamiento y liquidez a partir de periodos reportados (SEC).
// Comparaciones solo entre periodos de igual duración: anual vs anual, o trimestre vs mismo trimestre del año previo.
// Entrada: periodos construidos desde SEC companyfacts (XBRL us-gaap, ver src/integrations/sec.client.js METRICAS_SEC):
// ingresos, utilidad_neta, flujo_operativo, eps_diluido (duración); pasivos, capital, activo_circulante, pasivo_circulante (instante).
// Valores en USD; las razones se reportan en % (márgenes, crecimientos) o como razón adimensional.
import { clamp, combinar, DIA_MS, esNumero, filtrarSenales, finalizar, metrica, tiempo } from './util.js';

export const VERSION = 'fundamental@1.1.0';
export const REQUIERE = ['fundamentales'];
export const SENALES = [
  { nombre: 'crecimiento_ingresos_yoy', etiqueta: 'Crecimiento de ingresos (YoY)', descripcion: 'Variación interanual de los ingresos.', pesoBase: 1.5 },
  { nombre: 'crecimiento_utilidad_yoy', etiqueta: 'Crecimiento de utilidad (YoY)', descripcion: 'Variación interanual de la utilidad neta.', pesoBase: 1 },
  { nombre: 'margen_neto', etiqueta: 'Margen neto', descripcion: 'Utilidad neta sobre ingresos.', pesoBase: 1 },
  { nombre: 'deuda_capital', etiqueta: 'Deuda / capital', descripcion: 'Pasivos totales sobre capital contable (apalancamiento).', pesoBase: 1 },
  { nombre: 'razon_corriente', etiqueta: 'Razón corriente', descripcion: 'Activo circulante sobre pasivo circulante (liquidez).', pesoBase: 0.75 },
  { nombre: 'margen_flujo_operativo', etiqueta: 'Margen de flujo operativo', descripcion: 'Flujo operativo sobre ingresos.', pesoBase: 1 },
];

const FLUJOS = ['ingresos', 'utilidad_neta', 'flujo_operativo', 'eps_diluido'];

// ---- Constantes (fijas). pesoBase = heurística de experto (el crecimiento de ingresos pesa más porque es la variable
// fundamental más persistente; liquidez pesa menos). No hay ajuste estadístico.
// Duración en días que define un periodo anual (365 ± ~1 mes, incluye años fiscales de 52/53 semanas) y trimestral (91 ± 10).
export const DIAS_ANUAL = [330, 400];
export const DIAS_TRIMESTRAL = [80, 100];
// Comparable interanual: periodo del mismo tipo que cierra 365 ± 25 días antes (cubre calendarios fiscales de 52/53 semanas).
export const TOLERANCIA_YOY_DIAS = 25;
// Escalas de tanh (con x = escala → ±0.76): +10 % de ingresos, +20 % de utilidad (más volátil), 10 % de margen neto
// (≈ mediana del S&P 500) y 15 % de margen de flujo operativo (el flujo suele superar a la utilidad).
export const ESCALA_CRECIMIENTO_INGRESOS_PCT = 10;
export const ESCALA_CRECIMIENTO_UTILIDAD_PCT = 20;
export const ESCALA_MARGEN_NETO_PCT = 10;
export const ESCALA_MARGEN_FLUJO_PCT = 15;
// Deuda/capital: señal lineal clamp(1.5 − d): d = 0.5 → +1, d = 1.5 → 0, d = 2.5 → −1 (pasivos totales ≈ 1.5× capital es típico).
export const DEUDA_CAPITAL_NEUTRA = 1.5;
// Razón corriente: clamp(rc − 1): rc = 1 (activo circulante = pasivo circulante) es neutro; rc ≥ 2 → +1; rc ≤ 0 → −1.
export const RAZON_CORRIENTE_NEUTRA = 1;

/** Clasifica el periodo por duración (días); `forma` (10-K/10-Q) solo desempata. */
export const tipoPeriodo = p => {
  const ini = tiempo(p.periodoInicio);
  const fin = tiempo(p.periodoFin);
  if (ini != null && fin != null && fin > ini) {
    const dias = (fin - ini) / DIA_MS;
    if (dias >= DIAS_ANUAL[0] && dias <= DIAS_ANUAL[1]) return 'anual';
    if (dias >= DIAS_TRIMESTRAL[0] && dias <= DIAS_TRIMESTRAL[1]) return 'trimestral';
    return 'otro';
  }
  const forma = String(p.forma || '').toUpperCase();
  if (forma.startsWith('10-K')) return 'anual';
  if (forma.startsWith('10-Q')) return 'trimestral';
  return 'instante';
};

// Fecha como AAAA-MM-DD (acepta Date u ISO string; String(Date) daría 'Sat Jul 25').
const isoDia = d => new Date(d).toISOString().slice(0, 10);

const valorDe = (p, nombre) => {
  const m = (p.metricas || []).find(x => x && x.nombre === nombre && esNumero(x.valor));
  return m ? m.valor : null;
};

export function evaluar(input = {}) {
  const ref = tiempo(input.fechaReferencia);
  // Sin sesgo de anticipación: un periodo cuenta solo si ya se conocía en fechaReferencia
  // (fechaPresentacion = fecha de presentación a la SEC si viene; si no, el cierre del periodo).
  const conocido = p => (tiempo(p.fechaPresentacion) ?? tiempo(p.periodoFin)) <= ref;
  const periodos = (Array.isArray(input.fundamentales) ? input.fundamentales : [])
    .filter(p => p && tiempo(p.periodoFin) != null && (ref == null || conocido(p)))
    .map(p => ({ ...p, _fin: tiempo(p.periodoFin), _tipo: tipoPeriodo(p) }))
    .sort((a, b) => b._fin - a._fin);
  const motivos = [];
  const datosFaltantes = [];
  const metricas = [];
  if (!periodos.length) datosFaltantes.push('fundamentales');

  // Periodo de flujo más reciente con ingresos (anual o trimestral) y su comparable un año antes (±25 días).
  const conFlujo = periodos.filter(p => (p._tipo === 'anual' || p._tipo === 'trimestral') && FLUJOS.some(f => valorDe(p, f) != null));
  const actual = conFlujo.find(p => valorDe(p, 'ingresos') != null) || conFlujo[0] || null;
  const previo = actual
    ? conFlujo.find(p => p !== actual && p._tipo === actual._tipo && Math.abs(actual._fin - 365 * DIA_MS - p._fin) <= TOLERANCIA_YOY_DIAS * DIA_MS)
    : null;
  const etiqueta = actual ? `${actual._tipo}:${isoDia(actual.periodoFin)}` : undefined;
  if (actual) motivos.push(`Periodo base ${actual._tipo} con cierre ${isoDia(actual.periodoFin)}${previo ? `, comparado con ${isoDia(previo.periodoFin)}` : ''}.`);
  else datosFaltantes.push('fundamentales.periodo_flujo');
  if (actual && !previo) datosFaltantes.push('fundamentales.periodo_comparable_yoy');

  const ing0 = actual && valorDe(actual, 'ingresos');
  const ut0 = actual && valorDe(actual, 'utilidad_neta');
  const fo0 = actual && valorDe(actual, 'flujo_operativo');
  const ing1 = previo && valorDe(previo, 'ingresos');
  const ut1 = previo && valorDe(previo, 'utilidad_neta');

  let sIng = null;
  if (esNumero(ing0) && esNumero(ing1) && ing1 > 0) {
    const g = (ing0 / ing1 - 1) * 100;
    sIng = Math.tanh(g / ESCALA_CRECIMIENTO_INGRESOS_PCT);
    metricas.push(metrica('crecimiento_ingresos_yoy', g, '%', etiqueta));
    motivos.push(`Ingresos ${g >= 0 ? 'crecen' : 'caen'} ${Math.abs(g).toFixed(1)}% interanual.`);
  } else datosFaltantes.push('crecimiento_ingresos_yoy');

  let sUt = null;
  if (esNumero(ut0) && esNumero(ut1) && ut1 !== 0) {
    const g = ((ut0 - ut1) / Math.abs(ut1)) * 100; // |U1| en el denominador: mejora con pérdidas previas → positivo
    sUt = Math.tanh(g / ESCALA_CRECIMIENTO_UTILIDAD_PCT);
    metricas.push(metrica('crecimiento_utilidad_yoy', g, '%', etiqueta));
  } else datosFaltantes.push('crecimiento_utilidad_yoy');

  let sMargen = null;
  if (esNumero(ut0) && esNumero(ing0) && ing0 > 0) {
    const m = (ut0 / ing0) * 100;
    sMargen = Math.tanh(m / ESCALA_MARGEN_NETO_PCT);
    metricas.push(metrica('margen_neto', m, '%', etiqueta));
  } else datosFaltantes.push('margen_neto');

  let sFlujo = null;
  if (esNumero(fo0) && esNumero(ing0) && ing0 > 0) {
    const m = (fo0 / ing0) * 100;
    sFlujo = Math.tanh(m / ESCALA_MARGEN_FLUJO_PCT);
    metricas.push(metrica('margen_flujo_operativo', m, '%', etiqueta));
  } else datosFaltantes.push('margen_flujo_operativo');

  // Balance: periodo más reciente que tenga ambos valores (los saldos son de instante; no se exige duración).
  const balance = (a, b) => periodos.find(p => valorDe(p, a) != null && valorDe(p, b) != null);
  let sDeuda = null;
  const pDeuda = balance('pasivos', 'capital');
  if (pDeuda) {
    const pas = valorDe(pDeuda, 'pasivos');
    const cap = valorDe(pDeuda, 'capital');
    if (cap > 0) {
      const d = pas / cap;
      sDeuda = clamp(DEUDA_CAPITAL_NEUTRA - d); // 0.5 → +1, 1.5 → 0, 2.5 → −1
      metricas.push(metrica('deuda_capital', d, 'razon', isoDia(pDeuda.periodoFin)));
    } else {
      sDeuda = -1;
      motivos.push('Capital contable no positivo: apalancamiento desfavorable (razón no definida).');
    }
  } else datosFaltantes.push('deuda_capital');

  let sLiq = null;
  const pLiq = balance('activo_circulante', 'pasivo_circulante');
  if (pLiq && valorDe(pLiq, 'pasivo_circulante') > 0) {
    const rc = valorDe(pLiq, 'activo_circulante') / valorDe(pLiq, 'pasivo_circulante');
    sLiq = clamp(rc - RAZON_CORRIENTE_NEUTRA); // 2 → +1, 1 → 0, 0 → −1
    metricas.push(metrica('razon_corriente', rc, 'razon', isoDia(pLiq.periodoFin)));
  } else datosFaltantes.push('razon_corriente');

  const eps = actual && valorDe(actual, 'eps_diluido');
  if (esNumero(eps)) metricas.push(metrica('eps_diluido', eps, 'USD/accion', etiqueta));

  const valores = { crecimiento_ingresos_yoy: sIng, crecimiento_utilidad_yoy: sUt, margen_neto: sMargen, deuda_capital: sDeuda, razon_corriente: sLiq, margen_flujo_operativo: sFlujo };
  const { senales, motivo } = filtrarSenales(SENALES.map(s => ({ nombre: s.nombre, valor: valores[s.nombre], peso: s.pesoBase })), input.parametros);
  if (motivo) motivos.push(motivo);
  const c = combinar(senales);
  if (c.sesgo == null) motivos.push('Sin métricas fundamentales calculables.');
  motivos.push('Pasivos totales se usan como aproximación de deuda (deuda_capital = pasivos/capital).');
  return finalizar({ ...c, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'fundamental' });
}
