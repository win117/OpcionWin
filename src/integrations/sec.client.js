// Adaptador de SEC EDGAR: tickers → CIK, fundamentales XBRL (companyfacts) y 13F-HR.
// Acceso justo SEC: User-Agent declarado obligatorio y ≤10 solicitudes/s (esperaMs entre solicitudes).
// Documentación verificada: ver src/integrations/README.md.
import { IntegrationError } from './errors';
import { createHttp } from './http';

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

// Normaliza nombres de emisor para comparar ("Apple Inc." ≈ "APPLE INC").
const SUFIJOS = new Set(['INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'SA', 'NV', 'AG', 'HLDGS', 'HOLDINGS', 'GROUP', 'THE', 'COM', 'NEW', 'DEL', 'CL', 'CLASS', 'A', 'B', 'C']);
export const normalizarEmisor = nombre => String(nombre ?? '')
  .toUpperCase()
  .replace(/&AMP;/g, '&')
  .replace(/[^A-Z0-9& ]+/g, ' ')
  .split(/\s+/)
  .filter(p => p && !SUFIJOS.has(p))
  .join(' ');

const decodificar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Analizador mínimo de la tabla de información 13F (con o sin prefijo de espacio de nombres).
export const parsearTabla13F = xml => {
  const filas = [];
  const bloque = /<(?:[\w-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
  const campo = (contenido, nombre) => {
    const m = new RegExp(`<(?:[\\w-]+:)?${nombre}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, 'i').exec(contenido);
    return m ? decodificar(m[1].trim()) : null;
  };
  let m;
  while ((m = bloque.exec(String(xml ?? ''))) !== null) {
    const c = m[1];
    filas.push({
      nombreEmisor: campo(c, 'nameOfIssuer'),
      clase: campo(c, 'titleOfClass'),
      cusip: (campo(c, 'cusip') || '').toUpperCase(),
      valor: Number(campo(c, 'value')) || 0,
      cantidad: Number(campo(c, 'sshPrnamt')) || 0,
      tipoCantidad: (campo(c, 'sshPrnamtType') || '').toUpperCase(),
      putCall: campo(c, 'putCall'),
    });
  }
  return filas;
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
  const http = createHttp({
    proveedor: PROVEEDOR, fetch: fetchFn, timeoutMs, esperar, ahora,
    intervaloMs: Math.max(100, Number(esperaMs) || 0), // nunca más de 10 req/s
    headers: configurado ? { 'User-Agent': agente } : {},
  });
  const pedir = (url, opciones) => {
    if (!configurado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'SIN_CREDENCIALES', mensaje: 'Falta SEC_USER_AGENT (nombre y contacto) en el servidor.' });
    return http.request({ url, ...opciones });
  };

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
      salida.push({ accn: r.accessionNumber[i], fechaPublicacion: r.filingDate[i], fechaCorte: r.reportDate[i] });
    }
    return salida;
  };

  const tablaInformacion = async (cik, accn) => {
    const carpeta = `${SEC_WWW}/Archives/edgar/data/${Number(formatearCik(cik))}/${String(accn).replace(/-/g, '')}`;
    const indice = await pedir(`${carpeta}/index.json`);
    const archivos = (indice?.directory?.item || []).map(i => i.name).filter(n => /\.xml$/i.test(n) && !/^primary_doc\.xml$/i.test(n));
    const archivo = archivos.find(n => /info/i.test(n)) || archivos[0];
    if (!archivo) throw new IntegrationError({ proveedor: PROVEEDOR, status: 404, codigo: 'NO_ENCONTRADO', mensaje: `Tabla de información 13F no encontrada (${accn}).` });
    return parsearTabla13F(await pedir(`${carpeta}/${archivo}`, { respuesta: 'text' }));
  };

  const tenencias13F = async ({ filers, nombreEmisor, cusip, cortes = 2 } = {}) => {
    if (!Array.isArray(filers) || !filers.length) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Se requiere al menos un filer.' });
    const cusipBuscado = cusip ? String(cusip).trim().toUpperCase() : null;
    const emisorBuscado = normalizarEmisor(nombreEmisor);
    if (!cusipBuscado && !emisorBuscado) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'VALIDACION', mensaje: 'Se requiere nombreEmisor o cusip.' });
    const coincide = fila => (cusipBuscado ? fila.cusip === cusipBuscado : normalizarEmisor(fila.nombreEmisor) === emisorBuscado);
    const n = Math.max(1, Math.min(Number(cortes) || 2, 8));

    const porCorte = new Map();
    const omitidos = [];
    for (const filer of filers) {
      const { cik, nombre } = typeof filer === 'object' ? filer : { cik: filer, nombre: String(filer) };
      const cik10 = formatearCik(cik);
      let presentaciones;
      try {
        presentaciones = await presentaciones13F(cik10, n);
      } catch (e) {
        if (e?.codigo === 'NO_ENCONTRADO') { omitidos.push({ cik: cik10, motivo: e.mensaje }); continue; }
        throw e;
      }
      for (const p of presentaciones) {
        const filas = (await tablaInformacion(cik10, p.accn)).filter(f => f.tipoCantidad !== 'PRN' && !f.putCall && coincide(f));
        if (!porCorte.has(p.fechaCorte)) porCorte.set(p.fechaCorte, { fechaCorte: p.fechaCorte, fechaPublicacion: p.fechaPublicacion, referencias: [], tenencias: [] });
        const corte = porCorte.get(p.fechaCorte);
        if (p.fechaPublicacion > corte.fechaPublicacion) corte.fechaPublicacion = p.fechaPublicacion;
        corte.referencias.push(p.accn);
        if (!filas.length) continue;
        // Varias filas por filer (gestores, clases): se suman.
        corte.tenencias.push({
          institucion: nombre || cik10,
          identificadorInstitucion: cik10,
          acciones: filas.reduce((t, f) => t + f.cantidad, 0),
          valorReportado: filas.reduce((t, f) => t + f.valor, 0),
          unidad: 'USD',
        });
      }
    }
    return [...porCorte.values()]
      .sort((a, b) => (a.fechaCorte < b.fechaCorte ? 1 : -1))
      .slice(0, n)
      .map(c => ({
        fechaCorte: c.fechaCorte,
        fechaPublicacion: c.fechaPublicacion,
        fuente: { proveedor: PROVEEDOR, fechaDato: c.fechaPublicacion, referencia: c.referencias.join(',').slice(0, 2000) },
        tenencias: c.tenencias,
        ...(omitidos.length ? { omitidos } : {}),
      }));
  };

  return { proveedor: PROVEEDOR, configurado, cikDeSimbolo, fundamentales, tenencias13F };
};
