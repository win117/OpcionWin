// Descubrimiento de instituciones 13F. Aquí no hay ninguna institución ni empresa escrita: todo se pregunta a la SEC.
//   1) Ranking: los conjuntos de datos oficiales "Form 13F" (zip trimestral) traen el valor total de cada informe. Del zip de
//      ~95 MB solo se descargan dos tablas pequeñas con solicitudes por rango (4 solicitudes en total, válidas una semana).
//   2) CUSIP del emisor: búsqueda de texto completo de EDGAR por nombre; se leen las tablas pequeñas donde más pesa el emisor.
//   3) Tenedores: búsqueda por CUSIP limitada a las mayores instituciones del ranking, una por corte trimestral.
// Si el ranking falla se aproxima con las instituciones de tablas más largas, ordenadas por el valor total de su portada, y se
// informa en `datosFaltantes`.
import { inflateRawSync } from 'node:zlib';
import { IntegrationError } from './errors';

const SEC_WWW = 'https://www.sec.gov';
export const SEC_BUSQUEDA = 'https://efts.sec.gov/LATEST/search-index';
const PAGINA_CONJUNTOS = `${SEC_WWW}/data-research/sec-markets-data/form-13f-data-sets`;
const DIA = 86400000;
export const MAX_RANKING = 40; // instituciones candidatas
export const MAX_PANEL = 12; // instituciones cuyas tablas se leen por empresa
const RANKING_VIGENTE_MS = 7 * DIA, RANKING_REINTENTO_MS = 10 * 60000, CUSIP_VIGENTE_MS = 30 * DIA;
const COLA_ZIP = 65536, MAX_TABLA_ZIP = 8e6;
const TABLAS_PARA_CUSIP = 6; // tablas pequeñas que se revisan como máximo
const MAX_PORTADAS = 80; // portadas leídas como máximo si no hay ranking oficial
const TAMANO_PAGINA = 100, VENTANA_BUSQUEDA = 10000, MAX_PAGINAS = 3; // límites de la búsqueda de EDGAR

const fallo = (mensaje, codigo = 'PROVEEDOR') => new IntegrationError({ proveedor: 'sec', codigo, mensaje });
const iso = t => new Date(t).toISOString().slice(0, 10);

// Últimos n fines de trimestre anteriores a `hoy`, del más reciente al más antiguo.
export function cortesTrimestrales(n, hoy) {
  const d = new Date(hoy);
  const trimestre = Math.floor(d.getUTCMonth() / 3);
  return Array.from({ length: n }, (_, i) => iso(Date.UTC(d.getUTCFullYear(), (trimestre - i) * 3, 0)));
}

