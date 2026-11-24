// Universo vivo: mapa del mercado y puntajes por estrategia, en memoria y compartidos por todos los usuarios (son datos de
// mercado, no del usuario). Nadie tiene que pulsar nada: src/index.js lo inicia al arrancar el servidor.
//
// 0) Catálogo: qué empresas hay (catalogo-universo.service.js; todo obtenido de Alpaca y la SEC). Se rehace cada 24 h.
// 1) Cotizaciones (mapa): por lotes de 100. Se piden solo si alguien mira y vence la caché.
// 2) Puntajes: velas por lotes → técnico e indicadores de todas en segundos. El ranking es «preliminar» hasta que opinan los cinco.
// 3) En segundo plano, sin filtrar empresas y cada dato a su ritmo (por orden de capitalización; lo avanzado se guarda):
//    - Alpaca: volatilidad implícita (2 h) y noticias (1 h con el mercado abierto, 6 h cerrado).
//    - SEC: perfil (giro), fundamentales (3 días) e institucional 13F (7 días; una sola lectura masiva para todas).
// El resultado se guarda con un propietario interno para que un reinicio muestre algo al instante.
import boom from '@hapi/boom';
import { combinarCores, conReintento, coresDeFila, evaluarCore, evaluarPrecio, parsearOcc, VERSION } from './screener.service';
import { createCatalogo } from './catalogo-universo.service';
import { createMercadoReloj, diaNY } from './mercado-reloj.service';
import { validated } from './crud.service';
import { CORES, ESTRATEGIAS } from '../models/shared';
import { guardarLote, idDeterminista, todos } from './registros';

const DIA = 86400000, MIN = 60000;
export const PROPIETARIO_SISTEMA = 'sistema-universo';
const LOTE_COTIZACIONES = 100;
const LOTE_VELAS = 40;
const MIN_VELAS = 30;
const DIAS_VELAS = 400;
// El plan gratuito solo entrega el consolidado (SIP) con más de 15 minutos de antigüedad.
const RETRASO_SIP_MS = 16 * MIN;
// Un símbolo sin operaciones en 7 días dejó de cotizar: no se muestra ni se recomienda.
const MAX_DIAS_SIN_OPERAR = 7;
export const TTL_ABIERTO_MS = 10000;
export const TTL_CERRADO_MS = MIN;
export const REPUNTUAR_ABIERTO_MS = 15 * MIN;
export const REPUNTUAR_CERRADO_MS = 6 * 60 * MIN;
// 800 ms entre solicitudes = 75/min: deja más de la mitad del cupo de Alpaca (200/min) para el mapa y lo que hagan los usuarios.
export const RITMO_IV_MS = 800;
const IV_VIGENTE_MS = 2 * 60 * MIN;
// Cada cuánto se vuelve a evaluar cada core lento (los reportes financieros y 13F son trimestrales).
export const VIGENCIA_CORE_MS = { noticias: 60 * MIN, noticiasCerrado: 6 * 60 * MIN, fundamental: 3 * DIA, institucional: 7 * DIA };
const DIAS_NOTICIAS = 14, MAX_NOTICIAS = 50; // lo mismo que sincroniza Análisis
export const RITMO_SEC_MS = 700;
const GUARDAR_CADA = 100; // empresas
// Tras un fallo del proveedor en un core lento se espera antes de insistir.
const ESPERA_LENTAS_MS = 15 * MIN;
// Si el catálogo falla se reintenta a 1, 2, 4… hasta 30 minutos.
export const ESPERA_CATALOGO_MIN_MS = MIN;
export const ESPERA_CATALOGO_MAX_MS = 30 * MIN;
const STRIKES_CERCANOS = 2; // por vencimiento y tipo
const MAX_MOVIMIENTOS = 10;

const redondear = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const variacion = (velas, n) => {
  const a = velas.at(-1 - n)?.cierre, b = velas.at(-1)?.cierre;
  return a > 0 && Number.isFinite(b) ? redondear(b / a - 1, 6) : null;
};
const lotes = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n));
const pausa = ms => new Promise(r => { setTimeout(r, ms); });
const nombreCorto = (nombre, simbolo) => String(nombre || simbolo).replace(/\s+(Class [A-Z] )?(Common Stock|Ordinary Shares?|Common Shares?|Capital Stock).*$/i, '').replace(/,?\s+Class [A-Z]$/i, '').trim() || simbolo;

