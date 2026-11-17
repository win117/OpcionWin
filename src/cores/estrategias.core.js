// Estrategias: validación de patas y perfil de pago al vencimiento (contrato §3).
// Convenciones: `precio` = prima por acción; montos = por acción × cantidad × multiplicador.
// prima_neta > 0 = crédito recibido; < 0 = débito pagado. perdida_maxima se expresa como monto positivo.
import { esNumero, round, tiempo } from './util.js';

export const VERSION = 'estrategias@1.0.0';
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];

const signo = c => (c.accion === 'buy' ? 1 : -1);
const valorIntrinseco = (c, precio) => (c.tipo === 'call' ? Math.max(0, precio - c.strike) : Math.max(0, c.strike - precio));

/** Resultado al vencimiento (en dinero) para un precio final del subyacente. Requiere precios en todas las patas. */
export const payoff = (componentes, precioFinal, multiplicador = 100) =>
  componentes.reduce((acc, c) => acc + signo(c) * (valorIntrinseco(c, precioFinal) - c.precio) * c.cantidad * multiplicador, 0);

const validarComponente = (c, i) => {
  const e = [];
  const p = `componentes[${i}]`;
  if (!c || typeof c !== 'object') return [`${p}: componente inválido.`];
  if (!['call', 'put'].includes(c.tipo)) e.push(`${p}.tipo debe ser call o put.`);
  if (!['buy', 'sell'].includes(c.accion)) e.push(`${p}.accion debe ser buy o sell.`);
  if (!esNumero(c.strike) || c.strike <= 0) e.push(`${p}.strike debe ser un número positivo.`);
  if (!Number.isSafeInteger(c.cantidad) || c.cantidad <= 0) e.push(`${p}.cantidad debe ser un entero positivo.`);
  if (tiempo(c.vencimiento) == null) e.push(`${p}.vencimiento inválido.`);
  if (c.precio != null && (!esNumero(c.precio) || c.precio < 0)) e.push(`${p}.precio debe ser un número no negativo.`);
  return e;
};

/** Valida la estructura de la estrategia; devuelve lista de errores (vacía si es válida). */
export const validar = (estrategia, componentes) => {
  if (!ESTRATEGIAS.includes(estrategia)) return [`Estrategia no soportada: ${estrategia}.`];
  if (!Array.isArray(componentes)) return ['componentes debe ser un arreglo.'];
  const errores = componentes.flatMap(validarComponente);
  if (errores.length) return errores;
  if (estrategia === 'LONG_CALL' || estrategia === 'LONG_PUT') {
    const tipo = estrategia === 'LONG_CALL' ? 'call' : 'put';
    if (componentes.length !== 1) return [`${estrategia} requiere exactamente 1 componente.`];
    const [c] = componentes;
    if (c.tipo !== tipo || c.accion !== 'buy') errores.push(`${estrategia} requiere comprar (buy) un ${tipo}.`);
    return errores;
  }
  // IRON_CONDOR
  if (componentes.length !== 4) return ['IRON_CONDOR requiere exactamente 4 componentes.'];
  const venc = new Set(componentes.map(c => tiempo(c.vencimiento)));
  if (venc.size !== 1) errores.push('IRON_CONDOR requiere el mismo vencimiento en las 4 patas.');
  if (new Set(componentes.map(c => c.cantidad)).size !== 1) errores.push('IRON_CONDOR requiere cantidades iguales en las 4 patas.');
  const buscar = (tipo, accion) => componentes.filter(c => c.tipo === tipo && c.accion === accion);
  const pb = buscar('put', 'buy'), ps = buscar('put', 'sell'), cs = buscar('call', 'sell'), cb = buscar('call', 'buy');
  if ([pb, ps, cs, cb].some(x => x.length !== 1)) {
    errores.push('IRON_CONDOR requiere: 1 put comprado, 1 put vendido, 1 call vendido y 1 call comprado.');
    return errores;
  }
  const [k1, k2, k3, k4] = [pb[0].strike, ps[0].strike, cs[0].strike, cb[0].strike];
  if (!(k1 < k2 && k2 < k3 && k3 < k4)) errores.push(`Strikes deben cumplir put comprado < put vendido < call vendido < call comprado (recibido ${k1}, ${k2}, ${k3}, ${k4}).`);
  return errores;
};

