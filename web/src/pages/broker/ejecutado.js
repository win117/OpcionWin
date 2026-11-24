import { fmtMoney, isNum } from '../../utils/format';

/** Cantidad ejecutada y precio promedio informados por el broker, p. ej. "2 a $1.35". */
export const ejecutado = o => (o.cantidadEjecutada ? o.cantidadEjecutada + (isNum(o.precioPromedioEjecucion) ? ' a ' + fmtMoney(o.precioPromedioEjecucion) : '') : '—');
