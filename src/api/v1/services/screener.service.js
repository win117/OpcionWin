// Screener: puntaje por estrategia de un símbolo y ranking del universo. El universo vivo (universo-vivo.service.js) obtiene los
// datos y calcula los puntajes; leer el ranking no llama a proveedores.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { cores, confluencia } from '../../../cores';
import { CORES, ESTRATEGIAS } from '../models/shared';
import { todos } from './registros';

export const VERSION = 'screener@2.0.0';
const ETIQUETAS = { tecnico: 'Técnico', fundamental: 'Fundamental', institucional: 'Institucional', indicadores: 'Indicadores', noticias: 'Noticias' };

const redondear = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const acotar = (x, min = 0, max = 100) => Math.min(max, Math.max(min, x));
const metrica = (r, nombre) => r?.metricas?.find(m => m.nombre === nombre)?.valor;

// "AAPL251219C00200000" → { tipo, strike, vencimiento } (símbolo OCC).
export function parsearOcc(simbolo) {
  const m = /^[A-Z0-9.]{1,6}(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(simbolo));
  return m ? { tipo: m[4] === 'C' ? 'call' : 'put', strike: Number(m[5]) / 1000, vencimiento: `20${m[1]}-${m[2]}-${m[3]}` } : null;
}

// Desempate del ranking (p. ej. Iron Condor topado en 100): factor principal de la estrategia
// (neutralidad media en Iron Condor, sesgo combinado en Long Call/Put) y después el alfabeto.
const desempate = (r, estrategia) => r.factores?.[estrategia]?.[0]?.puntaje ?? -1;

const direccion = s => (s > 0.1 ? 'alcista' : s < -0.1 ? 'bajista' : 'neutral');
const pct = x => `${Math.round(x * 100)} %`;

// Lo que el ranking conserva de la evaluación de un core. Sin sesgo = se evaluó, pero no hubo datos para opinar.
export function resumirCore(r, actualizadoEn) {
  const num = (k, v) => (Number.isFinite(v) ? { [k]: redondear(v) } : {});
  return { ...num('sesgo', r.sesgo), ...num('confianza', r.confianza), ...num('puntaje', r.puntaje), ...num('cobertura', r.cobertura),
    motivo: String(r.motivos?.find(m => m) || '').slice(0, 300) || undefined, actualizadoEn };
}

/** Cores que solo necesitan precios: técnico e indicadores. */
export function evaluarPrecio({ simbolo, velas, opciones = [], fechaReferencia }) {
  const entrada = { simbolo, fechaReferencia, velas, opciones, parametros: {}, reglas: [] };
  const indicadores = cores.indicadores.evaluar(entrada), t = new Date(fechaReferencia);
  return { evaluaciones: { tecnico: resumirCore(cores.tecnico.evaluar(entrada), t), indicadores: resumirCore(indicadores, t) },
    ivActual: metrica(indicadores, 'iv_promedio') ?? null, hv20: metrica(indicadores, 'hv_20') ?? null };
}

/** Core que no depende de velas: fundamental, institucional o noticias. `datos` = sus insumos. */
export const evaluarCore = (core, datos, fechaReferencia) => resumirCore(cores[core].evaluar({ ...datos, fechaReferencia, parametros: {}, reglas: [] }), new Date(fechaReferencia));