const m = (nombre, valor, unidad = 'USD') => ({ nombre, valor: valor == null ? null : round(valor), unidad });

export function evaluarConfiguracion(input = {}) {
  const { estrategia, componentes = [], precioSubyacente } = input;
  const multiplicador = esNumero(input.multiplicador) && input.multiplicador > 0 ? input.multiplicador : 100;
  const errores = validar(estrategia, componentes);
  const motivos = [];
  const metricas = [];
  if (errores.length) return { valida: false, errores, metricas, motivos: ['Configuración inválida: no se calculan métricas.'] };

  // Delta neta (equivalente en acciones) si todas las patas traen delta.
  const deltas = componentes.map(c => (esNumero(c.delta) ? c.delta : c.griegas && esNumero(c.griegas.delta) ? c.griegas.delta : null));
  if (deltas.every(d => d != null)) {
    metricas.push(m('delta_neta', componentes.reduce((a, c, i) => a + signo(c) * deltas[i] * c.cantidad * multiplicador, 0), 'acciones'));
  }

  if (!componentes.every(c => esNumero(c.precio))) {
    motivos.push('Faltan precios de prima en alguna pata: no se calculan prima, pérdida, ganancia ni breakevens.');
    return { valida: true, errores, metricas, motivos };
  }

  const q = componentes[0].cantidad;
  const primaNeta = componentes.reduce((a, c) => a - signo(c) * c.precio * c.cantidad * multiplicador, 0);
  metricas.push(m('prima_neta', primaNeta));

  if (estrategia === 'LONG_CALL') {
    const [c] = componentes;
    metricas.push(m('perdida_maxima', c.precio * q * multiplicador), m('ganancia_maxima', null), m('breakeven', c.strike + c.precio, 'precio'));
    motivos.push('Long call: pérdida limitada a la prima; ganancia ilimitada (ganancia_maxima = null).');
  } else if (estrategia === 'LONG_PUT') {
    const [c] = componentes;
    metricas.push(m('perdida_maxima', c.precio * q * multiplicador), m('ganancia_maxima', Math.max(0, c.strike - c.precio) * q * multiplicador), m('breakeven', c.strike - c.precio, 'precio'));
    motivos.push('Long put: pérdida limitada a la prima; ganancia máxima si el subyacente llega a 0.');
  } else {
    const get = (tipo, accion) => componentes.find(c => c.tipo === tipo && c.accion === accion);
    const k1 = get('put', 'buy').strike, k2 = get('put', 'sell').strike, k3 = get('call', 'sell').strike, k4 = get('call', 'buy').strike;
    const credito = primaNeta / (q * multiplicador); // por acción
    const ancho = Math.max(k2 - k1, k4 - k3);
    metricas.push(
      m('ganancia_maxima', credito * q * multiplicador),
      m('perdida_maxima', (ancho - credito) * q * multiplicador),
      m('breakeven_inferior', k2 - credito, 'precio'),
      m('breakeven_superior', k3 + credito, 'precio'),
      m('ancho_alas', ancho, 'precio'),
    );
    if (credito <= 0) motivos.push('Advertencia: el Iron Condor no genera crédito neto; la estructura no tiene ganancia posible.');
    else motivos.push(`Iron Condor con crédito ${credito.toFixed(2)} por acción; zona de ganancia entre ${(k2 - credito).toFixed(2)} y ${(k3 + credito).toFixed(2)}.`);
  }

  if (esNumero(precioSubyacente) && precioSubyacente > 0) {
    metricas.push(m('resultado_vencimiento_precio_actual', payoff(componentes, precioSubyacente, multiplicador)));
  }
  return { valida: true, errores, metricas, motivos };
}

export const evaluar = evaluarConfiguracion;
