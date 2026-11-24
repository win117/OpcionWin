// Lógica de la canalización: sincronización → cores → selección. Sin dependencias de React.
import { api } from '../../api/client';
import { acciones, empresas, jobPaths, sincronizaciones } from '../../api/resources';
import { CORES, CORE_LABELS, RECURSO_LABELS } from '../../utils/constants';
import { recursosAlDia } from '../../utils/analisis';
import { fmtNum, isNum } from '../../utils/format';

// Recursos de datos que puede sincronizar la canalización (la empresa se registra siempre).
export const RECURSOS = ['historicos', 'cotizaciones', 'noticias', 'fundamentales', 'contratos'];

// REQUIERE de cada core (catálogo /cores/catalogo) → recursos de sincronización. «x?» = dato opcional.
// 'reportes' (13F) solo se descarga si el usuario lo pide: es lento.
const REQUISITO_A_RECURSOS = {
  velas: ['historicos', 'cotizaciones'],
  'opciones?': ['contratos'],
  opciones: ['contratos'],
  fundamentales: ['fundamentales'],
  noticias: ['noticias'],
  reportes: ['institucional'],
};
// Respaldo si el catálogo no está disponible (refleja REQUIERE de src/cores/*.core.js).
const REQUIERE_RESPALDO = {
  tecnico: ['velas'], indicadores: ['velas', 'opciones?'], fundamental: ['fundamentales'], institucional: ['reportes'], noticias: ['noticias'],
};

/**
 * Recursos a sincronizar para los cores activos: solo los que piden esos cores según `requiere` del catálogo.
 * - Un core apagado no aporta recursos.
 * - institucional (13F) solo si el core está activo Y `config.institucional`.
 * - contratos: los pide indicadores (IV, opcional) o la opción `config.contratos` (strikes sugeridos).
 * - `base`: añade velas y cotización (datos mínimos para mostrar la gráfica de una empresa nueva).
 * Devuelve la lista ordenada de recursos (sin 'empresas').
 */
export function recursosNecesarios(coresActivos, catalogo, { institucional = false, contratos = false, base = false } = {}) {
  const set = new Set(base ? ['historicos', 'cotizaciones'] : []);
  for (const core of coresActivos) {
    const requiere = catalogo?.find(x => x.core === core)?.requiere || REQUIERE_RESPALDO[core] || [];
    for (const req of requiere) for (const r of REQUISITO_A_RECURSOS[req] || []) set.add(r);
  }
  if (contratos) set.add('contratos');
  if (!institucional) set.delete('institucional');
  return [...RECURSOS, 'institucional'].filter(r => set.has(r));
}
const ESPERA_MS = [400, 700, 1000, 1500]; // las primeras consultas son más seguidas: muchos trabajos terminan en menos de un segundo
const CLAVE = 'opciones.analizar.config.v1', VERSION_CONFIG = 2;
const pausa = ms => new Promise(r => setTimeout(r, ms));

export const configPorDefecto = () => ({
  cores: Object.fromEntries(CORES.map(c => [c, { on: true, peso: 1 }])),
  excluidas: {}, // core → nombres de señales desmarcadas (lo nuevo queda marcado por defecto)
  institucional: true, // 13F: forma parte de los cinco factores que deciden
  contratos: true, // traer contratos de opciones (strikes, vencimientos y griegas de las estrategias sugeridas)
  sincronizar: true,
  diasMin: 7,
  diasMax: 60,
});

const diasOk = v => Number.isInteger(v) && v >= 0 && v <= 730;
/** Mensaje de error del rango de días a vencimiento, o null si es válido. */
export function errorRangoDias({ diasMin, diasMax }) {
  if (!diasOk(diasMin) || !diasOk(diasMax)) return 'Los días a vencimiento deben ser enteros entre 0 y 730.';
  if (diasMin > diasMax) return 'El mínimo de días no puede ser mayor que el máximo.';
  return null;
}

export function leerConfig() {
  const base = configPorDefecto();
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (!g || typeof g !== 'object') return base;
    for (const c of CORES) {
      if (g.cores?.[c]) base.cores[c] = { on: g.cores[c].on !== false, peso: isNum(g.cores[c].peso) ? Math.min(5, Math.max(0, g.cores[c].peso)) : 1 };
    }
    base.excluidas = g.excluidas && typeof g.excluidas === 'object' ? g.excluidas : {};
    // Antes venía apagado por lento; las preferencias guardadas entonces no expresan una decisión.
    base.institucional = g.v === VERSION_CONFIG ? Boolean(g.institucional) : true;
    base.contratos = g.contratos !== false;
    base.sincronizar = g.sincronizar !== false;
    if (!errorRangoDias(g)) { base.diasMin = g.diasMin; base.diasMax = g.diasMax; }
  } catch { /* sin almacenamiento */ }
  return base;
}

export function guardarConfig(config) {
  try { localStorage.setItem(CLAVE, JSON.stringify({ ...config, v: VERSION_CONFIG })); } catch { /* sin almacenamiento */ }
}

/** Resuelve la configuración contra el catálogo: cores activos, señales elegidas (null = todas), recursos a sincronizar y ponderaciones. */
export function resolverConfig(config, catalogo) {
  const cores = CORES.filter(c => config.cores[c]?.on && config.cores[c].peso > 0);
  let indicadores = null;
  if (catalogo?.length) {
    const sel = [];
    let todas = true;
    for (const core of cores) {
      const senales = catalogo.find(x => x.core === core)?.senales || [];
      const ex = new Set(config.excluidas[core] || []);
      for (const s of senales) {
        if (ex.has(s.nombre)) todas = false; else sel.push(s.nombre);
      }
    }
    if (!todas) indicadores = sel;
  }
  const recursos = recursosNecesarios(cores, catalogo, { institucional: config.institucional, contratos: config.contratos });
  return { cores, indicadores, recursos, ponderaciones: cores.map(core => ({ core, peso: config.cores[core].peso })) };
}