/** Combina los cinco cores (los que falten no cuentan) → puntajes, factores y resúmenes por estrategia. */
export function combinarCores(evaluaciones, { ivActual, hv20 } = {}) {
  const lista = CORES.filter(c => evaluaciones[c]).map(core => ({ core, sesgo: evaluaciones[core].sesgo ?? null, confianza: evaluaciones[core].confianza ?? 0, puntaje: evaluaciones[core].puntaje ?? null, cobertura: evaluaciones[core].cobertura ?? 0 }));
  const puntajes = {}, factores = {}, resumenes = {};
  for (const estrategia of ESTRATEGIAS) {
    const r = confluencia.evaluar({ estrategia, evaluaciones: lista, coresSeleccionados: CORES, ponderaciones: CORES.map(core => ({ core, peso: 1 })), volatilidad: { ivActual, hv20 } });
    if (r.sesgoCombinado == null) { puntajes[estrategia] = null; factores[estrategia] = []; resumenes[estrategia] = 'Datos insuficientes.'; continue; }
    puntajes[estrategia] = redondear(r.puntaje, 2);
    const s = r.sesgoCombinado, acuerdo = metrica(r, 'acuerdo_cores') ?? 1, neutralidad = metrica(r, 'neutralidad_media');
    const condor = estrategia === 'IRON_CONDOR', dirigido = estrategia === 'LONG_PUT' ? -1 : 1;
    const favor = sesgo => redondear(condor ? (1 - Math.abs(sesgo)) * 100 : acotar(50 + 50 * sesgo * dirigido), 2);
    const f = [condor
      ? { nombre: 'Neutralidad media de los cores', valor: redondear(neutralidad), puntaje: redondear(acotar((neutralidad ?? 0) * 100), 2) }
      : { nombre: 'Sesgo combinado', valor: redondear(s), puntaje: favor(s) }];
    for (const { core, sesgo } of lista) if (Number.isFinite(sesgo)) f.push({ nombre: (condor ? 'Neutralidad: ' : '') + ETIQUETAS[core], valor: redondear(sesgo), puntaje: favor(sesgo) });
    if (condor && ivActual && hv20) f.push({ nombre: 'IV / volatilidad histórica 20d', valor: redondear(ivActual / hv20), puntaje: redondear(acotar(50 + ((ivActual / hv20 - 1) / confluencia.SENSIBILIDAD_IV_HV) * 50), 2) });
    f.push({ nombre: 'Acuerdo entre cores', valor: redondear(acuerdo), puntaje: redondear(acotar(acuerdo * 100), 2) });
    f.push({ nombre: 'Confianza', valor: redondear(r.confianza), puntaje: redondear(acotar(r.confianza * 100), 2) });
    factores[estrategia] = f;
    resumenes[estrategia] = condor
      ? `Neutralidad ${Math.round((neutralidad ?? 0) * 100)}/100${ivActual && hv20 ? `, IV/HV20 ${(ivActual / hv20).toFixed(2)}` : ''}, acuerdo entre cores ${pct(acuerdo)}.`
      : `Sesgo ${direccion(s)} (${s.toFixed(2)}), acuerdo entre cores ${pct(acuerdo)}, confianza ${pct(r.confianza)}.`;
  }
  return { puntajes, factores, resumenes };
}

/** Velas (+ opciones y otros cores ya evaluados) → puntajes por estrategia. */
export function puntuarSimbolo({ otros = {}, ...entrada }) {
  const { evaluaciones, ivActual, hv20 } = evaluarPrecio(entrada);
  return { ...combinarCores({ ...otros, ...evaluaciones }, { ivActual, hv20 }), ivActual, hv20 };
}

// Estado de cada factor de una fila: 'ok' (opinó), 'sin_datos' (se evaluó y no hay datos) o 'pendiente'.
export const coresDeFila = fila => CORES.map(core => {
  const e = fila.cores?.[core];
  return { core, estado: !e ? 'pendiente' : Number.isFinite(e.sesgo) ? 'ok' : 'sin_datos', puntaje: e?.puntaje ?? null, confianza: e?.confianza ?? null };
});

// Reintenta cuando el proveedor responde con su límite de solicitudes (429): antes ese dato se perdía sin avisar.
const pausa = ms => new Promise(r => { setTimeout(r, ms); });
export async function conReintento(fn, { intentos = 4, esperaMs = 15000, esperar = pausa } = {}) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      if (e?.codigo !== 'LIMITE' || i >= intentos) throw e;
      await esperar(esperaMs);
    }
  }
}

export function createScreener({ factory = repository, universo } = {}) {
  return {
    async ranking(ctx, { estrategia, limite = 5 } = {}) {
      if (estrategia !== undefined && !ESTRATEGIAS.includes(estrategia)) throw boom.badRequest('estrategia: ' + ESTRATEGIAS.join(', ') + '.');
      const n = Number(limite);
      if (!Number.isSafeInteger(n) || n < 1 || n > 50) throw boom.badRequest('limite debe estar entre 1 y 50.');
      // Universo vivo (se calcula solo al arrancar el servidor); si no está activo, lo último guardado por el usuario.
      const registros = universo?.listo() ? universo.filas() : await todos('screener', ctx, undefined, factory);
      const top = e => registros.filter(r => Number.isFinite(r.puntajes?.[e]))
        .sort((a, b) => b.puntajes[e] - a.puntajes[e] || desempate(b, e) - desempate(a, e) || a.simbolo.localeCompare(b.simbolo)).slice(0, n)
        .map(r => ({ simbolo: r.simbolo, nombre: r.nombre || r.simbolo, precio: r.precio ?? null, cambioPct: r.cambioPct ?? null, puntaje: r.puntajes[e],
          factores: (r.factores?.[e] || []).map(({ nombre, valor, puntaje }) => ({ nombre, valor: valor ?? null, puntaje })), resumen: r.resumenes?.[e] || '', cores: coresDeFila(r), actualizadoEn: r.actualizadoEn }));
      const ultima = registros.reduce((m, r) => (r.actualizadoEn && (!m || new Date(r.actualizadoEn) > new Date(m)) ? r.actualizadoEn : m), null);
      const resumenUniverso = { total: registros.length, actualizadoEn: ultima, ...(universo ? universo.estado() : {}) };
      if (estrategia) return { items: top(estrategia), universo: resumenUniverso };
      return { estrategias: Object.fromEntries(ESTRATEGIAS.map(e => [e, top(e)])), universo: resumenUniverso };
    },
  };
}
