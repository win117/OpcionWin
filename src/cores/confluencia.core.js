// Confluencia: combina las evaluaciones direccionales de los cores en compatibilidad por estrategia (contrato §2, ADR-002).
import { clamp, esNumero, round } from './util.js';

export const VERSION = 'confluencia@1.0.0';
export const CORES = ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias'];
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];
const AJUSTE_IV = 15;

/** Ajuste ±15 del Iron Condor: IV alta respecto a HV favorece vender prima. */
export const ajusteVolatilidad = (volatilidad = {}) => {
  const { ivActual, hv20, ivRank } = volatilidad || {};
  if (esNumero(ivActual) && esNumero(hv20) && ivActual > 0 && hv20 > 0) {
    const ratio = ivActual / hv20;
    return { ajuste: clamp((ratio - 1) / 0.2) * AJUSTE_IV, motivo: `IV/HV20 = ${ratio.toFixed(2)}` };
  }
  if (esNumero(ivRank) && ivRank >= 0 && ivRank <= 100) {
    const rank = ivRank <= 1 ? ivRank * 100 : ivRank; // acepta 0..1 o 0..100
    return { ajuste: clamp((rank - 50) / 30) * AJUSTE_IV, motivo: `IV Rank = ${rank.toFixed(0)}` };
  }
  return null;
};

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
    usados.push({ core, sesgo: clamp(ev.sesgo), w: pesoDe(core) * confianza });
  }
  const cobertura = seleccionados.length ? usados.length / seleccionados.length : 0;
  const sumaW = usados.reduce((a, u) => a + u.w, 0);
  const ponderacionesEfectivas = seleccionados.map(core => {
    const u = usados.find(x => x.core === core);
    return { core, peso: u && sumaW > 0 ? round(u.w / sumaW) : 0 };
  });

  if (!usados.length || sumaW === 0) {
    motivos.push(usados.length ? 'Todos los cores con resultado tienen confianza o peso cero: puntaje neutral 50.' : 'Ningún core seleccionado tiene resultado: puntaje neutral 50.');
    return { puntaje: 50, cobertura: round(cobertura), sesgoCombinado: null, motivos, ponderacionesEfectivas };
  }

  const s = clamp(usados.reduce((a, u) => a + u.w * u.sesgo, 0) / sumaW);
  let puntaje;
  if (estrategia === 'LONG_CALL') puntaje = 50 + 50 * s;
  else if (estrategia === 'LONG_PUT') puntaje = 50 - 50 * s;
  else {
    puntaje = 100 * (1 - Math.abs(s));
    const aj = ajusteVolatilidad(input.volatilidad);
    if (aj) {
      puntaje += aj.ajuste;
      motivos.push(`Ajuste por volatilidad ${aj.ajuste >= 0 ? '+' : ''}${aj.ajuste.toFixed(1)} (${aj.motivo}).`);
    } else motivos.push('Sin datos de IV/HV: no se aplica ajuste de volatilidad.');
  }
  puntaje = clamp(puntaje, 0, 100);
  const dir = s > 0.1 ? 'alcista' : s < -0.1 ? 'bajista' : 'neutral';
  motivos.unshift(`Sesgo combinado ${s.toFixed(3)} (${dir}) con ${usados.length}/${seleccionados.length} cores.`);
  return { puntaje: round(puntaje, 2), cobertura: round(cobertura), sesgoCombinado: round(s), motivos, ponderacionesEfectivas };
}