/**
 * Precio y variación del día a partir de IEX (tiempo real, una sola bolsa) y del consolidado retrasado (cierre y volumen oficiales).
 * Con el mercado abierto manda la última operación de IEX; cerrado, el cierre oficial de la sesión.
 */
export function combinarCotizacion(iex, sip, { abierto, hoy }) {
  const base = sip || iex;
  if (!base) return null;
  const sesionHoy = base.fechaSesion ? diaNY(base.fechaSesion) === hoy : true;
  // En los primeros minutos el consolidado aún muestra la sesión de ayer: entonces su cierre ES el cierre anterior.
  const anterior = abierto && !sesionHoy ? base.cierre : base.cierreAnterior;
  const precio = abierto ? iex?.ultimo ?? base.ultimo ?? base.cierre : base.cierre ?? iex?.ultimo ?? null;
  const vigente = !abierto || sesionHoy;
  const extremo = (fn, x) => (!vigente || x == null ? null : abierto && precio != null ? fn(x, precio) : x);
  return {
    precio: redondear(precio), cierreAnterior: redondear(anterior),
    cambioPct: precio != null && anterior > 0 ? redondear(precio / anterior - 1, 6) : null,
    volumen: vigente ? base.volumen ?? null : null, apertura: vigente ? base.apertura ?? null : null,
    maximo: extremo(Math.max, base.maximo), minimo: extremo(Math.min, base.minimo),
    fechaDato: (abierto ? iex?.fechaDato : null) || base.fechaDato || null,
  };
}

/**
 * Opciones útiles para la volatilidad implícita: cotizadas hace menos de una sesión (la de hoy o, con el mercado abierto, la
 * anterior) y en el dinero (por vencimiento y tipo, los dos strikes más cercanos al precio: ahí la IV es más líquida y no la
 * distorsiona el sesgo de los strikes lejanos). Las sesiones salen de las propias velas, así que respetan los feriados.
 */
export function opcionesParaIv(opciones, { precio, velas, abierto, hoy }) {
  const sesiones = velas.map(v => diaNY(v.fecha)).filter(d => (abierto ? d < hoy : d <= hoy));
  const desde = sesiones.at(-1);
  const grupos = new Map();
  for (const o of opciones) {
    if (!desde || !o.fechaDato || diaNY(o.fechaDato) < desde || !(o.volatilidadImplicita > 0)) continue;
    const g = o.vencimiento + o.tipo;
    grupos.set(g, [...(grupos.get(g) || []), o]);
  }
  return [...grupos.values()].flatMap(g => g.sort((a, b) => Math.abs(a.strike - precio) - Math.abs(b.strike - precio)).slice(0, STRIKES_CERCANOS));
}

