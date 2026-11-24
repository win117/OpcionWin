// Lógica pura de la página de análisis: veredicto en lenguaje llano, movimiento esperado, ejes y vigencia de los datos.
import { calificacionPara, desglosePuntaje, direccion, puntaje1, textoPuntaje } from './estrategiasOrden.js';
import { CORES, CORE_LABELS, ESTRATEGIA_LABELS } from './constants.js';
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Qué significa la compatibilidad (0–100). Mismo redondeo (un decimal) que el resto de la aplicación. */
export function encaje(puntaje) {
  const p = puntaje1(puntaje);
  if (p == null) return { texto: 'Sin datos', tono: 'neutral', detalle: 'No hay datos suficientes para opinar.' };
  if (p >= 60) return { texto: 'Encaja bien', tono: 'success', detalle: 'La mayoría de los factores apunta en la dirección que necesita esta estrategia.' };
  if (p >= 40) return { texto: 'A medias', tono: 'warning', detalle: 'Las señales están mezcladas: hay tanto a favor como en contra.' };
  return { texto: 'No encaja', tono: 'danger', detalle: 'Los factores apuntan en otra dirección que la que necesita esta estrategia.' };
}

const LECTURA = { up: 'alcista', down: 'bajista', flat: 'en rango', neutral: 'sin datos' };
const A_FAVOR = /\b(crecen|sobre|positivo|positiva|dorado|aumentan)\b/i;
const EN_CONTRA = /\b(caen|bajo|negativo|negativa|muerte|disminuyen)\b/i;

/** Primer motivo guardado que va en la misma dirección que la lectura del factor; null si ninguno lo hace con claridad. */
export function motivoClaro(ev) {
  const tono = direccion(ev?.puntaje).tono;
  if (tono !== 'up' && tono !== 'down') return null;
  for (const m of ev?.motivos || []) {
    const sent = /sentimiento ponderado (-?[\d.]+)/.exec(m);
    const arriba = sent ? Number(sent[1]) > 0 : A_FAVOR.test(m), abajo = sent ? Number(sent[1]) < 0 : EN_CONTRA.test(m);
    if (arriba !== abajo && arriba === (tono === 'up')) return m;
  }
  return null;
}

const nombrar = (core, ev) => `${CORE_LABELS[core] || core} ${textoPuntaje(ev.puntaje)} ${LECTURA[direccion(ev.puntaje).tono]}`;

/** Frase con los dos factores que más se oponen (uno alcista y otro bajista); null si ninguno se opone. */
export function contradiccion(cores, evaluaciones = {}) {
  const lista = cores.map(core => ({ core, ev: evaluaciones[core] })).filter(x => isNum(x.ev?.puntaje)).sort((a, b) => b.ev.puntaje - a.ev.puntaje);
  const alto = lista[0], bajo = lista.at(-1);
  if (!alto || direccion(alto.ev.puntaje).tono !== 'up' || direccion(bajo.ev.puntaje).tono !== 'down') return null;
  return `${nombrar(alto.core, alto.ev)} contra ${nombrar(bajo.core, bajo.ev)}`;
}

/**
 * Razones del puntaje de una estrategia según las evaluaciones guardadas, ordenadas por lo que pesan:
 * { favor: hasta 2, contra: la principal o null, contradiccion }. Cada razón es { titulo, detalle }.
 */
export function razones(codigo, { cores = [], evaluaciones = {}, pesos = [], puntaje = null, motivos = [] } = {}) {
  const lista = cores.map(core => {
    const ev = evaluaciones[core];
    const calif = calificacionPara(codigo, ev?.puntaje);
    if (!isNum(calif)) return null;
    const peso = pesos.find(p => p.core === core)?.peso;
    return { titulo: nombrar(core, ev), detalle: motivoClaro(ev), aporte: (calif - 50) * (isNum(peso) ? peso : 1) };
  }).filter(Boolean);
  if (codigo === 'IRON_CONDOR') {
    const { ajusteIv, motivoIv } = desglosePuntaje(codigo, cores, pesos, evaluaciones, puntaje, motivos);
    if (isNum(ajusteIv) && Math.abs(ajusteIv) >= 1 && motivoIv) {
      lista.push({ titulo: ajusteIv > 0 ? 'Primas relativamente caras: conviene a quien vende' : 'Primas relativamente baratas: perjudica a quien vende', detalle: motivoIv + '.', aporte: ajusteIv });
    }
  }
  const limpiar = r => r && { titulo: r.titulo, detalle: r.detalle };
  return {
    favor: lista.filter(r => r.aporte > 0).sort((a, b) => b.aporte - a.aporte).slice(0, 2).map(limpiar),
    contra: limpiar(lista.filter(r => r.aporte < 0).sort((a, b) => a.aporte - b.aporte)[0]) || null,
    contradiccion: contradiccion(cores, evaluaciones),
  };
}

