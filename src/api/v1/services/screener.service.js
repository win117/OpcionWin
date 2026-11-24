// Screener: puntaje por estrategia para un universo de símbolos, guardado de forma compacta (recurso `screener`).
// El ranking se lee de lo guardado (sin llamar a proveedores); un trabajo de fondo refresca el universo por lotes.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { cores, confluencia } from '../../../cores';
import { ESTRATEGIAS } from '../models/shared';
import { UNIVERSO_DEFECTO } from '../../../data/universo';
import { todos, idDeterminista, guardarLote, parchar, obtener } from './registros';
import { iniciarTrabajo } from './trabajos.service';
import { reconciliarTrabajo } from './trabajos-huerfanos.service';

export const VERSION = 'screener@1.0.0';
const DIA = 86400000;
const SIMBOLO = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const CORES_SCREENER = ['tecnico', 'indicadores'];
const LOTE_BARRAS = 40; // 40 símbolos × ~275 velas ≈ una página de 10 000 barras
const LOTE_SNAPSHOTS = 100;
const MIN_VELAS = 30;

const redondear = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const acotar = (x, min = 0, max = 100) => Math.min(max, Math.max(min, x));
const metrica = (r, nombre) => r?.metricas?.find(m => m.nombre === nombre)?.valor;

// "AAPL251219C00200000" → { tipo, strike, vencimiento } (símbolo OCC).
export function parsearOcc(simbolo) {
  const m = /^[A-Z0-9.]{1,6}(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(simbolo));
  return m ? { tipo: m[4] === 'C' ? 'call' : 'put', strike: Number(m[5]) / 1000, vencimiento: `20${m[1]}-${m[2]}-${m[3]}` } : null;
}

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

