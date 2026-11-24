// Catálogo del universo: qué empresas se muestran en el mapa. Nada está escrito en el código; todo se obtiene:
//   Alpaca → activos negociables con opciones, su nombre y su cotización consolidada.
//   SEC    → CIK de cada símbolo, acciones en circulación, valor en manos del público, giro (SIC) y tipo de emisor.
// El universo son las `tamano` empresas de mayor capitalización que presentan reportes trimestrales (10-Q) a la SEC.

const LOTE = 500;
// Conceptos con acciones en circulación, en orden de preferencia (el promedio trimestral suma todas las clases).
const CONCEPTOS_ACCIONES = [
  { concepto: 'us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding', instante: false },
  { concepto: 'us-gaap/WeightedAverageNumberOfSharesOutstandingBasic', instante: false },
  { concepto: 'dei/EntityCommonStockSharesOutstanding', instante: true, debil: true },
  { concepto: 'us-gaap/CommonStockSharesOutstanding', instante: true, debil: true },
];
const TRIMESTRES_ACCIONES = 4;
const TRIMESTRES_FLOTANTE = 9; // el valor en manos del público se reporta una vez al año, con hasta dos años de antigüedad
// Dinero negociado al día / capitalización. Típico ≈ 0.6 %. Fuera de [0.02 %, 50 %] la cifra reportada tiene un error de unidades.
const ROTACION_TIPICA = 0.006, ROTACION_MIN = 0.0002, ROTACION_MAX = 0.5;
// Si acciones × precio y el valor en manos del público difieren más que esto, una de las dos cifras está mal.
const RAZON_MIN = 0.25, RAZON_MAX = 25;

// Últimos n trimestres calendario, del más reciente al más antiguo.
export function trimestres(n, hoy) {
  let a = hoy.getUTCFullYear(), q = Math.floor(hoy.getUTCMonth() / 3) + 1;
  return Array.from({ length: n }, () => { const t = `CY${a}Q${q}`; q -= 1; if (!q) { q = 4; a -= 1; } return t; });
}

// Código SIC → sector en español. Es la división de la propia clasificación SIC (rangos), no datos de empresas.
const RANGOS = [
  ['Salud', [[2833, 2836], [3826, 3826], [3840, 3851], [5047, 5047], [5122, 5122], [5912, 5912], [6324, 6324], [8000, 8099], [8731, 8731]]],
  ['Energía', [[1220, 1221], [1311, 1389], [2911, 2990], [4610, 4619], [4922, 4923], [5171, 5172], [6792, 6792]]],
  ['Servicios públicos', [[4900, 4911], [4924, 4941], [4961, 4991]]],
  ['Inmobiliario', [[6500, 6553], [6798, 6798]]],
  ['Finanzas', [[6000, 6799]]],
  ['Tecnología', [[3570, 3579], [3661, 3679], [7370, 7379]]],
  ['Comunicación', [[2711, 2741], [4812, 4899], [7310, 7319], [7812, 7841], [7990, 7990]]],
  ['Consumo básico', [[100, 299], [2000, 2199], [2840, 2844], [5140, 5149], [5180, 5182], [5331, 5331], [5400, 5411]]],
  ['Consumo discrecional', [[1531, 1531], [2200, 2399], [2510, 2599], [3021, 3021], [3140, 3149], [3630, 3651], [3711, 3716], [3751, 3751], [3940, 3949], [4400, 4400], [4700, 4700], [5200, 5990], [7000, 7011], [7500, 7549], [7900, 7999]]],
  ['Materiales', [[1000, 1099], [1400, 1499], [2400, 2499], [2600, 2699], [2800, 2899], [3200, 3399]]],
  ['Industria y servicios', [[1500, 1799], [2700, 2799], [3000, 3999], [4000, 4799], [4950, 4959], [5000, 5199], [7300, 7399], [8100, 8999]]],
];
export function sectorDeSic(sic) {
  const n = Number(sic);
  if (!Number.isInteger(n) || n <= 0) return 'Sin clasificar';
  for (const [sector, rangos] of RANGOS) if (rangos.some(([a, b]) => n >= a && n <= b)) return sector;
  return 'Otros';
}
// Fondos y vehículos que no son empresas operativas (fideicomisos de materias primas, fondos, cascarones).
const SIC_NO_EMPRESA = new Set([6221, 6726, 6770]);