export async function esperar(path, cancelado) {
  for (let i = 0; ; i++) {
    const d = await api.get(path);
    if (['completada', 'fallida'].includes(d?.estado)) return d;
    if (cancelado()) throw new Error('Cancelado');
    await pausa(ESPERA_MS[Math.min(i, ESPERA_MS.length - 1)]);
  }
}

export function pasosDatos(recursos) {
  return [
    { id: 'sync:empresas', grupo: 'Datos', label: 'Empresa (Alpaca + SEC)' },
    ...recursos.map(r => ({ id: 'sync:' + r, grupo: 'Datos', label: RECURSO_LABELS[r] })),
  ].map(p => ({ ...p, estado: 'pendiente' }));
}

export function pasosIniciales({ sincronizar, recursos, cores }) {
  return [
    ...(sincronizar ? pasosDatos(recursos) : []),
    ...cores.map(c => ({ id: 'core:' + c, grupo: 'Factores', label: CORE_LABELS[c], estado: 'pendiente' })),
    { id: 'seleccion', grupo: 'Selección', label: 'Compatibilidad por estrategia', estado: 'pendiente' },
  ];
}

function crearPaso(setPasos, cancelado) {
  const set = (id, cambios) => setPasos(p => p.map(x => (x.id === id ? { ...x, ...cambios } : x)));
  const paso = async (id, lanzar, ruta) => {
    set(id, { estado: 'procesando' });
    const t0 = Date.now();
    try {
      const r = await lanzar();
      const fin = await esperar(ruta(r), cancelado);
      const detalle = fin.procesados != null ? fmtNum(fin.procesados, 0) + ' registros' : isNum(fin.puntaje) ? 'puntaje ' + fmtNum(fin.puntaje, 0) : '';
      set(id, { estado: fin.estado, detalle, error: fin.error, ms: Date.now() - t0 });
      return fin;
    } catch (error) {
      set(id, { estado: 'fallida', error: error.message, ms: Date.now() - t0 });
      return null;
    }
  };
  return { set, paso };
}

/**
 * Solo la parte de datos: registra la empresa y sincroniza únicamente `recursos`. Devuelve los trabajos por recurso.
 * Con `saltarRecientes` no se repite lo sincronizado sin fallos en los últimos 10 minutos.
 */
export async function sincronizarDatos(simbolo, { recursos = [], diasMin, diasMax, saltarRecientes = false }, setPasos, cancelado) {
  const { set, paso } = crearPaso(setPasos, cancelado);
  const alDia = saltarRecientes
    ? recursosAlDia((await sincronizaciones.list({ estado: 'completada', limit: 100 }).catch(() => null))?.items || [], simbolo, { diasMin, diasMax })
    : new Map();
  const rango = isNum(diasMin) && isNum(diasMax) ? { diasVencimientoMin: diasMin, diasVencimientoMax: diasMax } : {};
  const omitir = recurso => {
    const min = alDia.get(recurso);
    set('sync:' + recurso, { estado: 'omitida', detalle: min < 1 ? 'al día, hace menos de 1 min' : `al día, hace ${min} min` });
    return { estado: 'completada' };
  };
  const sync = recurso => (alDia.has(recurso) ? omitir(recurso) : paso('sync:' + recurso, () => acciones.sincronizar({ recurso, simbolos: [simbolo], ...(recurso === 'contratos' ? rango : {}) }), r => jobPaths.sincronizacion(r._id)));
  const emp = await sync('empresas');
  if (emp?.estado !== 'completada') throw new Error(emp?.error || 'No se pudo registrar el símbolo (¿existe en Alpaca?).');
  const jobs = await Promise.all(recursos.map(async r => [r, await sync(r)]));
  return Object.fromEntries(jobs);
}

/** Canalización completa según la configuración resuelta. Devuelve el trabajo de la selección (null si falló). */
export async function ejecutarFlujo(simbolo, { sincronizar, recursos, cores, indicadores, ponderaciones, diasMin, diasMax }, setPasos, cancelado) {
  const { set, paso } = crearPaso(setPasos, cancelado);
  if (sincronizar) await sincronizarDatos(simbolo, { recursos, diasMin, diasMax, saltarRecientes: true }, setPasos, cancelado);

  const empresa = (await empresas.list({ simbolo, limit: 1 })).items[0];
  if (!empresa) throw new Error('Empresa no encontrada. Trae sus datos primero.');
  // Un factor activo sin datos también se envía: así la cobertura dice la verdad (4 de 5) en vez de ocultar que falta.
  const activos = cores;
  if (!activos.length) throw new Error('Activa al menos un factor para analizar.');

  // El rango de días del usuario limita los contratos que entran en iv_promedio (evaluaciones y selección).
  const parametros = { ...(indicadores ? { indicadores } : {}), ...(isNum(diasMin) && isNum(diasMax) ? { diasVencimientoMin: diasMin, diasVencimientoMax: diasMax } : {}) };
  await Promise.all(activos.map(core => paso('core:' + core,
    () => acciones.evaluarCore(core, { empresaId: empresa._id, parametros }), r => jobPaths.evaluacionCore(core, r._id))));

  return paso('seleccion', () => acciones.seleccionar({
    modo: 'empresa',
    empresaId: empresa._id,
    coresSeleccionados: activos,
    filtros: parametros,
    ponderaciones: ponderaciones.filter(p => activos.includes(p.core)),
  }), r => jobPaths.seleccion(r._id));
}
