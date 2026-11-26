// Adaptador de SEC EDGAR: tickers → CIK, fundamentales XBRL (companyfacts) y 13F-HR.
// Acceso justo SEC: User-Agent declarado obligatorio y ≤10 solicitudes/s (esperaMs entre solicitudes).
// Documentación verificada: ver src/integrations/README.md.
import { IntegrationError } from './errors';
import { createHttp } from './http';
import { claveEmisor, createDescubrimiento13F, MAX_PANEL } from './institucionales';

export { normalizarEmisor } from './institucionales';

const PROVEEDOR = 'sec';
export const SEC_WWW = 'https://www.sec.gov';
export const SEC_DATA = 'https://data.sec.gov';
const MAX_PERIODOS = 12;

// Conceptos us-gaap con alternativas en orden de preferencia.
export const METRICAS_SEC = [
  { nombre: 'ingresos', unidad: 'USD', tipo: 'duracion', conceptos: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'] },
  { nombre: 'utilidad_neta', unidad: 'USD', tipo: 'duracion', conceptos: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'] },
  { nombre: 'activos', unidad: 'USD', tipo: 'instante', conceptos: ['Assets'] },
  { nombre: 'pasivos', unidad: 'USD', tipo: 'instante', conceptos: ['Liabilities'] },
  { nombre: 'capital', unidad: 'USD', tipo: 'instante', conceptos: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { nombre: 'activo_circulante', unidad: 'USD', tipo: 'instante', conceptos: ['AssetsCurrent'] },
  { nombre: 'pasivo_circulante', unidad: 'USD', tipo: 'instante', conceptos: ['LiabilitiesCurrent'] },
  { nombre: 'flujo_operativo', unidad: 'USD', tipo: 'duracion', conceptos: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  { nombre: 'eps_diluido', unidad: 'USD/shares', tipo: 'duracion', conceptos: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'] },
];

const FORMAS = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A']);
const FRAME_DURACION = /^CY\d{4}(Q[1-4])?$/;
const FRAME_INSTANTE = /^CY\d{4}Q[1-4]I$/;

export const formatearCik = cik => {
  const digitos = String(cik ?? '').replace(/^CIK/i, '').trim();
  if (!/^\d{1,10}$/.test(digitos)) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'CIK inválido.' });
  return digitos.padStart(10, '0');
};

const decodificar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Analizador mínimo de la tabla de información 13F (con o sin prefijo de espacio de nombres).
const ETIQUETAS = Object.fromEntries(['nameOfIssuer', 'titleOfClass', 'cusip', 'value', 'sshPrnamt', 'sshPrnamtType', 'putCall']
  .map(n => [n, new RegExp(`<(?:[\\w-]+:)?${n}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${n}>`, 'i')]));
const BLOQUE = /<(?:[\w-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
const filaTabla = contenido => {
  const campo = nombre => { const m = ETIQUETAS[nombre].exec(contenido); return m ? decodificar(m[1].trim()) : null; };
  return {
    nombreEmisor: campo('nameOfIssuer'),
    clase: campo('titleOfClass'),
    cusip: (campo('cusip') || '').toUpperCase(),
    valor: Number(campo('value')) || 0,
    cantidad: Number(campo('sshPrnamt')) || 0,
    tipoCantidad: (campo('sshPrnamtType') || '').toUpperCase(),
    putCall: campo('putCall'),
  };
};
export const parsearTabla13F = (xml, coincide = () => true) => [...String(xml ?? '').matchAll(BLOQUE)].map(m => filaTabla(m[1])).filter(coincide);

// Tablas enormes (decenas de MB): se leen por trozos y solo se conservan las filas que coinciden.
// Lectura masiva 13F: instituciones que se leen completas (más que MAX_PANEL: no todas tienen cada empresa) y su vigencia.
const INSTITUCIONES_MASIVO = 16, MASIVO_VIGENTE_MS = 7 * 86400000;
const NO_ACCION = /\b(PFD|PREF|WTS?\b|WARRANT|RIGHT|UNIT|NOTE|DEB)/i;
const MAX_BYTES_TABLA = 120e6, MAX_PENDIENTE = 1e6, MAX_MS_TABLA = 120000;
export const leerTablaPorTrozos = async (res, coincide, { maxBytes = MAX_BYTES_TABLA, maxMs = MAX_MS_TABLA } = {}) => {
  if (!res.body?.getReader) return parsearTabla13F(await res.text(), coincide);
  const lector = res.body.getReader(), decodificador = new TextDecoder();
  const filas = [];
  let pendiente = '', bytes = 0, vencido = false;
  const limite = setTimeout(() => { vencido = true; lector.cancel().catch(() => {}); }, maxMs);
  const error = mensaje => new IntegrationError({ proveedor: PROVEEDOR, codigo: 'RED', mensaje });
  try {
    for (;;) {
      const { done, value } = await lector.read().catch(() => { throw error('Se interrumpió la descarga de una tabla 13F.'); });
      if (vencido) throw error('Una tabla 13F tardó demasiado en descargarse.');
      bytes += value?.length || 0;
      pendiente += done ? decodificador.decode() : decodificador.decode(value, { stream: true });
      let consumido = 0;
      for (const m of pendiente.matchAll(BLOQUE)) {
        const fila = filaTabla(m[1]);
        if (coincide(fila)) filas.push(fila);
        consumido = m.index + m[0].length;
      }
      if (consumido) pendiente = pendiente.slice(consumido);
      if (done) return filas;
      if (bytes > maxBytes || pendiente.length > MAX_PENDIENTE) {
        await lector.cancel().catch(() => {});
        throw error('Una tabla 13F excede el tamaño admitido.');
      }
    }
  } finally { clearTimeout(limite); }
};

// Construye periodos a partir de companyfacts usando los frames de SEC (valores ya deduplicados).
export const construirFundamentales = (companyfacts, maxPeriodos = MAX_PERIODOS) => {
  const gaap = companyfacts?.facts?.['us-gaap'] || {};
  const hechos = (concepto, unidad) => (gaap[concepto]?.units?.[unidad] || []).filter(h => FORMAS.has(h.form) && Number.isFinite(Number(h.val)));
  const periodos = new Map(); // clave frame (CY2024Q1, CY2024)
  const instantes = new Map(); // nombre → Map(fin → hecho)

  const registrar = (definicion, h) => {
    const clave = h.frame; // SEC asigna un frame por periodo calendario: deduplica comparativos
    if (!periodos.has(clave)) {
      periodos.set(clave, { periodoInicio: h.start, periodoFin: h.end, forma: h.form, frame: h.frame, filed: h.filed, accn: h.accn, metricas: new Map() });
    }
    const p = periodos.get(clave);
    if (!p.metricas.has(definicion.nombre)) {
      p.metricas.set(definicion.nombre, { nombre: definicion.nombre, valor: Number(h.val), unidad: definicion.unidad, periodo: h.frame });
    }
    if (h.filed > p.filed) Object.assign(p, { filed: h.filed, accn: h.accn });
  };

  for (const definicion of METRICAS_SEC) {
    for (const concepto of definicion.conceptos) {
      const lista = hechos(concepto, definicion.unidad);
      if (definicion.tipo === 'duracion') {
        lista.filter(h => h.start && FRAME_DURACION.test(h.frame || '')).forEach(h => registrar(definicion, h));
      } else {
        if (!instantes.has(definicion.nombre)) instantes.set(definicion.nombre, new Map());
        const mapa = instantes.get(definicion.nombre);
        lista.filter(h => FRAME_INSTANTE.test(h.frame || '')).forEach(h => {
          if (!mapa.has(h.end)) mapa.set(h.end, h);
          if (!mapa.has(h.frame)) mapa.set(h.frame, h);
        });
      }
    }
  }

  // Periodos trimestrales o anuales (frames CY) con ingresos o utilidad.
  const resultado = [...periodos.values()]
    .filter(p => p.metricas.has('ingresos') || p.metricas.has('utilidad_neta'))
    .sort((a, b) => (a.periodoFin < b.periodoFin ? 1 : a.periodoFin > b.periodoFin ? -1 : (a.periodoInicio < b.periodoInicio ? 1 : -1)))
    .slice(0, maxPeriodos)
    .map(p => {
      const metricas = [...p.metricas.values()];
      for (const definicion of METRICAS_SEC.filter(d => d.tipo === 'instante')) {
        const mapa = instantes.get(definicion.nombre);
        const frameInstante = /^CY\d{4}$/.test(p.frame) ? `${p.frame}Q4I` : `${p.frame}I`;
        const h = mapa?.get(p.periodoFin) || mapa?.get(frameInstante);
        if (h) metricas.push({ nombre: definicion.nombre, valor: Number(h.val), unidad: definicion.unidad, periodo: h.frame });
      }
      const anual = /^CY\d{4}$/.test(p.frame || '');
      return {
        periodoInicio: p.periodoInicio,
        periodoFin: p.periodoFin,
        forma: anual ? '10-K' : '10-Q',
        fuente: { proveedor: PROVEEDOR, fechaDato: p.filed, referencia: p.accn },
        metricas: METRICAS_SEC.map(d => metricas.find(m => m.nombre === d.nombre)).filter(Boolean),
      };
    });
  return resultado;
};

export const createSecClient = ({
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  esperaMs = 120,
  timeoutMs,
  esperar,
  ahora,
} = {}) => {
  const agente = typeof userAgent === 'string' ? userAgent.trim() : '';
  const configurado = Boolean(agente);
  // Algunas respuestas (tablas enormes, rangos binarios) no se leen como texto: las procesa la función marcada en el fragmento de la URL.
  const procesos = new Map();
  let consecutivo = 0;
  const fetchConProceso = async (url, init) => {
    const [destino, marca] = String(url).split('#');
    const res = await fetchFn(destino, init), fn = procesos.get(marca);
    return fn && res.ok ? { ok: true, status: res.status, headers: res.headers, text: () => fn(res) } : res;
  };
  const http = createHttp({
    proveedor: PROVEEDOR, fetch: typeof fetchFn === 'function' ? fetchConProceso : fetchFn, timeoutMs, esperar, ahora,
    intervaloMs: Math.max(100, Number(esperaMs) || 0), // nunca más de 10 req/s
    headers: configurado ? { 'User-Agent': agente } : {},
  });
  const pedir = (url, opciones) => {
    if (!configurado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'SIN_CREDENCIALES', mensaje: 'Falta SEC_USER_AGENT (nombre y contacto) en el servidor.' });
    return http.request({ url, ...opciones });
  };

  const procesar = async (url, headers, fn) => {
    const marca = `p${consecutivo += 1}`;
    procesos.set(marca, fn);
    try { return await pedir(`${url}#${marca}`, { headers, respuesta: 'text' }); } finally { procesos.delete(marca); }
  };
  const leerTabla = (url, coincide) => procesar(url, {}, res => leerTablaPorTrozos(res, coincide));
  const descubrimiento = createDescubrimiento13F({ pedir, procesar, leerTabla, ahora: ahora || Date.now });

  let tickers = null; // caché en memoria del archivo company_tickers.json
  const cargarTickers = async () => {
    if (!tickers) {
      const cuerpo = await pedir(`${SEC_WWW}/files/company_tickers.json`);
      const mapa = new Map();
      for (const fila of Object.values(cuerpo || {})) {
        if (fila?.ticker) mapa.set(String(fila.ticker).toUpperCase(), { cik: formatearCik(fila.cik_str), nombre: fila.title, simbolo: String(fila.ticker).toUpperCase() });
      }
      tickers = mapa;
    }
    return tickers;
  };

  const cikDeSimbolo = async simbolo => {
    const s = String(simbolo ?? '').trim().toUpperCase();
    if (!s) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Símbolo requerido.' });
    const mapa = await cargarTickers();
    const encontrado = mapa.get(s) || mapa.get(s.replace('.', '-'));
    if (!encontrado) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: `No hay CIK para ${s}.` });
    return { ...encontrado };
  };

  const listaTickers = async () => new Map(await cargarTickers());

  // Un dato de todas las empresas en un periodo (API XBRL "frames"): [{ cik, valor }]. Sin datos para el periodo → [].
  const marco = async ({ concepto, unidad, periodo }) => {
    if (!/^[a-z-]+\/[A-Za-z]+$/.test(concepto) || !/^[A-Za-z-]+$/.test(unidad) || !/^CY\d{4}(Q[1-4]I?)?$/.test(periodo)) {
      throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Concepto, unidad o periodo XBRL inválido.' });
    }
    try {
      const cuerpo = await pedir(`${SEC_DATA}/api/xbrl/frames/${concepto}/${unidad}/${periodo}.json`);
      return (cuerpo?.data || []).filter(d => Number.isFinite(Number(d.val))).map(d => ({ cik: formatearCik(d.cik), valor: Number(d.val) }));
    } catch (e) {
      if (e?.codigo === 'NO_ENCONTRADO') return [];
      throw e;
    }
  };

  // Perfil del emisor: giro (SIC) y si presenta reportes trimestrales 10-Q (empresa estadounidense operativa).
  const perfil = async cik => {
    const cuerpo = await pedir(`${SEC_DATA}/submissions/CIK${formatearCik(cik)}.json`);
    return { cik: formatearCik(cik), nombre: cuerpo?.name || null, sic: cuerpo?.sic ? Number(cuerpo.sic) : null, industria: cuerpo?.sicDescription || null,
      presenta10Q: (cuerpo?.filings?.recent?.form || []).some(f => f === '10-Q' || f === '10-Q/A') };
  };

  // Fechas (AAAA-MM-DD, ascendentes) de los 8-K con punto 2.02, «resultados de operaciones». Los emisores con miles de documentos
  // (bancos) apenas traen unos meses en `recent`: en ese caso se usa la búsqueda de EDGAR, que también informa los puntos.
  const reportesResultados = async cik => {
    const c = formatearCik(cik), r = (await pedir(`${SEC_DATA}/submissions/CIK${c}.json`))?.filings?.recent || {};
    const fechas = new Set((r.form || []).map((f, i) => (f === '8-K' && /(^|,)2\.02(,|$)/.test(r.items?.[i] || '') ? r.filingDate[i] : null)).filter(Boolean));
    if (fechas.size < 9 && (r.form || []).length >= 900) {
      const hoy = (ahora || Date.now)(), dia = t => new Date(t).toISOString().slice(0, 10);
      for (let desde = 0; desde < 500; desde += 100) {
        const b = await pedir('https://efts.sec.gov/LATEST/search-index', { query: { q: '', forms: '8-K', ciks: c, dateRange: 'custom', startdt: dia(hoy - 900 * 86400000), enddt: dia(hoy), from: desde } });
        const hits = b?.hits?.hits || [];
        for (const h of hits) if (h._source?.file_date && (h._source.items || []).includes('2.02')) fechas.add(h._source.file_date);
        if (hits.length < 100) break;
      }
    }
    return [...fechas].sort();
  };

  const fundamentales = async (cik, { maxPeriodos = MAX_PERIODOS } = {}) => {
    const cuerpo = await pedir(`${SEC_DATA}/api/xbrl/companyfacts/CIK${formatearCik(cik)}.json`);
    return construirFundamentales(cuerpo, maxPeriodos);
  };

  // Lista los 13F-HR más recientes (un corte por fecha de reporte) de un filer.
  const presentaciones13F = async (cik, cortes) => {
    const cuerpo = await pedir(`${SEC_DATA}/submissions/CIK${formatearCik(cik)}.json`);
    const r = cuerpo?.filings?.recent || {};
    const vistos = new Set();
    const salida = [];
    for (let i = 0; i < (r.form || []).length && salida.length < cortes; i += 1) {
      if (r.form[i] !== '13F-HR' || !r.reportDate?.[i] || vistos.has(r.reportDate[i])) continue;
      vistos.add(r.reportDate[i]);
      salida.push({ accn: r.accessionNumber[i], fechaPublicacion: r.filingDate[i], fechaCorte: r.reportDate[i], institucion: cuerpo?.name });
    }
    return salida;
  };

  const urlTabla = async (cik, accn) => {
    const carpeta = `${SEC_WWW}/Archives/edgar/data/${Number(formatearCik(cik))}/${String(accn).replace(/-/g, '')}`;
    const indice = await pedir(`${carpeta}/index.json`);
    const archivos = (indice?.directory?.item || []).map(i => i.name).filter(n => /\.xml$/i.test(n) && !/^primary_doc\.xml$/i.test(n));
    const archivo = archivos.find(n => /info/i.test(n)) || archivos[0];
    if (!archivo) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: `Tabla de información 13F no encontrada (${accn}).` });
    return `${carpeta}/${archivo}`;
  };

  // Las presentaciones 13F no cambian: lo leído de cada tabla se reutiliza entre usuarios y sincronizaciones.
  const leidas = new Map();
  const tenenciasDeTabla = async (url, clave, coincide) => {
    const id = `${url}|${clave}`;
    if (!leidas.has(id)) {
      const filas = await leerTabla(url, f => f.tipoCantidad !== 'PRN' && !f.putCall && coincide(f));
      // Varias filas por institución (gestores, clases): se suman.
      leidas.set(id, { filas: filas.length, acciones: filas.reduce((t, f) => t + f.cantidad, 0), valorReportado: filas.reduce((t, f) => t + f.valor, 0) });
      if (leidas.size > 1000) leidas.delete(leidas.keys().next().value);
    }
    return leidas.get(id);
  };

  // ---- Lectura masiva: las tablas de las mayores instituciones se leen UNA vez y sirven para todas las empresas (500 empresas
  // por separado significarían descargar las mismas tablas miles de veces).
  let masivo = null, masivoPendiente = null; // { t, ciks, cortes: [{ fechaCorte, porCik }], porClave, omitidos }
  async function leerMasivo() {
    const mayores = await descubrimiento.mayores();
    if (!mayores) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'PROVEEDOR', mensaje: 'La SEC no entregó el ranking de instituciones 13F.' });
    const ciks = mayores.slice(0, INSTITUCIONES_MASIVO), informes = new Map(), omitidos = [];
    for (const cik of ciks) {
      try { informes.set(cik, await presentaciones13F(cik, 3)); } catch (e) {
        if (e?.codigo === 'SIN_CREDENCIALES') throw e;
        omitidos.push({ cik, motivo: e?.mensaje || 'Error al leer el 13F.' });
      }
    }
    // Los dos cortes más recientes que ya presentó al menos la mitad (plazo legal: 45 días).
    const conteo = new Map();
    for (const lista of informes.values()) for (const p of lista) conteo.set(p.fechaCorte, (conteo.get(p.fechaCorte) || 0) + 1);
    const elegidos = [...conteo].filter(([, n]) => n >= informes.size / 2).map(([c]) => c).sort().reverse().slice(0, 2);
    const cortes = elegidos.map(fechaCorte => ({ fechaCorte, porCik: new Map() })), porClave = new Map();
    for (const c of cortes) {
      for (const [cik, lista] of informes) {
        const p = lista.find(x => x.fechaCorte === c.fechaCorte);
        if (!p) continue;
        try {
          const sumas = new Map(), nombres = new Map();
          await leerTabla(await urlTabla(cik, p.accn), f => {
            if (f.tipoCantidad === 'PRN' || f.putCall || !/^[0-9A-Z]{9}$/.test(f.cusip) || NO_ACCION.test(f.clase || '')) return false;
            const x = sumas.get(f.cusip) || { acciones: 0, valorReportado: 0 };
            x.acciones += f.cantidad; x.valorReportado += f.valor;
            sumas.set(f.cusip, x);
            if (!nombres.has(f.cusip)) nombres.set(f.cusip, claveEmisor(f.nombreEmisor));
            return false; // solo se acumula: no se guardan filas
          });
          // Se incorpora al terminar: una tabla interrumpida no deja sumas a medias.
          c.porCik.set(cik, { institucion: p.institucion || cik, accn: p.accn, fechaPublicacion: p.fechaPublicacion, sumas });
          for (const [cusip, clave] of nombres) { if (!porClave.has(clave)) porClave.set(clave, new Set()); porClave.get(clave).add(cusip); }
        } catch (e) { omitidos.push({ cik, motivo: e?.mensaje || 'Error al leer el 13F.' }); }
      }
    }
    if (!cortes.some(c => c.porCik.size)) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'PROVEEDOR', mensaje: 'No se pudo leer ninguna tabla 13F.' });
    masivo = { t: (ahora || Date.now)(), ciks, cortes, porClave, omitidos };
  }
  /** Carga (o reutiliza) la lectura masiva. Tarda minutos la primera vez; vale una semana. */
  const cargarTenencias13F = async () => {
    if (masivo && (ahora || Date.now)() - masivo.t < MASIVO_VIGENTE_MS) return;
    masivoPendiente ||= leerMasivo().finally(() => { masivoPendiente = null; });
    await masivoPendiente;
  };
  function desdeMasivo(cusips) {
    // Un emisor son todos los CUSIP con sus mismos 6 primeros caracteres; si el nombre coincide con varios, gana el de más valor.
    const valor = new Map();
    for (const c of masivo.cortes) for (const t of c.porCik.values()) for (const k of cusips) { const b = k.slice(0, 6); valor.set(b, (valor.get(b) || 0) + (t.sumas.get(k)?.valorReportado || 0)); }
    const [base] = [...valor].sort((a, b) => b[1] - a[1])[0] || [];
    const lista = cusips.filter(k => k.startsWith(base));
    const tiene = t => lista.some(k => t?.sumas.has(k));
    const panel = masivo.ciks.filter(cik => masivo.cortes.some(c => tiene(c.porCik.get(cik)))).slice(0, MAX_PANEL);
    if (!base || !panel.length) return null;
    const cortes = [];
    for (const c of masivo.cortes) {
      const tenencias = [], referencias = [];
      let fechaPublicacion = '';
      for (const cik of panel) {
        const t = c.porCik.get(cik);
        if (!t) continue;
        referencias.push(t.accn);
        if (t.fechaPublicacion > fechaPublicacion) fechaPublicacion = t.fechaPublicacion;
        if (!tiene(t)) continue;
        const suma = lista.reduce((a, k) => { const x = t.sumas.get(k); return x ? { acciones: a.acciones + x.acciones, valorReportado: a.valorReportado + x.valorReportado } : a; }, { acciones: 0, valorReportado: 0 });
        tenencias.push({ institucion: t.institucion, identificadorInstitucion: cik, ...suma, unidad: 'USD' });
      }
      if (referencias.length) cortes.push({ fechaCorte: c.fechaCorte, fechaPublicacion, fuente: { proveedor: PROVEEDOR, fechaDato: fechaPublicacion, referencia: referencias.join(',').slice(0, 2000) }, tenencias });
    }
    return cortes;
  }

  /**
   * Tenencias de un emisor por corte trimestral, del más reciente al más antiguo. Sin `filers`, las instituciones se descubren
   * en la SEC (institucionales.js). Un error en una institución la omite (`omitidos`); lo que faltó se resume en `datosFaltantes`.
   */
  const tenencias13F = async ({ filers, nombreEmisor, cusip, cortes = 2, soloMasivo = false } = {}) => {
    if (filers != null && (!Array.isArray(filers) || !filers.length)) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Se requiere al menos un filer.' });
    const emisorBuscado = claveEmisor(nombreEmisor);
    if (!cusip && !emisorBuscado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Se requiere nombreEmisor o cusip.' });
    const n = Math.max(1, Math.min(Number(cortes) || 2, 8));
    let cusips = cusip ? [String(cusip).trim().toUpperCase()] : null;
    // Con la lectura masiva cargada no hace falta descargar nada (misma fuente para el ranking y para Análisis).
    if (!filers && n <= 2 && masivo && (ahora || Date.now)() - masivo.t < MASIVO_VIGENTE_MS) {
      const porNombre = masivo.porClave.get(emisorBuscado);
      let r = desdeMasivo(cusips || [...(porNombre || [])]);
      // Nombre abreviado en las tablas: el CUSIP se deduce con la búsqueda de EDGAR.
      if (!r && !cusips) r = desdeMasivo(await descubrimiento.cusipsDe(nombreEmisor));
      if (r) return r.slice(0, n);
    }
    if (soloMasivo) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_ENCONTRADO', mensaje: `Ninguna de las mayores instituciones reporta ${nombreEmisor || cusip} en su 13F.` });

    const porCorte = new Map(), omitidos = new Map(), datosFaltantes = [];
    let primerError = null;
    // Un fallo aislado no detiene a las demás instituciones; sin credenciales no tiene sentido seguir.
    const aislar = async (cik, fn) => {
      try { return await fn(); } catch (e) {
        if (e?.codigo === 'SIN_CREDENCIALES') throw e;
        primerError ||= e;
        omitidos.set(cik, e?.mensaje || 'Error al leer el 13F.');
        return null;
      }
    };
    const tablas = []; // { cik, nombre, fechaCorte, fechaPublicacion, accn, url }
    if (filers) {
      for (const filer of filers) {
        const { cik, nombre } = typeof filer === 'object' ? filer : { cik: filer, nombre: String(filer) };
        const cik10 = formatearCik(cik);
        for (const p of await aislar(cik10, () => presentaciones13F(cik10, n)) || []) {
          const url = await aislar(cik10, () => urlTabla(cik10, p.accn));
          if (url) tablas.push({ cik: cik10, nombre: nombre || cik10, ...p, url });
        }
      }
    } else {
      const d = await descubrimiento.tenedores({ nombreEmisor, cusip, cortes: n });
      cusips = d.cusips;
      datosFaltantes.push(...d.datosFaltantes);
      for (const c of d.cortes) for (const t of c.tablas) tablas.push({ cik: t.cik, nombre: t.nombre, fechaCorte: c.corte, fechaPublicacion: t.publicada, accn: t.adsh, url: t.url });
      if (!tablas.length) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'NO_ENCONTRADO', mensaje: `Ninguna institución consultada reporta ${nombreEmisor || cusip} en su 13F.` });
    }
    const coincide = fila => (cusips ? cusips.includes(fila.cusip) : claveEmisor(fila.nombreEmisor) === emisorBuscado);
    for (const t of tablas) {
      const suma = await aislar(t.cik, () => tenenciasDeTabla(t.url, cusips ? cusips.join(',') : emisorBuscado, coincide));
      if (!suma) continue;
      if (!porCorte.has(t.fechaCorte)) porCorte.set(t.fechaCorte, { fechaCorte: t.fechaCorte, fechaPublicacion: t.fechaPublicacion, referencias: [], tenencias: [] });
      const corte = porCorte.get(t.fechaCorte);
      if (t.fechaPublicacion > corte.fechaPublicacion) corte.fechaPublicacion = t.fechaPublicacion;
      corte.referencias.push(t.accn);
      if (suma.filas) corte.tenencias.push({ institucion: t.nombre, identificadorInstitucion: t.cik, acciones: suma.acciones, valorReportado: suma.valorReportado, unidad: 'USD' });
    }
    if (!porCorte.size && primerError) throw primerError;
    if (omitidos.size) datosFaltantes.push(`${omitidos.size} institución(es) sin leer`);
    const lista = [...omitidos].map(([cik, motivo]) => ({ cik, motivo }));
    return [...porCorte.values()]
      .sort((a, b) => (a.fechaCorte < b.fechaCorte ? 1 : -1))
      .slice(0, n)
      .map(c => ({
        fechaCorte: c.fechaCorte,
        fechaPublicacion: c.fechaPublicacion,
        fuente: { proveedor: PROVEEDOR, fechaDato: c.fechaPublicacion, referencia: c.referencias.join(',').slice(0, 2000) },
        tenencias: c.tenencias,
        ...(lista.length ? { omitidos: lista } : {}),
        ...(datosFaltantes.length ? { datosFaltantes } : {}),
      }));
  };

  return { proveedor: PROVEEDOR, circuito: http.circuito, configurado, cikDeSimbolo, fundamentales, tenencias13F, cargarTenencias13F, tickers: listaTickers, marco, perfil, reportesResultados };
};