export function createScreener({ integraciones, factory = repository, cola, ahora = () => new Date(), concurrenciaOpciones = 4, pausaMs = 0 } = {}) {
  const reloj = () => { const v = ahora(); return v instanceof Date ? v : new Date(v); };
  const dormir = ms => (ms ? new Promise(r => { setTimeout(r, ms); }) : Promise.resolve());

  // Mapa con concurrencia limitada (cada tarea que falla devuelve null).
  async function mapear(items, concurrencia, fn) {
    const salida = new Array(items.length).fill(null);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, async () => {
      while (i < items.length) { const k = i++; salida[k] = await fn(items[k]).catch(() => null); }
    }));
    return salida;
  }

  // IV de contratos cerca del dinero (±5 %) a 20-50 días; una sola página, para acotar solicitudes.
  async function ivOpciones(alpaca, simbolo, precio, hoy) {
    if (!(precio > 0)) return [];
    const dia = n => new Date(hoy.getTime() + n * DIA).toISOString().slice(0, 10);
    const snaps = await alpaca.snapshotsOpciones(simbolo, { vencimientoDesde: dia(20), vencimientoHasta: dia(50), strikeMin: redondear(precio * 0.95, 2), strikeMax: redondear(precio * 1.05, 2), limite: 200, paginas: 1 });
    return snaps.map(s => ({ ...parsearOcc(s.contratoExternoId), bid: s.bid, ask: s.ask, volatilidadImplicita: s.volatilidadImplicita, griegas: s.griegas })).filter(o => o.tipo && o.strike);
  }

  async function ejecutar(ctx, registro) {
    const alpaca = integraciones.alpaca;
    const simbolos = registro.simbolos || [];
    const conOpciones = registro.proveedor !== 'alpaca-sin-opciones';
    const hoy = reloj();
    const nombres = new Map((await alpaca.listarActivos().catch(() => [])).map(a => [String(a.simbolo).toUpperCase(), a.nombre]));
    let procesados = 0, fallidos = 0;
    for (let i = 0; i < simbolos.length; i += LOTE_BARRAS) {
      const lote = simbolos.slice(i, i + LOTE_BARRAS);
      const velas = await alpaca.velasLote(lote, { desde: new Date(hoy.getTime() - 400 * DIA).toISOString(), hasta: hoy.toISOString() });
      const snaps = {};
      for (let k = 0; k < lote.length; k += LOTE_SNAPSHOTS) Object.assign(snaps, await alpaca.cotizacionesLote(lote.slice(k, k + LOTE_SNAPSHOTS)).catch(() => ({})));
      const validos = lote.filter(s => (velas[s]?.length || 0) >= MIN_VELAS);
      fallidos += lote.length - validos.length;
      const precios = new Map(validos.map(s => [s, snaps[s]?.ultimo ?? velas[s].at(-1).cierre]));
      const opciones = conOpciones ? await mapear(validos, concurrenciaOpciones, s => ivOpciones(alpaca, s, precios.get(s), hoy)) : [];
      const items = [];
      validos.forEach((s, k) => {
        try {
          const v = velas[s], precio = precios.get(s);
          const previo = snaps[s]?.cierreAnterior ?? v.at(-2)?.cierre;
          const p = puntuarSimbolo({ simbolo: s, velas: v, opciones: opciones[k] || [], fechaReferencia: hoy.toISOString() });
          const vols = v.slice(-20).map(x => x.volumen).filter(Number.isFinite);
          items.push({ id: idDeterminista('screener', s), datos: {
            simbolo: s, nombre: nombres.get(s) || s, precio: redondear(precio, 4), cambioPct: previo > 0 ? redondear(precio / previo - 1, 6) : null,
            volumenPromedio: vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null, ivPromedio: redondear(p.ivActual, 4),
            puntajes: p.puntajes, factores: p.factores, resumenes: p.resumenes, versionAlgoritmo: VERSION, actualizadoEn: hoy,
          } });
        } catch { fallidos += 1; }
      });
      await guardarLote('screener', ctx, items, factory);
      procesados += lote.length;
      await parchar('sincronizaciones', ctx, registro._id, { procesados, fallidos }, factory);
      await dormir(pausaMs);
    }
    return { procesados, fallidos };
  }

  const vista = r => ({ _id: r._id, estado: r.estado, procesados: r.procesados ?? 0, total: r.total ?? 0, fallidos: r.fallidos ?? 0, ...(r.error ? { error: r.error } : {}), ...(r.finalizadaEn ? { finalizadaEn: r.finalizadaEn } : {}), createdAt: r.createdAt });

  return {
    ejecutar,
    async iniciarSincronizacion(ctx, body = {}) {
      let simbolos;
      if (body.simbolos !== undefined) {
        if (!Array.isArray(body.simbolos) || !body.simbolos.length) throw boom.badRequest('simbolos: arreglo no vacío de símbolos.');
        simbolos = [...new Set(body.simbolos.map(s => String(s).trim().toUpperCase()))];
        if (simbolos.length > 1000 || simbolos.some(s => !SIMBOLO.test(s))) throw boom.badRequest('simbolos: hasta 1000 símbolos válidos.');
      } else {
        const limite = body.limite === undefined ? 500 : Number(body.limite);
        if (!Number.isSafeInteger(limite) || limite < 1 || limite > 1000) throw boom.badRequest('limite debe ser un entero entre 1 y 1000.');
        simbolos = UNIVERSO_DEFECTO.slice(0, limite);
      }
      // Una sola sincronización de universo a la vez por usuario: se devuelve la activa.
      for (const previo of await todos('sincronizaciones', ctx, { recurso: 'universo' }, factory)) {
        if (['pendiente', 'procesando'].includes(previo.estado) && cola?.activo?.(previo._id)) return vista(previo);
      }
      const datos = { recurso: 'universo', proveedor: body.opciones === false ? 'alpaca-sin-opciones' : 'alpaca', simbolos, total: simbolos.length };
      return vista(await iniciarTrabajo({ name: 'sincronizaciones', ctx, datos, cola, factory, ejecutar: r => ejecutar(ctx, r) }));
    },
    async obtenerSincronizacion(ctx, id) {
      let r;
      try { r = await obtener('sincronizaciones', ctx, id, factory); } catch { throw boom.notFound('Sincronización no encontrada.'); }
      if (r.recurso !== 'universo') throw boom.notFound('Sincronización no encontrada.');
      return vista(await reconciliarTrabajo('sincronizaciones', ctx, r, { factory, cola }));
    },
    async ranking(ctx, { estrategia, limite = 5 } = {}) {
      if (estrategia !== undefined && !ESTRATEGIAS.includes(estrategia)) throw boom.badRequest('estrategia: ' + ESTRATEGIAS.join(', ') + '.');
      const n = Number(limite);
      if (!Number.isSafeInteger(n) || n < 1 || n > 50) throw boom.badRequest('limite debe estar entre 1 y 50.');
      const registros = await todos('screener', ctx, undefined, factory);
      const top = e => registros.filter(r => Number.isFinite(r.puntajes?.[e]))
        .sort((a, b) => b.puntajes[e] - a.puntajes[e] || a.simbolo.localeCompare(b.simbolo)).slice(0, n)
        .map(r => ({ simbolo: r.simbolo, nombre: r.nombre || r.simbolo, precio: r.precio ?? null, cambioPct: r.cambioPct ?? null, puntaje: r.puntajes[e],
          factores: (r.factores?.[e] || []).map(({ nombre, valor, puntaje }) => ({ nombre, valor: valor ?? null, puntaje })), resumen: r.resumenes?.[e] || '', actualizadoEn: r.actualizadoEn }));
      const ultima = registros.reduce((m, r) => (r.actualizadoEn && (!m || new Date(r.actualizadoEn) > new Date(m)) ? r.actualizadoEn : m), null);
      const universo = { total: registros.length, actualizadoEn: ultima };
      if (estrategia) return { items: top(estrategia), universo };
      return { estrategias: Object.fromEntries(ESTRATEGIAS.map(e => [e, top(e)])), universo };
    },
  };
}