/** Estrategias de la selección ordenadas por puntaje: [{ codigo, puntaje, … }]. */
export function filasEstrategia(datos) {
  return (datos?.seleccion?.resultados || [])
    .map(r => ({ ...r, codigo: datos.estrategiasById?.get(r.estrategiaId)?.codigo }))
    .filter(r => r.codigo)
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
}

/** Titular del veredicto: «Long Call: encaja bien». */
export const titular = (codigo, puntaje) => `${ESTRATEGIA_LABELS[codigo] || codigo}: ${encaje(puntaje).texto.toLowerCase()}`;

/** Movimiento esperado hasta el vencimiento: S · IV · √(días/365). { monto, abajo, arriba } o null. */
export function movimientoEsperado(S, iv, dias) {
  if (![S, iv, dias].every(v => isNum(v) && v > 0)) return null;
  const monto = S * iv * Math.sqrt(dias / 365);
  return { monto, abajo: Math.max(0, S - monto), arriba: S + monto };
}

/** Marcas redondas (1, 2, 2.5 o 5 × 10ⁿ) dentro de [min, max]: como mucho `maximo`. */
export function ticksRedondos(min, max, maximo = 6) {
  if (!(max > min) || maximo < 2) return [];
  const bruto = (max - min) / maximo;
  const base = 10 ** Math.floor(Math.log10(bruto));
  for (const f of [1, 2, 2.5, 5, 10, 20]) {
    const paso = f * base;
    if (paso < bruto - 1e-12) continue;
    const desde = Math.ceil(min / paso - 1e-9), hasta = Math.floor(max / paso + 1e-9);
    if (hasta - desde + 1 > maximo) continue;
    return Array.from({ length: hasta - desde + 1 }, (_, i) => Number(((desde + i) * paso).toFixed(10)) + 0);
  }
  return [];
}

export const MINUTOS_AL_DIA = 10;

/**
 * Recursos de un símbolo sincronizados sin fallos en los últimos 10 minutos: Map(recurso → minutos).
 * Los contratos solo cuentan si se pidieron con un rango de días que cubre el actual.
 */
export function recursosAlDia(sincronizaciones = [], simbolo, { diasMin, diasMax } = {}, ahora = Date.now()) {
  const out = new Map();
  for (const s of sincronizaciones) {
    const min = (ahora - Date.parse(s.finalizadaEn)) / 60000;
    if (s.estado !== 'completada' || s.fallidos > 0 || s.hasta || !(min >= 0 && min < MINUTOS_AL_DIA)) continue;
    if (!(s.simbolos || []).some(x => String(x).toUpperCase() === simbolo)) continue;
    if (s.recurso === 'contratos' && !(s.diasVencimientoMin <= diasMin && s.diasVencimientoMax >= diasMax)) continue;
    out.set(s.recurso, Math.min(out.get(s.recurso) ?? Infinity, Math.floor(min)));
  }
  return out;
}

/**
 * Qué factores opinaron en un análisis: { total, opinan, faltan: [{ core, motivo }], completo }.
 * `cores` = los que se pidieron; uno pedido sin puntaje no tuvo datos, y uno no pedido lo quitó el usuario.
 */
export function participacion(cores = [], evaluaciones = {}) {
  const faltan = CORES.filter(c => !(cores.includes(c) && isNum(evaluaciones[c]?.puntaje)))
    .map(core => ({ core, motivo: cores.includes(core) ? 'sin datos' : 'desactivado' }));
  return { total: CORES.length, opinan: CORES.length - faltan.length, faltan, completo: !faltan.length };
}