export function createUniversoVivo({ integraciones, factory, catalogo, tamano = 500, ahora = Date.now, ritmoIvMs = RITMO_IV_MS, ritmoSecMs = RITMO_SEC_MS, esperar = pausa, esperarLimite = pausa, bases = ['mongodb', 'supabase'] } = {}) {
  const alpaca = () => integraciones.alpaca;
  const reloj = createMercadoReloj({ integraciones, ahora });
  const fuente = catalogo || createCatalogo({ integraciones, ahora, tamano });
  const empresas = new Map(); // símbolo → { nombre, cik, acciones, capitalizacion, sector, industria, sic, porConfirmar }
  const puntajes = new Map(); // símbolo → fila del ranking
  const iv = new Map();       // símbolo → { t, opciones }
  const evals = new Map();    // símbolo → { core: resumen de su evaluación }
  let series = new Map();     // símbolo → velas de la última pasada
  let lentasPendiente = null, proximasLentas = 0, guardando = null, guardarOtraVez = false;
  const fichas = new Map();   // símbolo → { t, velas }
  const rechazadas = new Set(); // CIK que no son empresas con reportes trimestrales
  let recuperado = false, fase = 'sin_iniciar', error = null, puntuadoEn = null, catalogoEn = null, baseGuardado = null;
  let errorCatalogo = null, fallosCatalogo = 0, proximoCatalogo = 0;
  let cacheMapa = null, mapaPendiente = null, catalogoPendiente = null, pasadaPendiente = null, temporizador = null, activo = false;

  // Con el universo ya perfilado, una recién llegada se oculta hasta confirmar que es una empresa operativa (y no un fideicomiso).
  const visibles = () => {
    const lista = [...empresas.values()].filter(e => !e.porConfirmar), perfiladas = lista.filter(e => e.sic !== undefined);
    return (perfiladas.length >= tamano * 0.8 ? perfiladas : lista).slice(0, tamano);
  };
  const velasDe = lista => {
    const t = ahora(), desde = new Date(t - DIAS_VELAS * DIA).toISOString();
    // Consolidado (todas las bolsas); si el plan no lo permite, IEX.
    return alpaca().velasLote(lista, { desde, hasta: new Date(t - RETRASO_SIP_MS).toISOString(), feed: 'sip' })
      .catch(() => alpaca().velasLote(lista, { desde, hasta: new Date(t).toISOString() }));
  };

  // ---- Catálogo
  async function construirCatalogo() {
    const lista = (await fuente.construir()).filter(c => !rechazadas.has(c.cik));
    if (!lista.length) throw boom.serverUnavailable('No se obtuvo ninguna empresa de los proveedores.');
    const previas = new Map(empresas);
    empresas.clear();
    for (const c of lista) {
      const p = previas.get(c.simbolo) || {};
      const perfilado = p.sic !== undefined && p.cik === c.cik;
      empresas.set(c.simbolo, { ...c, nombre: nombreCorto(c.nombre, c.simbolo), porConfirmar: c.porConfirmar && !perfilado,
        sector: perfilado ? p.sector : 'Sin clasificar', industria: perfilado ? p.industria : 'Sin clasificar', ...(perfilado ? { sic: p.sic } : {}) });
    }
    catalogoEn = ahora();
    cacheMapa = null;
  }
  async function asegurarCatalogo() {
    const vencido = catalogoEn == null || ahora() - catalogoEn > DIA;
    if (!vencido) return;
    if (!catalogoPendiente) {
      if (ahora() < proximoCatalogo) { // en espera tras un fallo: no se insiste con los proveedores
        if (empresas.size) return;
        throw boom.serverUnavailable(errorCatalogo);
      }
      catalogoPendiente = construirCatalogo().then(() => { errorCatalogo = null; fallosCatalogo = 0; proximoCatalogo = 0; }, e => {
        errorCatalogo = 'No se pudo obtener el catálogo de empresas: ' + (e?.mensaje || e?.output?.payload?.message || 'error interno') + ' Se reintentará.';
        proximoCatalogo = ahora() + Math.min(ESPERA_CATALOGO_MAX_MS, ESPERA_CATALOGO_MIN_MS * 2 ** fallosCatalogo);
        fallosCatalogo += 1;
        console.error('[universo] catálogo:', e?.mensaje || e?.message);
        throw e;
      }).finally(() => { catalogoPendiente = null; });
    }
    // Si ya hay un catálogo (aunque sea de ayer), se usa mientras llega el nuevo.
    if (empresas.size) { catalogoPendiente.catch(() => {}); return; }
    await catalogoPendiente;
  }
  async function completarPerfiles(solo) {
    const porCik = new Map();
    for (const e of empresas.values()) if (e.sic === undefined && (!solo || solo.has(e.simbolo))) porCik.set(e.cik, [...(porCik.get(e.cik) || []), e.simbolo]);
    let seguidos = 0;
    for (const [cik, lista] of porCik) {
      if (!activo || seguidos >= 10) break;
      try {
        const p = await fuente.perfil(cik);
        seguidos = 0;
        for (const s of lista) {
          const e = empresas.get(s);
          if (!e) continue;
          if (!p.valida) { rechazadas.add(cik); empresas.delete(s); puntajes.delete(s); continue; }
          Object.assign(e, { sic: p.sic ?? null, sector: p.sector, industria: p.industria, porConfirmar: false });
          const m = cacheMapa?.porSimbolo.get(s);
          if (m) Object.assign(m, { sector: p.sector, industria: p.industria });
        }
      } catch { seguidos += 1; }
    }
  }

  // Antes de publicar el primer ranking se confirma que sus primeros lugares son empresas operativas.
  async function confirmarPrimeros() {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      const pendientes = new Set(ESTRATEGIAS.flatMap(e => [...puntajes.values()].filter(p => Number.isFinite(p.puntajes[e])).sort((a, b) => b.puntajes[e] - a.puntajes[e]).slice(0, 8).map(p => p.simbolo))
        .filter(x => empresas.has(x) && empresas.get(x).sic === undefined));
      if (!pendientes.size) return;
      await completarPerfiles(pendientes);
    }
  }

  // ---- Cotizaciones
  async function cotizar(lista, feed) {
    const partes = await Promise.all(lotes(lista, LOTE_COTIZACIONES).map(l => alpaca().cotizacionesLote(l, feed ? { feed } : {})));
    return Object.assign({}, ...partes);
  }
  async function refrescarMapa() {
    await asegurarCatalogo();
    const { abierto } = await reloj();
    const lista = visibles(), simbolos = lista.map(e => e.simbolo);
    const [iex, sip] = await Promise.all([cotizar(simbolos), cotizar(simbolos, 'delayed_sip').catch(() => ({}))]);
    const hoy = diaNY(ahora()), items = [];
    for (const e of lista) {
      const s = e.simbolo, fechaOperacion = iex[s]?.fechaDato || sip[s]?.fechaDato;
      if (fechaOperacion && ahora() - Date.parse(fechaOperacion) > MAX_DIAS_SIN_OPERAR * DIA) continue;
      const q = combinarCotizacion(iex[s], sip[s], { abierto, hoy });
      if (q?.precio == null) continue;
      items.push({ simbolo: s, nombre: e.nombre, sector: e.sector, industria: e.industria, ...q, capitalizacion: e.acciones ? Math.round(e.acciones * q.precio) : e.capitalizacion });
      const p = puntajes.get(s);
      if (p) { p.precio = q.precio; p.cambioPct = q.cambioPct; }
    }
    const t = ahora();
    cacheMapa = { expira: t + (abierto ? TTL_ABIERTO_MS : TTL_CERRADO_MS), abierto, actualizadoEn: new Date(t), items, porSimbolo: new Map(items.map(i => [i.simbolo, i])) };
    return cacheMapa;
  }
  // Una sola actualización a la vez; si falla, se sirve lo último conocido marcado como desactualizado.
  async function obtenerMapa() {
    if (cacheMapa && ahora() < cacheMapa.expira) return cacheMapa;
    if (!mapaPendiente) mapaPendiente = refrescarMapa().finally(() => { mapaPendiente = null; });
    try { return await mapaPendiente; } catch (e) {
      if (!cacheMapa) throw e;
      return { ...cacheMapa, desactualizado: true };
    }
  }

  // ---- Puntajes
  function puntuarFila(s, velas) {
    const q = cacheMapa?.porSimbolo.get(s), dato = iv.get(s);
    const opciones = dato ? opcionesParaIv(dato.opciones, { precio: q?.precio ?? velas.at(-1).cierre, velas, abierto: Boolean(cacheMapa?.abierto), hoy: diaNY(ahora()) }) : [];
    const p = evaluarPrecio({ simbolo: s, velas, opciones, fechaReferencia: new Date(ahora()).toISOString() });
    evals.set(s, { ...evals.get(s), ...p.evaluaciones });
    const r = { ...p, ...combinarCores(evals.get(s), p) };
    const vols = velas.slice(-20).map(v => v.volumen).filter(Number.isFinite);
    const anio = velas.slice(-252), esteAnio = new Date(ahora()).getUTCFullYear();
    const cierrePrevio = velas.filter(v => new Date(v.fecha).getUTCFullYear() < esteAnio).at(-1)?.cierre;
    puntajes.set(s, {
      simbolo: s, nombre: empresas.get(s)?.nombre || s, precio: q?.precio ?? redondear(velas.at(-1).cierre), cambioPct: q?.cambioPct ?? variacion(velas, 1),
      cambio5d: variacion(velas, 5), cambio21d: variacion(velas, 21), cambioAnio: cierrePrevio > 0 ? redondear(velas.at(-1).cierre / cierrePrevio - 1, 6) : null,
      maximo52: Math.max(...anio.map(v => v.maximo)), minimo52: Math.min(...anio.map(v => v.minimo)),
      volumenPromedio: vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null,
      ivPromedio: redondear(r.ivActual), hv20: redondear(r.hv20), puntajes: r.puntajes, factores: r.factores, resumenes: r.resumenes, cores: evals.get(s),
      versionAlgoritmo: VERSION, actualizadoEn: new Date(ahora()),
    });
  }
  // Incorpora la evaluación de un core lento y recalcula la combinación de la empresa.
  function anotarCore(s, core, evaluacion) {
    evals.set(s, { ...evals.get(s), [core]: evaluacion });
    const fila = puntajes.get(s);
    if (fila) Object.assign(fila, combinarCores(evals.get(s), { ivActual: fila.ivPromedio, hv20: fila.hv20 }), { cores: evals.get(s) });
  }
  async function traerIv(s, precio) {
    if (!(precio > 0)) return;
    const dia = n => new Date(ahora() + n * DIA).toISOString().slice(0, 10);
    const filtro = { vencimientoDesde: dia(20), vencimientoHasta: dia(50), strikeMin: redondear(precio * 0.95, 2), strikeMax: redondear(precio * 1.05, 2), limite: 200, paginas: 1 };
    const snaps = await conReintento(() => alpaca().snapshotsOpciones(s, filtro), { esperar: esperarLimite });
    iv.set(s, { t: ahora(), opciones: snaps.map(x => ({ ...parsearOcc(x.contratoExternoId), volatilidadImplicita: x.volatilidadImplicita, fechaDato: x.fechaDato })).filter(o => o.tipo && o.strike) });
  }
  async function completarIv() {
    const orden = [...series.keys()].filter(s => !(iv.get(s) && ahora() - iv.get(s).t < IV_VIGENTE_MS))
      .sort((a, b) => (puntajes.get(b)?.puntajes.IRON_CONDOR ?? 0) - (puntajes.get(a)?.puntajes.IRON_CONDOR ?? 0));
    let seguidos = 0;
    for (const s of orden) {
      if (!activo) return;
      if (!empresas.has(s)) continue;
      const inicio = Date.now();
      try { await traerIv(s, puntajes.get(s)?.precio); if (series.has(s)) puntuarFila(s, series.get(s)); seguidos = 0; } catch { seguidos += 1; }
      if (seguidos >= 10) { error = 'La volatilidad implícita no está disponible por ahora; el ranking usa solo precios.'; return; }
      await esperar(Math.max(0, ritmoIvMs - (Date.now() - inicio)));
    }
  }
  async function pasada() {
    error = null;
    if (!puntajes.size) fase = 'catalogo';
    await asegurarCatalogo();
    const mapa = await obtenerMapa();
    if (!puntajes.size) fase = 'puntuando';
    const nuevas = new Map();
    for (const lote of lotes(mapa.items.map(i => i.simbolo), LOTE_VELAS)) {
      const v = await velasDe(lote);
      for (const s of lote) {
        if ((v[s]?.length || 0) < MIN_VELAS) continue;
        try { puntuarFila(s, v[s]); nuevas.set(s, v[s]); } catch { /* sin datos suficientes: queda fuera del ranking */ }
      }
    }
    for (const s of [...puntajes.keys()]) if (!nuevas.has(s)) puntajes.delete(s);
    series = nuevas;
    await confirmarPrimeros();
    puntuadoEn = ahora();
    await guardar();
    lanzarLentas();
  }

  // ---- Cores lentos: todas las empresas, sin filtro previo.
  const vence = (s, core, ms) => { const e = evals.get(s)?.[core]; return !e || ahora() - new Date(e.actualizadoEn).getTime() > ms; };
  const vigenciaNoticias = () => (cacheMapa?.abierto ? VIGENCIA_CORE_MS.noticias : VIGENCIA_CORE_MS.noticiasCerrado);
  const pendientesDe = (core, ms) => visibles().map(e => e.simbolo).filter(s => puntajes.has(s) && vence(s, core, ms));
  const hayLentas = () => pendientesDe('noticias', vigenciaNoticias()).length + pendientesDe('fundamental', VIGENCIA_CORE_MS.fundamental).length + pendientesDe('institucional', VIGENCIA_CORE_MS.institucional).length > 0
    || [...puntajes.keys()].some(s => !iv.get(s) || ahora() - iv.get(s).t > IV_VIGENTE_MS);
  // Recorre las empresas pendientes de un core; `traer(empresa)` devuelve sus insumos. Sin datos del emisor (404) cuenta como evaluado.
  async function completarCore(core, ms, ritmo, traer) {
    let seguidos = 0, hechos = 0;
    for (const s of pendientesDe(core, ms)) {
      if (!activo) return;
      const e = empresas.get(s);
      if (!e) continue;
      const inicio = Date.now(), ref = new Date(ahora()).toISOString();
      try {
        const datos = await traer(e).catch(err => { if (err?.codigo === 'NO_ENCONTRADO') return {}; throw err; });
        anotarCore(s, core, evaluarCore(core, { simbolo: s, ...datos }, ref));
        seguidos = 0; hechos += 1;
        if (hechos % GUARDAR_CADA === 0) await guardar();
      } catch (err) {
        seguidos += 1;
        if (seguidos >= 5) { proximasLentas = ahora() + ESPERA_LENTAS_MS; throw err; }
      }
      await esperar(Math.max(0, ritmo - (Date.now() - inicio)));
    }
  }
  // Dos clases de la misma empresa comparten noticias: el proveedor suele etiquetar solo una.
  const clasesDe = e => [...empresas.values()].filter(x => x.cik === e.cik).map(x => x.simbolo);
  const noticiasDe = async e => ({ noticias: await conReintento(() => alpaca().noticias({ simbolos: clasesDe(e), desde: new Date(ahora() - DIAS_NOTICIAS * DIA).toISOString(), hasta: new Date(ahora()).toISOString(), limite: MAX_NOTICIAS }), { esperar: esperarLimite }) });
  const porCik = new Map(); // dos clases de la misma empresa comparten sus reportes
  const fundamentalesDe = async e => {
    if (!porCik.has(e.cik)) { porCik.clear(); porCik.set(e.cik, await integraciones.sec.fundamentales(e.cik)); }
    return { fundamentales: porCik.get(e.cik) };
  };
  async function completarInstitucional() {
    if (!pendientesDe('institucional', VIGENCIA_CORE_MS.institucional).length) return;
    await integraciones.sec.cargarTenencias13F();
    await completarCore('institucional', VIGENCIA_CORE_MS.institucional, 0, async e => ({ reportes: await integraciones.sec.tenencias13F({ nombreEmisor: e.nombre, cortes: 2, soloMasivo: true }) }));
  }
  async function lentas() {
    if (puntajes.size && fase !== 'error') fase = 'completando';
    const avisos = [];
    const paso = (nombre, fn) => fn().catch(e => { avisos.push(nombre); console.error('[universo]', nombre + ':', e?.mensaje || e?.message); });
    await Promise.all([
      // Primero lo que vota (noticias); la volatilidad solo ajusta el Iron Condor.
      paso('noticias', () => completarCore('noticias', vigenciaNoticias(), ritmoIvMs, noticiasDe)).then(() => paso('volatilidad', completarIv)),
      paso('perfiles', () => completarPerfiles().then(() => guardar()))
        .then(() => paso('institucional', completarInstitucional))
        .then(() => paso('fundamental', () => completarCore('fundamental', VIGENCIA_CORE_MS.fundamental, ritmoSecMs, fundamentalesDe))),
    ]);
    if (!activo) return;
    if (avisos.length) { proximasLentas = ahora() + ESPERA_LENTAS_MS; error ||= 'Faltan datos por un fallo del proveedor (' + avisos.join(', ') + '); se reintenta en unos minutos.'; }
    fase = 'lista';
    await guardar();
  }
  function lanzarLentas() {
    if (lentasPendiente || ahora() < proximasLentas) return lentasPendiente;
    lentasPendiente = lentas().finally(() => { lentasPendiente = null; });
    return lentasPendiente;
  }
  function lanzar() {
    if (!pasadaPendiente) {
      pasadaPendiente = pasada()
        .catch(e => { error = e?.mensaje || errorCatalogo || 'No se pudo calcular el ranking; se reintentará.'; fase = puntajes.size ? 'lista' : 'error'; })
        .finally(() => { pasadaPendiente = null; });
    }
    return pasadaPendiente;
  }
  async function revisar() {
    if (!activo) return;
    try {
      const { abierto } = await reloj();
      const edad = puntuadoEn == null ? Infinity : ahora() - puntuadoEn;
      if (edad > (abierto ? REPUNTUAR_ABIERTO_MS : REPUNTUAR_CERRADO_MS)) lanzar();
      else if (!pasadaPendiente && series.size && hayLentas()) lanzarLentas();
    } catch (e) {
      error = e?.mensaje || 'Proveedor no disponible; se reintentará.';
      if (!puntajes.size) fase = 'error';
    }
  }

  // ---- Persistencia (mejor esfuerzo): mismo recurso `screener`, propietario interno.
  const CAMPOS_EMPRESA = ['cik', 'sic', 'sector', 'industria', 'acciones', 'capitalizacion'];
  const describir = e => e?.mensaje || e?.output?.payload?.message || e?.code || e?.name || 'error';
  const candidatas = () => [...puntajes.values()].filter(p => empresas.get(p.simbolo)?.sic != null).map(p => { // solo empresas confirmadas
    const e = empresas.get(p.simbolo);
    return { id: idDeterminista(PROPIETARIO_SISTEMA, p.simbolo), datos: { ...p, ...Object.fromEntries(CAMPOS_EMPRESA.filter(c => e[c] != null).map(c => [c, e[c]])) } };
  });
  // Un guardado a la vez; si llega otro mientras tanto, se repite al final con lo más reciente.
  function guardar() {
    if (guardando) { guardarOtraVez = true; return guardando; }
    guardando = (async () => { do { guardarOtraVez = false; await escribir(); } while (guardarOtraVez && activo); })().finally(() => { guardando = null; });
    return guardando;
  }
  async function escribir() {
    if (!activo) return; // al apagarse no se reabre la conexión a la base
    const items = [];
    let descartadas = 0, motivo;
    // Cada fila se valida por separado: una defectuosa no impide guardar las demás.
    for (const item of candidatas()) {
      try { await validated('screener', { ...item.datos, usuarioId: PROPIETARIO_SISTEMA, _id: item.id }); items.push(item); } catch (e) {
        descartadas += 1;
        motivo ||= item.datos.simbolo + ': ' + describir(e);
      }
    }
    if (descartadas) console.error(`[universo] ${descartadas} fila(s) no se guardan. ${motivo}`);
    for (const database of baseGuardado ? [baseGuardado] : bases) {
      try { await guardarLote('screener', { userId: PROPIETARIO_SISTEMA, database }, items, factory); baseGuardado = database; return; } catch (e) { console.error('[universo] no se pudo guardar en', database + ':', describir(e)); }
    }
  }
  async function recuperar() {
    for (const database of bases) {
      try {
        const filas = await todos('screener', { userId: PROPIETARIO_SISTEMA, database }, undefined, factory);
        // Solo lo reciente: un resultado de hace días engañaría más de lo que ayuda.
        const recientes = filas.filter(f => ahora() - new Date(f.actualizadoEn).getTime() < 4 * DIA && f.cik && f.sic != null);
        if (!recientes.length) continue;
        for (const f of recientes.sort((a, b) => (b.capitalizacion ?? 0) - (a.capitalizacion ?? 0))) {
          if (empresas.has(f.simbolo)) continue;
          empresas.set(f.simbolo, { simbolo: f.simbolo, nombre: f.nombre, cik: f.cik, acciones: f.acciones ?? null, capitalizacion: f.capitalizacion ?? null,
            sector: f.sector || 'Sin clasificar', industria: f.industria || 'Sin clasificar', sic: f.sic, porConfirmar: false });
          if (f.cores) evals.set(f.simbolo, { ...f.cores, ...evals.get(f.simbolo) });
          if (!puntajes.has(f.simbolo)) puntajes.set(f.simbolo, f);
        }
        baseGuardado = database;
        recuperado = true;
        if (puntuadoEn == null) fase = 'lista'; // hay un ranking que mostrar mientras se calcula el nuevo
        return;
      } catch (e) { console.error('[universo] no se pudo leer de', database + ':', describir(e)); }
    }
  }

  return {
    iniciar() {
      if (activo || alpaca()?.configurado === false) return;
      activo = true;
      fase = 'catalogo';
      recuperar().then(revisar);
      temporizador = setInterval(revisar, MIN);
      temporizador.unref?.();
    },
    detener() { activo = false; clearInterval(temporizador); },
    listo: () => puntajes.size > 0 && (puntuadoEn != null || recuperado),
    filas: () => [...puntajes.values()].filter(p => empresas.has(p.simbolo)),
    async simbolos() { await asegurarCatalogo(); return visibles().map(e => e.simbolo); },
    estado: () => ({
      automatico: activo, fase,
      // Cuántas empresas tienen ya evaluado cada core, y cuántas los cinco.
      porCore: Object.fromEntries(CORES.map(c => [c, [...puntajes.keys()].filter(s => empresas.has(s) && evals.get(s)?.[c]).length])),
      completas: [...puntajes.keys()].filter(s => empresas.has(s) && CORES.every(c => evals.get(s)?.[c])).length,
      conIv: [...puntajes.values()].filter(p => p.ivPromedio != null).length,
      catalogo: { actualizadoEn: catalogoEn == null ? null : new Date(catalogoEn), ...(errorCatalogo ? { error: errorCatalogo, proximoIntento: new Date(proximoCatalogo) } : {}) },
      ...(error || errorCatalogo ? { aviso: error || errorCatalogo } : {}),
    }),
    // Una pasada completa (para pruebas y scripts).
    async actualizarAhora() { const previo = activo; activo = true; await lanzar(); await lentasPendiente; activo = previo; },
    recuperar,

    async mapa() {
      const m = await obtenerMapa();
      const items = m.items.filter(i => empresas.has(i.simbolo)).map(i => {
        const p = puntajes.get(i.simbolo);
        return { simbolo: i.simbolo, nombre: i.nombre, sector: i.sector, industria: i.industria, precio: i.precio, cambioPct: i.cambioPct,
          volumen: i.volumen, capitalizacion: i.capitalizacion, cambio5d: p?.cambio5d ?? null, cambio21d: p?.cambio21d ?? null,
          ivPromedio: p?.ivPromedio ?? null, hv20: p?.hv20 ?? null, puntajes: p?.puntajes ?? null, coresEvaluados: p ? CORES.filter(c => p.cores?.[c]).length : 0 };
      });
      return { abierto: m.abierto, actualizadoEn: m.actualizadoEn, desactualizado: Boolean(m.desactualizado), total: items.length, items,
        fuente: { proveedor: 'alpaca', tiempoReal: alpaca().feed || 'iex', consolidado: 'delayed_sip', empresas: 'sec' } };
    },

    /** Alzas, bajas y volumen inusual del día con lo que ya está en memoria (no consulta a proveedores). */
    movimientos() {
      const base = cacheMapa ? cacheMapa.items : [...puntajes.values()];
      const items = base.filter(i => empresas.has(i.simbolo)).map(i => {
        const promedio = puntajes.get(i.simbolo)?.volumenPromedio;
        return { simbolo: i.simbolo, nombre: i.nombre, precio: i.precio ?? null, cambioPct: i.cambioPct ?? null,
          // Volumen acumulado del día entre el promedio diario de 20 sesiones (1 = un día normal completo).
          volumenRelativo: cacheMapa && promedio > 0 && i.volumen != null ? redondear(i.volumen / promedio, 2) : null,
          capitalizacion: i.capitalizacion ?? empresas.get(i.simbolo).capitalizacion ?? null };
      });
      const primeros = (filtro, orden) => items.filter(filtro).sort((a, b) => orden(a, b) || a.simbolo.localeCompare(b.simbolo)).slice(0, MAX_MOVIMIENTOS);
      const fechaGuardada = base.reduce((max, i) => Math.max(max, new Date(i.actualizadoEn ?? 0).getTime()), 0);
      return {
        abierto: cacheMapa ? cacheMapa.abierto : null, actualizadoEn: cacheMapa ? cacheMapa.actualizadoEn : fechaGuardada ? new Date(fechaGuardada) : null,
        desactualizado: !cacheMapa || ahora() >= cacheMapa.expira, total: items.length,
        alzas: primeros(i => i.cambioPct > 0, (a, b) => b.cambioPct - a.cambioPct),
        bajas: primeros(i => i.cambioPct < 0, (a, b) => a.cambioPct - b.cambioPct),
        volumenInusual: primeros(i => i.volumenRelativo > 0, (a, b) => b.volumenRelativo - a.volumenRelativo),
      };
    },

    async ficha(simbolo) {
      if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(simbolo)) throw boom.badRequest('Símbolo inválido.');
      const m = await obtenerMapa();
      const i = m.porSimbolo.get(simbolo);
      if (!i || !empresas.has(simbolo)) throw boom.notFound('La empresa no está en el universo del mapa.');
      const previa = fichas.get(simbolo);
      let velas = previa && ahora() - previa.t < 5 * MIN ? previa.velas : null;
      if (!velas) {
        velas = (await velasDe([simbolo]))[simbolo] || [];
        fichas.delete(simbolo);
        fichas.set(simbolo, { t: ahora(), velas });
        if (fichas.size > 100) fichas.delete(fichas.keys().next().value);
      }
      const p = puntajes.get(simbolo) || {};
      const campos = ['maximo52', 'minimo52', 'volumenPromedio', 'ivPromedio', 'hv20', 'cambio5d', 'cambio21d', 'cambioAnio', 'puntajes', 'resumenes'];
      return { ...i, abierto: m.abierto, actualizadoEn: m.actualizadoEn, ...Object.fromEntries(campos.map(c => [c, p[c] ?? null])), cores: coresDeFila(p), velas };
    },
  };
}
