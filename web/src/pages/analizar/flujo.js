// Lógica de la canalización: sincronización → cores → selección. Sin dependencias de React.
import { api } from '../../api/client';
import { acciones, empresas, jobPaths, mercado } from '../../api/resources';
import { CORES, CORE_LABELS, RECURSO_LABELS } from '../../utils/constants';
import { fmtNum, isNum } from '../../utils/format';

export const RECURSOS = ['historicos', 'cotizaciones', 'noticias', 'fundamentales', 'contratos'];
const ESPERA_MS = 1500;
const CLAVE = 'opciones.analizar.config.v1';
const pausa = ms => new Promise(r => setTimeout(r, ms));

export const configPorDefecto = () => ({
  cores: Object.fromEntries(CORES.map(c => [c, { on: true, peso: 1 }])),
  excluidas: {}, // core → nombres de señales desmarcadas (lo nuevo queda marcado por defecto)
  institucional: false,
  sincronizar: true,
});

export function leerConfig() {
  const base = configPorDefecto();
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (!g || typeof g !== 'object') return base;
    for (const c of CORES) {
      if (g.cores?.[c]) base.cores[c] = { on: g.cores[c].on !== false, peso: isNum(g.cores[c].peso) ? Math.min(5, Math.max(0, g.cores[c].peso)) : 1 };
    }
    base.excluidas = g.excluidas && typeof g.excluidas === 'object' ? g.excluidas : {};
    base.institucional = Boolean(g.institucional);
    base.sincronizar = g.sincronizar !== false;
  } catch { /* sin almacenamiento */ }
  return base;
}

export function guardarConfig(config) {
  try { localStorage.setItem(CLAVE, JSON.stringify(config)); } catch { /* sin almacenamiento */ }
}

/** Resuelve la configuración contra el catálogo: cores activos, señales elegidas (null = todas) y ponderaciones. */
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
  return { cores, indicadores, ponderaciones: cores.map(core => ({ core, peso: config.cores[core].peso })) };
}

export async function esperar(path, cancelado) {
  for (;;) {
    const d = await api.get(path);
    if (['completada', 'fallida'].includes(d?.estado)) return d;
    if (cancelado()) throw new Error('Cancelado');
    await pausa(ESPERA_MS);
  }
}

export function pasosDatos(institucional) {
  return [
    { id: 'sync:empresas', grupo: 'Datos', label: 'Empresa (Alpaca + SEC)' },
    ...[...RECURSOS, ...(institucional ? ['institucional'] : [])].map(r => ({ id: 'sync:' + r, grupo: 'Datos', label: RECURSO_LABELS[r] })),
  ].map(p => ({ ...p, estado: 'pendiente' }));
}

export function pasosIniciales({ sincronizar, institucional, cores }) {
  return [
    ...(sincronizar ? pasosDatos(institucional) : []),
    ...cores.map(c => ({ id: 'core:' + c, grupo: 'Cores', label: CORE_LABELS[c], estado: 'pendiente' })),
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

/** Solo la parte de datos. Devuelve los trabajos de sincronización de recursos. */
export async function sincronizarDatos(simbolo, { institucional = false }, setPasos, cancelado) {
  const { paso } = crearPaso(setPasos, cancelado);
  const sync = recurso => paso('sync:' + recurso, () => acciones.sincronizar({ recurso, simbolos: [simbolo] }), r => jobPaths.sincronizacion(r._id));
  const emp = await sync('empresas');
  if (emp?.estado !== 'completada') throw new Error(emp?.error || 'No se pudo registrar el símbolo (¿existe en Alpaca?).');
  const recursos = [...RECURSOS, ...(institucional ? ['institucional'] : [])];
  return Promise.all(recursos.map(sync));
}

/** Canalización completa según la configuración resuelta. */
export async function ejecutarFlujo(simbolo, { sincronizar, institucional, cores, indicadores, ponderaciones }, setPasos, cancelado) {
  const { set, paso } = crearPaso(setPasos, cancelado);
  let syncs = [];
  if (sincronizar) syncs = await sincronizarDatos(simbolo, { institucional }, setPasos, cancelado);

  const empresa = (await empresas.list({ simbolo, limit: 1 })).items[0];
  if (!empresa) throw new Error('Empresa no encontrada. Trae sus datos primero.');
  let hay13F = true;
  if (cores.includes('institucional')) {
    hay13F = (institucional && syncs.at(-1)?.procesados > 0)
      || (await mercado.institucional(simbolo, { limit: 1 }).catch(() => null))?.total > 0;
  }
  const activos = cores.filter(c => c !== 'institucional' || hay13F);
  if (activos.length < cores.length) set('core:institucional', { estado: 'omitida', detalle: 'sin datos 13F' });
  if (!activos.length) throw new Error('No hay cores con datos para evaluar.');

  const parametros = indicadores ? { parametros: { indicadores } } : {};
  await Promise.all(activos.map(core => paso('core:' + core,
    () => acciones.evaluarCore(core, { empresaId: empresa._id, ...parametros }), r => jobPaths.evaluacionCore(core, r._id))));

  await paso('seleccion', () => acciones.seleccionar({
    modo: 'empresa',
    empresaId: empresa._id,
    coresSeleccionados: activos,
    ...(indicadores ? { filtros: { indicadores } } : {}),
    ponderaciones: ponderaciones.filter(p => activos.includes(p.core)),
  }), r => jobPaths.seleccion(r._id));
}
