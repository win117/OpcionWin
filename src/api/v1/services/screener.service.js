// Screener: puntaje por estrategia de un símbolo y ranking del universo. El universo vivo (universo-vivo.service.js) obtiene los
// datos y calcula los puntajes; leer el ranking no llama a proveedores.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { cores, confluencia } from '../../../cores';
import { ESTRATEGIAS } from '../models/shared';
import { todos } from './registros';

export const VERSION = 'screener@1.0.0';
const CORES_SCREENER = ['tecnico', 'indicadores'];

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

// Puro: velas (+ opciones) → puntajes, factores y resúmenes por estrategia.
export function puntuarSimbolo({ simbolo, velas, opciones = [], fechaReferencia }) {
  const entrada = { simbolo, fechaReferencia, velas, opciones, parametros: {}, reglas: [] };
  const evaluaciones = { tecnico: cores.tecnico.evaluar(entrada), indicadores: cores.indicadores.evaluar(entrada) };
  const lista = CORES_SCREENER.map(core => ({ core, sesgo: evaluaciones[core].sesgo ?? null, confianza: evaluaciones[core].confianza ?? 0, puntaje: evaluaciones[core].puntaje ?? null, cobertura: evaluaciones[core].cobertura ?? 0 }));
  const ivActual = metrica(evaluaciones.indicadores, 'iv_promedio');
  const hv20 = metrica(evaluaciones.indicadores, 'hv_20');
  const puntajes = {}, factores = {}, resumenes = {};
  for (const estrategia of ESTRATEGIAS) {
    const r = confluencia.evaluar({ estrategia, evaluaciones: lista, coresSeleccionados: CORES_SCREENER, ponderaciones: CORES_SCREENER.map(core => ({ core, peso: 1 })), volatilidad: { ivActual, hv20 } });
    if (r.sesgoCombinado == null) { puntajes[estrategia] = null; factores[estrategia] = []; resumenes[estrategia] = 'Datos insuficientes.'; continue; }
    puntajes[estrategia] = redondear(r.puntaje, 2);
    const s = r.sesgoCombinado, acuerdo = metrica(r, 'acuerdo_cores') ?? 1, neutralidad = metrica(r, 'neutralidad_media');
    const dirigido = estrategia === 'LONG_PUT' ? -1 : 1;
    const f = [];
    if (estrategia === 'IRON_CONDOR') {
      f.push({ nombre: 'Neutralidad media de las señales', valor: redondear(neutralidad), puntaje: redondear(acotar((neutralidad ?? 0) * 100), 2) });
      for (const [core, etiqueta] of [['tecnico', 'Neutralidad de tendencia (técnico)'], ['indicadores', 'Neutralidad de momentum (indicadores)']]) {
        const sesgo = evaluaciones[core].sesgo;
        if (Number.isFinite(sesgo)) f.push({ nombre: etiqueta, valor: redondear(sesgo), puntaje: redondear((1 - Math.abs(sesgo)) * 100, 2) });
      }
      if (ivActual && hv20) f.push({ nombre: 'IV / volatilidad histórica 20d', valor: redondear(ivActual / hv20), puntaje: redondear(acotar(50 + ((ivActual / hv20 - 1) / confluencia.SENSIBILIDAD_IV_HV) * 50), 2) });
    } else {
      f.push({ nombre: 'Sesgo combinado', valor: redondear(s), puntaje: redondear(acotar(50 + 50 * s * dirigido), 2) });
      for (const [core, etiqueta] of [['tecnico', 'Tendencia (técnico)'], ['indicadores', 'Momentum (indicadores)']]) {
        const sesgo = evaluaciones[core].sesgo;
        if (Number.isFinite(sesgo)) f.push({ nombre: etiqueta, valor: redondear(sesgo), puntaje: redondear(acotar(50 + 50 * sesgo * dirigido), 2) });
      }
    }
    f.push({ nombre: 'Acuerdo entre señales', valor: redondear(acuerdo), puntaje: redondear(acotar(acuerdo * 100), 2) });
    f.push({ nombre: 'Confianza', valor: redondear(r.confianza), puntaje: redondear(acotar(r.confianza * 100), 2) });
    factores[estrategia] = f;
    resumenes[estrategia] = estrategia === 'IRON_CONDOR'
      ? `Neutralidad ${Math.round((neutralidad ?? 0) * 100)}/100${ivActual && hv20 ? `, IV/HV20 ${(ivActual / hv20).toFixed(2)}` : ''}, acuerdo ${pct(acuerdo)}.`
      : `Sesgo ${direccion(s)} (${s.toFixed(2)}), acuerdo entre señales ${pct(acuerdo)}, confianza ${pct(r.confianza)}.`;
  }
  return { puntajes, factores, resumenes, ivActual: ivActual ?? null, hv20: hv20 ?? null };
}

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
          factores: (r.factores?.[e] || []).map(({ nombre, valor, puntaje }) => ({ nombre, valor: valor ?? null, puntaje })), resumen: r.resumenes?.[e] || '', actualizadoEn: r.actualizadoEn }));
      const ultima = registros.reduce((m, r) => (r.actualizadoEn && (!m || new Date(r.actualizadoEn) > new Date(m)) ? r.actualizadoEn : m), null);
      const resumenUniverso = { total: registros.length, actualizadoEn: ultima, ...(universo ? universo.estado() : {}) };
      if (estrategia) return { items: top(estrategia), universo: resumenUniverso };
      return { estrategias: Object.fromEntries(ESTRATEGIAS.map(e => [e, top(e)])), universo: resumenUniverso };
    },
  };
}