/** Elige la capitalización creíble entre acciones × precio y valor en manos del público. `acciones` null ⇒ se usa el flotante. */
export function elegirCapitalizacion({ acciones, flotante, precio, dineroDia }) {
  if (!(precio > 0)) return null;
  const opciones = [];
  if (acciones > 0) opciones.push({ acciones, capitalizacion: acciones * precio });
  if (flotante > 0) opciones.push({ acciones: null, capitalizacion: flotante });
  if (!opciones.length) return null;
  const rotacion = o => (dineroDia > 0 ? dineroDia / o.capitalizacion : null);
  const creible = o => { const r = rotacion(o); return r == null || (r >= ROTACION_MIN && r <= ROTACION_MAX); };
  if (opciones.length === 2) {
    const razon = opciones[0].capitalizacion / opciones[1].capitalizacion;
    if (razon >= RAZON_MIN && razon <= RAZON_MAX) return creible(opciones[0]) ? opciones[0] : null;
    const distancia = o => Math.abs(Math.log((rotacion(o) || ROTACION_TIPICA) / ROTACION_TIPICA));
    opciones.sort((a, b) => distancia(a) - distancia(b));
  }
  return creible(opciones[0]) ? opciones[0] : null;
}

export function createCatalogo({ integraciones, ahora = Date.now, tamano = 500 } = {}) {
  const { alpaca, sec } = integraciones;

  async function accionesYFlotante() {
    const hoy = new Date(ahora()), acciones = new Map(), flotante = new Map();
    for (const t of trimestres(TRIMESTRES_ACCIONES, hoy)) {
      for (const { concepto, instante, debil } of CONCEPTOS_ACCIONES) {
        for (const d of await sec.marco({ concepto, unidad: 'shares', periodo: t + (instante ? 'I' : '') })) {
          if (d.valor > 1e5 && !acciones.has(d.cik)) acciones.set(d.cik, { valor: d.valor, debil: Boolean(debil) });
        }
      }
    }
    for (const t of trimestres(TRIMESTRES_FLOTANTE, hoy)) {
      for (const d of await sec.marco({ concepto: 'dei/EntityPublicFloat', unidad: 'USD', periodo: t + 'I' })) {
        if (d.valor > 0 && !flotante.has(d.cik)) flotante.set(d.cik, d.valor);
      }
    }
    return { acciones, flotante };
  }

  return {
    /** Candidatas ordenadas por capitalización (algo más de `tamano`: algunas se descartan al leer su perfil). */
    async construir() {
      const [activos, ciks, { acciones, flotante }] = await Promise.all([alpaca.listarActivos(), sec.tickers(), accionesYFlotante()]);
      const candidatas = [];
      for (const a of activos) {
        if (!a.negociable || !a.opciones) continue;
        const simbolo = String(a.simbolo).toUpperCase(), cik = (ciks.get(simbolo) || ciks.get(simbolo.replace('.', '-')))?.cik;
        if (cik && (acciones.has(cik) || flotante.has(cik))) candidatas.push({ simbolo, nombre: a.nombre, mercado: a.mercado, cik });
      }
      const clases = new Map();
      for (const c of candidatas) clases.set(c.cik, (clases.get(c.cik) || 0) + 1);
      const cotizaciones = {};
      for (let i = 0; i < candidatas.length; i += LOTE) {
        Object.assign(cotizaciones, await alpaca.cotizacionesLote(candidatas.slice(i, i + LOTE).map(c => c.simbolo), { feed: 'delayed_sip' }));
      }
      const salida = [];
      for (const c of candidatas) {
        const q = cotizaciones[c.simbolo], n = clases.get(c.cik), a = acciones.get(c.cik), f = flotante.get(c.cik);
        const precio = q?.cierre ?? q?.ultimo;
        // Varias clases de acciones de la misma empresa: el total reportado se reparte entre ellas.
        const e = elegirCapitalizacion({ acciones: a ? a.valor / n : null, flotante: f ? f / n : null, precio, dineroDia: precio * (q?.volumen || 0) });
        // Sin flotante y solo con acciones de portada suele ser un emisor extranjero: se confirma con su perfil antes de mostrarlo.
        if (e) salida.push({ ...c, acciones: e.acciones, capitalizacion: Math.round(e.capitalizacion), porConfirmar: !f && Boolean(a?.debil) });
      }
      return salida.sort((x, y) => y.capitalizacion - x.capitalizacion).slice(0, Math.ceil(tamano * 1.15));
    },

    /** Giro (SIC) y si es una empresa operativa que presenta 10-Q. */
    async perfil(cik) {
      const p = await sec.perfil(cik);
      return { sic: p.sic, industria: p.industria || 'Sin clasificar', sector: sectorDeSic(p.sic), valida: p.presenta10Q && !SIC_NO_EMPRESA.has(Number(p.sic)) };
    },
  };
}