// ---- Nombres de emisor. "Eli Lilly & Co" y "LILLY ELI & CO" deben coincidir: se comparan las palabras, sin orden ni sufijos.
const SUFIJOS = new Set(['INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'SA', 'NV', 'AG', 'HLDGS', 'HOLDINGS', 'GROUP', 'THE', 'COM', 'NEW', 'DEL', 'CL', 'CLASS', 'A', 'B', 'C']);
export const normalizarEmisor = nombre => String(nombre ?? '')
  .toUpperCase()
  .replace(/&AMP;/g, '&')
  .replace(/[^A-Z0-9& ]+/g, ' ')
  .split(/\s+/)
  .filter(p => p && !SUFIJOS.has(p))
  .join(' ');
const limpiarNombre = nombre => String(nombre ?? '')
  .replace(/\/[A-Z]{2,3}\/?(?=\s|$)/gi, ' ') // estado de constitución: "/DE/"
  .replace(/\b(common stock|ordinary shares?|capital stock)\b.*$/i, ' ');
export const claveEmisor = nombre => normalizarEmisor(limpiarNombre(nombre)).split(' ').filter(p => p && !['&', 'OF', 'AND'].includes(p)).sort().join(' ');
// Frase para la búsqueda: sin sufijos finales; EDGAR indexa "&" como "amp".
export function fraseEmisor(nombre) {
  const palabras = limpiarNombre(nombre).toUpperCase().replace(/&AMP;/g, '&').replace(/&/g, ' amp ').replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  while (palabras.length > 1 && (SUFIJOS.has(palabras.at(-1)) || palabras.at(-1) === 'amp')) palabras.pop();
  return palabras.join(' ');
}

// ---- Lectura mínima de un zip a partir de su final (directorio central).
export function directorioZip(cola, total) {
  const fin = cola.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0 || !Number.isFinite(total)) throw fallo('Conjunto de datos 13F ilegible.');
  const entradas = cola.readUInt16LE(fin + 10), inicio = cola.readUInt32LE(fin + 16) - (total - cola.length);
  if (inicio < 0) throw fallo('Conjunto de datos 13F ilegible.');
  const salida = [];
  for (let i = 0, p = inicio; i < entradas && p + 46 <= cola.length; i += 1) {
    const nombre = cola.readUInt16LE(p + 28), extra = cola.readUInt16LE(p + 30), comentario = cola.readUInt16LE(p + 32);
    salida.push({ metodo: cola.readUInt16LE(p + 10), comprimido: cola.readUInt32LE(p + 20), posicion: cola.readUInt32LE(p + 42), nombre: cola.toString('utf8', p + 46, p + 46 + nombre) });
    p += 46 + nombre + extra + comentario;
  }
  return salida;
}
export function extraerZip(bloque, { metodo, comprimido }) {
  const inicio = 30 + bloque.readUInt16LE(26) + bloque.readUInt16LE(28);
  const crudo = bloque.subarray(inicio, inicio + comprimido);
  return (metodo === 8 ? inflateRawSync(crudo) : crudo).toString('utf8');
}
const filasTsv = texto => {
  const [cabecera, ...lineas] = texto.split(/\r?\n/);
  const campos = cabecera.split('\t');
  return lineas.filter(Boolean).map(l => { const v = l.split('\t'); return Object.fromEntries(campos.map((c, i) => [c, v[i]])); });
};

// CIK de las mayores instituciones según el valor total de su 13F-HR, en el trimestre más frecuente del conjunto.
export function rankingDesdeTablas(submission, summary, maximo = MAX_RANKING) {
  const envios = filasTsv(submission).filter(f => f.SUBMISSIONTYPE === '13F-HR' && /^\d{1,10}$/.test(f.CIK || ''));
  const porPeriodo = new Map();
  for (const f of envios) porPeriodo.set(f.PERIODOFREPORT, (porPeriodo.get(f.PERIODOFREPORT) || 0) + 1);
  const [periodo] = [...porPeriodo].sort((a, b) => b[1] - a[1])[0] || [];
  const valores = new Map(filasTsv(summary).map(f => [f.ACCESSION_NUMBER, Number(f.TABLEVALUETOTAL) || 0]));
  const porCik = new Map();
  for (const f of envios) {
    if (f.PERIODOFREPORT !== periodo) continue;
    const cik = f.CIK.padStart(10, '0');
    porCik.set(cik, Math.max(porCik.get(cik) || 0, valores.get(f.ACCESSION_NUMBER) || 0));
  }
  const lista = [...porCik].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, maximo).map(([cik]) => cik);
  if (!lista.length) throw fallo('El conjunto de datos 13F no trae instituciones.');
  return lista;
}

/**
 * pedir(url, opciones) → JSON o texto · procesar(url, headers, fn) → fn(respuesta HTTP sin leer) · leerTabla(url, coincide) → filas 13F.
 */
