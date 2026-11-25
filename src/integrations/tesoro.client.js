// Tesoro de EE. UU.: rendimiento diario de las letras (4 a 52 semanas). Público, sin clave. Es la tasa libre de riesgo de los cálculos.
// Documentación: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_bill_rates
import { IntegrationError } from './errors';
import { createHttp } from './http';

const PROVEEDOR = 'tesoro';
const URL_BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all';
const COLUMNA = /^(\d+) WEEKS? COUPON EQUIVALENT$/i;

// CSV (la primera fila es el día más reciente) → { fecha: 'AAAA-MM-DD', puntos: [{ dias, tasa }] } o null si no trae datos.
export const parsearCurva = csv => {
  const [cabecera, ...filas] = String(csv ?? '').trim().split(/\r?\n/).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
  const columnas = (cabecera || []).map((c, i) => ({ i, semanas: Number(COLUMNA.exec(c)?.[1]) })).filter(c => c.semanas);
  for (const f of filas) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f[0] || '');
    const puntos = columnas.filter(c => f[c.i] && Number.isFinite(Number(f[c.i]))).map(c => ({ dias: c.semanas * 7, tasa: Number(f[c.i]) / 100 })).sort((a, b) => a.dias - b.dias);
    if (m && puntos.length) return { fecha: `${m[3]}-${m[1]}-${m[2]}`, puntos };
  }
  return null;
};

export const createTesoroClient = ({ fetch: fetchFn = globalThis.fetch, timeoutMs, esperar, ahora = Date.now } = {}) => {
  const http = createHttp({ proveedor: PROVEEDOR, fetch: fetchFn, timeoutMs, esperar });
  const mes = async t => {
    const d = new Date(t), aaaamm = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return parsearCurva(await http.request({ url: `${URL_BASE}/${aaaamm}`, query: { type: 'daily_treasury_bill_rates', field_tdr_date_value_month: aaaamm, _format: 'csv' }, respuesta: 'text' }));
  };
  // El primer día hábil del mes aún no hay filas: se usa el mes anterior.
  const curva = async () => {
    const t = ahora(), d = new Date(t);
    const r = await mes(t) || await mes(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    if (!r) throw new IntegrationError({ proveedor: PROVEEDOR, codigo: 'PROVEEDOR', mensaje: 'El Tesoro de EE. UU. no entregó las tasas en un formato reconocido.' });
    return r;
  };
  return { proveedor: PROVEEDOR, configurado: true, curva };
};
