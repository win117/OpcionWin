const LOCALE = 'es-MX';
const cache = new Map();
function nf(options) {
  const key = JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(LOCALE, options));
  return cache.get(key);
}
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
export const EMPTY = '—';

export function fmtNum(value, digits = 2) {
  return isNum(value) ? nf({ minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value) : EMPTY;
}
export function fmtFixed(value, digits = 2) {
  return isNum(value) ? nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : EMPTY;
}
export function fmtMoney(value, digits = 2) {
  return isNum(value) ? nf({ style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : EMPTY;
}
/** Cifras grandes sin ambigüedad: «3.98 billones» (10¹²), «245.1 mil M» (10⁹), «52.3 M», «18.4 mil». */
export function fmtCompact(value) {
  if (!isNum(value)) return EMPTY;
  const a = Math.abs(value), con = (d, unidad) => fmtNum(value / d, 2) + ' ' + unidad;
  if (a >= 1e12) return con(1e12, Math.round(a / 1e10) === 100 ? 'billón' : 'billones');
  if (a >= 1e9) return con(1e9, 'mil M');
  if (a >= 1e6) return con(1e6, 'M');
  return a >= 1e4 ? con(1e3, 'mil') : fmtNum(value, 2);
}
export function fmtInt(value) {
  return isNum(value) ? nf({ maximumFractionDigits: 0 }).format(value) : EMPTY;
}
/** Fracción 0..1 → porcentaje. */
export function fmtPct(value, digits = 0) {
  return isNum(value) ? nf({ style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value) : EMPTY;
}
export function fmtSigned(value, digits = 2) {
  return isNum(value) ? nf({ signDisplay: 'exceptZero', maximumFractionDigits: digits }).format(value) : EMPTY;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Fecha calendario (UTC, para vencimientos y periodos). */
export function fmtDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : EMPTY;
}
/** Fecha y hora local del usuario. */
export function fmtDateTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : EMPTY;
}

/** Hora local corta, con el día si no es hoy: «07:30» o «mar 07:30». */
export function fmtHoraCorta(value, ahora = new Date()) {
  const d = toDate(value);
  if (!d) return EMPTY;
  const hora = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return d.toDateString() === ahora.toDateString() ? hora : `${d.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '')} ${hora}`;
}

/** Valor de métrica con su unidad. */
export function fmtMetric(valor, unidad) {
  if (!isNum(valor)) return EMPTY;
  const u = (unidad || '').toLowerCase();
  if (u === 'usd') return Math.abs(valor) >= 1e6 ? 'US$ ' + fmtCompact(valor) : fmtMoney(valor);
  if (u === '%' || u === 'porcentaje') return fmtNum(valor, 2) + ' %';
  if (u === 'fraccion' || u === 'fracción') return fmtPct(valor, 1);
  if (Math.abs(valor) >= 1e6) return fmtCompact(valor) + (unidad ? ' ' + unidad : '');
  return fmtNum(valor, 4) + (unidad ? ' ' + unidad : '');
}

export function shortId(id) {
  return id ? String(id).slice(0, 8) : EMPTY;
}