export function createDescubrimiento13F({ pedir, procesar, leerTabla, ahora = Date.now }) {
  let ranking = null, rankingPendiente = null;
  const cusips = new Map(); // emisor → { t, lista }

  const rango = (url, valor) => procesar(url, { Range: `bytes=${valor}` }, async res => {
    if (res.status !== 206) {
      await res.body?.cancel?.().catch(() => {}); // sin leer el zip completo
      throw fallo('La SEC no aceptó una descarga parcial del conjunto 13F.');
    }
    return { datos: Buffer.from(await res.arrayBuffer()), total: Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]) };
  });
  async function descargarRanking() {
    const html = await pedir(PAGINA_CONJUNTOS, { respuesta: 'text' });
    const enlace = /href="([^"]+form13f\.zip)"/i.exec(html)?.[1]; // el primero es el más reciente
    if (!enlace) throw fallo('No se encontró el conjunto de datos 13F.');
    const url = new URL(enlace, SEC_WWW);
    if (url.origin !== SEC_WWW) throw fallo('Enlace inesperado del conjunto de datos 13F.');
    const cola = await rango(url.href, `-${COLA_ZIP}`);
    const entradas = directorioZip(cola.datos, cola.total);
    const tabla = async nombre => {
      const e = entradas.find(x => x.nombre.split('/').at(-1).toUpperCase() === nombre);
      if (!e || e.comprimido > MAX_TABLA_ZIP) throw fallo(`El conjunto de datos 13F no trae ${nombre}.`);
      // Encabezado local: 30 bytes + nombre + campos extra (tamaño desconocido: se deja margen).
      const { datos } = await rango(url.href, `${e.posicion}-${e.posicion + e.comprimido + 30 + e.nombre.length + 1024}`);
      return extraerZip(datos, e);
    };
    return rankingDesdeTablas(await tabla('SUBMISSION.TSV'), await tabla('SUMMARYPAGE.TSV'));
  }
  /** CIK de las mayores instituciones, o null si el ranking no está disponible. */
  async function mayores() {
    if (ranking && ahora() - ranking.t < (ranking.fallo ? RANKING_REINTENTO_MS : RANKING_VIGENTE_MS)) return ranking.lista;
    rankingPendiente ||= descargarRanking()
      .then(lista => { ranking = { t: ahora(), lista }; }, () => { ranking = { t: ahora(), lista: ranking?.lista || null, fallo: true }; })
      .finally(() => { rankingPendiente = null; });
    await rankingPendiente;
    return ranking.lista;
  }

  // Tablas 13F-HR (sin enmiendas) que contienen alguna de las frases. Orden: de mayor a menor peso de la frase en la tabla.
  async function buscar({ frases, ciks, desde, hasta, posicion = 0 }) {
    const cuerpo = await pedir(SEC_BUSQUEDA, { query: { q: frases.map(f => `"${f}"`).join(' OR '), forms: '13F-HR', ciks, dateRange: 'custom', startdt: desde, enddt: hasta, from: posicion || undefined } });
    if (!Array.isArray(cuerpo?.hits?.hits)) throw fallo('La búsqueda de EDGAR no devolvió resultados legibles.');
    const tablas = cuerpo.hits.hits.map(h => {
      const s = h._source || {}, [adsh, archivo] = String(h._id).split(':'), cik = s.ciks?.[0];
      return { cik, adsh, archivo, formulario: s.form, tipo: s.file_type, corte: s.period_ending, publicada: s.file_date,
        nombre: String(s.display_names?.[0] || cik).split(/\s+\((?:CIK|[A-Z.-]+[,)])/)[0].trim(),
        url: `${SEC_WWW}/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, '')}/${archivo}` };
    }).filter(t => t.formulario === '13F-HR' && t.tipo === 'INFORMATION TABLE' && /^\d{10}$/.test(t.cik || '') && /^[\d-]+$/.test(t.adsh) && /^[\w.-]+$/.test(t.archivo || ''));
    return { total: cuerpo.hits.total?.value || 0, tablas };
  }
  async function buscarTodas(filtro) {
    const salida = [];
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const { total, tablas } = await buscar({ ...filtro, posicion: pagina * TAMANO_PAGINA });
      salida.push(...tablas);
      if ((pagina + 1) * TAMANO_PAGINA >= total) break;
    }
    return salida;
  }
  // Presentaciones de un corte: del día siguiente al cierre hasta el siguiente cierre (plazo legal: 45 días).
  const ventana = corte => ({ desde: iso(Date.parse(corte) + DIA), hasta: iso(Math.min(ahora(), Date.parse(corte) + 91 * DIA)) });

  /** CUSIP de las acciones del emisor (todas sus clases), deducidos de las propias tablas 13F. */
  async function cusipsDe(nombreEmisor) {
    const clave = claveEmisor(nombreEmisor), previo = cusips.get(clave);
    if (previo && ahora() - previo.t < CUSIP_VIGENTE_MS) return previo.lista;
    const { tablas } = await buscar({ frases: [fraseEmisor(nombreEmisor)], desde: iso(ahora() - 140 * DIA), hasta: iso(ahora()) });
    const bases = new Map(); // emisor (6 primeros caracteres) → { tablas, cusips }
    let leidas = 0, error = null;
    for (const t of tablas.slice(0, TABLAS_PARA_CUSIP)) {
      try {
        const filas = (await leerTabla(t.url, f => claveEmisor(f.nombreEmisor) === clave))
          .filter(f => /^[0-9A-Z]{9}$/.test(f.cusip) && !f.putCall && f.tipoCantidad !== 'PRN' && !/\b(PFD|PREF|WTS?\b|WARRANT|RIGHT|UNIT|NOTE|DEB)/i.test(f.clase || ''));
        for (const base of new Set(filas.map(f => f.cusip.slice(0, 6)))) {
          const b = bases.get(base) || { tablas: 0, cusips: new Set() };
          b.tablas += 1;
          filas.filter(f => f.cusip.startsWith(base)).forEach(f => b.cusips.add(f.cusip));
          bases.set(base, b);
        }
        if (filas.length) leidas += 1;
      } catch (e) { error = e; }
      if (leidas >= 3) break;
    }
    const [mejor] = [...bases.values()].sort((a, b) => b.tablas - a.tablas);
    if (!mejor) throw error || fallo(`No se encontró a ${nombreEmisor} en las tablas 13F recientes.`, 'NO_ENCONTRADO');
    const lista = [...mejor.cusips].sort();
    cusips.set(clave, { t: ahora(), lista });
    if (cusips.size > 1000) cusips.delete(cusips.keys().next().value);
    return lista;
  }

  // Una tabla por institución para un corte (la más reciente si presentó varias).
  function porInstitucion(tablas, corte) {
    const mapa = new Map();
    for (const t of tablas) if (t.corte === corte && !(mapa.get(t.cik)?.publicada >= t.publicada)) mapa.set(t.cik, t);
    return mapa;
  }
  // Sin ranking: de las tablas más largas (menor peso relativo del valor: al final del orden de la búsqueda) se lee el valor total
  // declarado en su portada (documentos de pocos KB) y se ordenan por él. Vale un día.
  let aproximada = null;
  async function aproximarMayores(frases, corte) {
    if (aproximada && ahora() - aproximada.t < DIA) return aproximada.lista;
    const filtro = { frases, ...ventana(corte) };
    const { total } = await buscar(filtro);
    const ultima = Math.max(0, Math.min(total, VENTANA_BUSQUEDA) - TAMANO_PAGINA), tablas = [];
    for (const posicion of new Set([ultima, Math.max(0, ultima - TAMANO_PAGINA)])) tablas.push(...(await buscar({ ...filtro, posicion })).tablas.reverse());
    const candidatas = [...porInstitucion(tablas, corte).values()].slice(0, MAX_PORTADAS);
    const valores = new Map();
    for (const t of candidatas) {
      try {
        const portada = await pedir(t.url.replace(/[^/]+$/, 'primary_doc.xml'), { respuesta: 'text' });
        valores.set(t.cik, Number(/<(?:\w+:)?tableValueTotal>\s*(\d+)/i.exec(portada)?.[1]) || 0);
      } catch { /* sin portada: queda fuera */ }
    }
    const lista = [...valores].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_RANKING).map(([cik]) => cik);
    if (!lista.length) throw fallo('La SEC no entregó datos para elegir instituciones 13F.');
    aproximada = { t: ahora(), lista };
    return lista;
  }

  /** Instituciones que reportan el valor: { cusips, cortes: [{ corte, tablas }], datosFaltantes }. */
  async function tenedores({ nombreEmisor, cusip, cortes = 2 }) {
    const lista = cusip ? [String(cusip).trim().toUpperCase()] : await cusipsDe(nombreEmisor);
    const trimestres = cortesTrimestrales(cortes + 1, ahora());
    const datosFaltantes = [];
    let ciks = await mayores();
    if (!ciks) {
      datosFaltantes.push('ranking de instituciones de la SEC no disponible: panel aproximado con las instituciones de tablas más extensas');
      ciks = await aproximarMayores(lista, trimestres[1]);
    }
    const porCorte = [];
    for (const corte of trimestres) porCorte.push({ corte, mapa: porInstitucion(await buscarTodas({ frases: lista, ciks, ...ventana(corte) }), corte) });
    // Plazo de 45 días: un trimestre con menos de la mitad de las presentaciones del anterior aún no es comparable.
    if (porCorte[0].mapa.size < porCorte[1].mapa.size / 2) {
      const [nuevo] = porCorte.splice(0, 1);
      if (nuevo.mapa.size) datosFaltantes.push(`corte ${nuevo.corte} aún incompleto (${nuevo.mapa.size} de ${porCorte[0].mapa.size} instituciones)`);
    }
    const elegidos = porCorte.slice(0, cortes);
    const panel = ciks.filter(cik => elegidos.some(c => c.mapa.has(cik))).slice(0, MAX_PANEL);
    return { cusips: lista, datosFaltantes, cortes: elegidos.map(c => ({ corte: c.corte, tablas: panel.filter(k => c.mapa.has(k)).map(k => c.mapa.get(k)) })).filter(c => c.tablas.length) };
  }

  return { mayores, cusipsDe, tenedores };
}
