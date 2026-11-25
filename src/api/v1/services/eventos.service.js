// Eventos de una empresa que cambian el riesgo de una opción: dividendos y divisiones (Alpaca) y reportes de resultados (SEC).
// Nada se guarda: se consulta y queda unas horas en memoria. Cada fuente falla por separado y queda escrita en `faltantes`.
import { diaNY } from './mercado-reloj.service';

const DIA = 86400000, VIGENCIA_MS = 6 * 3600000, VIGENCIA_PARCIAL_MS = 10 * 60000;
const MARGEN_MIN = 4, MARGEN_MAX = 14; // días. En 186 reportes medidos: mediana 0, 80 % ≤ 4, 95 % ≤ 8.
const SEPARACION_MIN = 45; // dos 8-K de resultados a menos de 45 días son el mismo trimestre (adelantos, correcciones)
const ms = f => Date.parse(f + 'T00:00:00Z');
const dia = t => new Date(t).toISOString().slice(0, 10);

/**
 * Próximo reporte a partir de los anteriores (AAAA-MM-DD): mismo trimestre del año pasado + 364 días (conserva el día de la semana).
 * El margen sale de cuánto se movió la propia empresa los últimos trimestres. null con menos de cuatro reportes.
 */
export function estimarReporte(fechas, hoy) {
  const lista = [];
  for (const f of [...new Set(fechas)].filter(x => Number.isFinite(ms(x)) && x <= hoy).sort()) {
    if (!lista.length || ms(f) - ms(lista.at(-1)) >= SEPARACION_MIN * DIA) lista.push(f);
  }
  if (lista.length < 4) return null;
  const ultimo = lista.at(-1);
  if (ms(hoy) - ms(ultimo) > 200 * DIA) return null; // dejó de reportar
  const errores = lista.slice(4).map((f, i) => Math.abs(Math.round((ms(f) - ms(lista[i])) / DIA) - 364)).slice(-4);
  const margen = Math.min(MARGEN_MAX, Math.max(MARGEN_MIN, ...errores));
  const fecha = lista.slice(-4).map(f => dia(ms(f) + 364 * DIA))
    .filter(f => ms(f) - ms(ultimo) >= SEPARACION_MIN * DIA && ms(f) + margen * DIA >= ms(hoy)).sort()[0];
  return fecha ? { fecha, desde: dia(Math.max(ms(hoy), ms(fecha) - margen * DIA)), hasta: dia(ms(fecha) + margen * DIA), margen, estimada: true } : null;
}

export function createEventos({ integraciones, ahora = Date.now } = {}) {
  const cache = new Map(), pendientes = new Map();
  async function consultar(simbolo) {
    const hoy = diaNY(ahora()), faltantes = [];
    const parte = async (nombre, fn) => {
      try { return await fn(); } catch (e) { faltantes.push(`${nombre}: ${e?.mensaje || 'sin respuesta'}`); return null; }
    };
    const [acciones, reportes] = await Promise.all([
      parte('dividendos', () => integraciones.alpaca.accionesCorporativas(simbolo, { desde: dia(ms(hoy) - 400 * DIA), hasta: dia(ms(hoy) + 180 * DIA) })),
      parte('resultados', async () => integraciones.sec.reportesResultados((await integraciones.sec.cikDeSimbolo(simbolo)).cik)),
    ]);
    const dividendos = acciones?.dividendos || [], futuros = dividendos.filter(d => d.exFecha >= hoy);
    const anual = dividendos.filter(d => !d.especial && d.exFecha < hoy && ms(hoy) - ms(d.exFecha) <= 365 * DIA).reduce((a, d) => a + d.monto, 0);
    return {
      simbolo, consultadoEn: new Date(ahora()),
      dividendos: acciones && { proximos: futuros, ultimo: dividendos.filter(d => d.exFecha < hoy).at(-1) || null, anualPorAccion: Math.round(anual * 1e4) / 1e4 },
      divisiones: acciones && acciones.divisiones.filter(d => d.exFecha >= hoy),
      reportes: reportes && { ultimos: reportes.slice(-4).reverse(), proximo: estimarReporte(reportes, hoy) },
      faltantes, fuentes: ['Alpaca: solo dividendos ya anunciados', 'SEC: 8-K punto 2.02; la próxima fecha es una estimación'],
    };
  }
  return async function eventos(simbolo) {
    const c = cache.get(simbolo);
    if (c && ahora() < c.expira) return c.dato;
    if (!pendientes.has(simbolo)) {
      pendientes.set(simbolo, consultar(simbolo).then(dato => {
        cache.set(simbolo, { dato, expira: ahora() + (dato.faltantes.length ? VIGENCIA_PARCIAL_MS : VIGENCIA_MS) });
        if (cache.size > 600) cache.delete(cache.keys().next().value);
        return dato;
      }).finally(() => pendientes.delete(simbolo)));
    }
    return pendientes.get(simbolo);
  };
}
