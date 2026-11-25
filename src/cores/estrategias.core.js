// Estrategias: validación de patas y perfil de pago al vencimiento (contrato §3).
// Convenciones: `precio` = prima por acción; montos = por acción × cantidad × multiplicador.
// prima_neta > 0 = crédito recibido; < 0 = débito pagado. perdida_maxima se expresa como monto positivo.
import { DIA_MS, esNumero, round, tiempo } from './util.js';
import { DIAS_ANIO, opcion, probabilidadSobre, TASA_LIBRE_RIESGO, volatilidadImplicita } from './blackscholes.js';

export const VERSION = 'estrategias@1.2.0';
// Hora UTC aproximada del vencimiento: las opciones de acciones de EE. UU. dejan de cotizar a las 16:00 ET
// (20:00 UTC en horario de verano, 21:00 UTC en invierno; la diferencia de 1 h es despreciable para T).
export const HORA_VENCIMIENTO_UTC = 20;
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];

const signo = c => (c.accion === 'buy' ? 1 : -1);
const valorIntrinseco = (c, precio) => (c.tipo === 'call' ? Math.max(0, precio - c.strike) : Math.max(0, c.strike - precio));

/** Resultado al vencimiento (en dinero) para un precio final del subyacente. Requiere precios en todas las patas. */
export const payoff = (componentes, precioFinal, multiplicador = 100) =>
  componentes.reduce((acc, c) => acc + signo(c) * (valorIntrinseco(c, precioFinal) - c.precio) * c.cantidad * multiplicador, 0);

// Tolerancia en dinero para decidir si un vértice del payoff vale cero.
const CERO = 1e-6;

/**
 * Riesgo al vencimiento de CUALQUIER conjunto de patas. El payoff es lineal por tramos: basta evaluarlo en 0, en cada
 * strike y conocer la pendiente a la derecha del último. Devuelve { gananciaMaxima, perdidaMaxima, breakevens };
 * null = ilimitada; perdidaMaxima es positiva (0 si nunca se pierde).
 */
export const perfilVencimiento = (componentes, multiplicador = 100) => {
  const nodos = [0, ...new Set(componentes.map(c => c.strike))].sort((a, b) => a - b);
  const v = nodos.map(x => payoff(componentes, x, multiplicador));
  const pendiente = componentes.filter(c => c.tipo === 'call').reduce((a, c) => a + signo(c) * c.cantidad * multiplicador, 0);
  const cero = x => Math.abs(x) < CERO;
  const breakevens = [];
  nodos.forEach((x, i) => {
    const ultimo = i === nodos.length - 1;
    const derecha = ultimo ? v[i] + pendiente : v[i + 1]; // a la derecha del último strike basta el signo de la pendiente
    // Un vértice en cero es breakeven salvo dentro de una meseta de cero.
    if (cero(v[i])) { if (x > 0 && !(cero(v[i - 1]) && cero(derecha))) breakevens.push(x); return; }
    if (ultimo) { if (pendiente !== 0 && Math.sign(v[i]) !== Math.sign(pendiente)) breakevens.push(x - v[i] / pendiente); return; }
    if (!cero(v[i + 1]) && Math.sign(v[i]) !== Math.sign(v[i + 1])) breakevens.push(x + ((nodos[i + 1] - x) * -v[i]) / (v[i + 1] - v[i]));
  });
  return {
    gananciaMaxima: pendiente > 0 ? null : Math.max(...v),
    perdidaMaxima: pendiente < 0 ? null : Math.max(0, -Math.min(...v)),
    breakevens,
  };
};

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
  if (new Set(componentes.map(c => c.multiplicador ?? null)).size > 1) return ['Todas las patas deben tener el mismo multiplicador de contrato.'];
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

/** Años hasta el vencimiento (días naturales / 365) desde fechaReferencia; null si no hay fecha o ya venció. */
export const anosHastaVencimiento = (vencimiento, fechaReferencia) => {
  const ref = tiempo(fechaReferencia);
  const v = tiempo(vencimiento);
  if (ref == null || v == null) return null;
  const d = new Date(v);
  const cierre = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HORA_VENCIMIENTO_UTC);
  const T = (cierre - ref) / (DIAS_ANIO * DIA_MS);
  return T > 0 ? T : null;
};

const ivDe = c => (esNumero(c.volatilidadImplicita) && c.volatilidadImplicita > 0 ? c.volatilidadImplicita : null);

/**
 * Métricas de Black-Scholes (blackscholes.js) por configuración. Requiere precioSubyacente > 0, fechaReferencia y,
 * según la métrica, IV y prima de las patas. Probabilidades neutrales al riesgo (deriva r), lognormales, al vencimiento.
 */
const metricasBlackScholes = ({ estrategia, componentes, S, fechaReferencia, r, multiplicador, metricas, motivos }) => {
  if (!(esNumero(S) && S > 0)) { motivos.push('Sin precio del subyacente: no se calculan métricas de Black-Scholes.'); return; }
  const T = anosHastaVencimiento(componentes[0].vencimiento, fechaReferencia);
  if (T == null) { motivos.push('Sin fecha de referencia o vencimiento ya cumplido: no se calculan métricas de Black-Scholes.'); return; }
  metricas.push(m('anos_al_vencimiento', T, 'anios'));
  const ivs = componentes.map(ivDe);
  const bs = componentes.map((c, i) => (ivs[i] == null ? null : opcion({ tipo: c.tipo, S, K: c.strike, T, r, sigma: ivs[i] })));

  // Verificación independiente de la delta del proveedor (indicativa de Alpaca).
  if (bs.every(Boolean)) {
    metricas.push(m('delta_neta_bs', componentes.reduce((a, c, i) => a + signo(c) * bs[i].delta * c.cantidad * multiplicador, 0), 'acciones'));
    if (componentes.every(c => esNumero(c.precio))) {
      metricas.push(m('prima_neta_teorica_bs', componentes.reduce((a, c, i) => a - signo(c) * bs[i].precio * c.cantidad * multiplicador, 0)));
    }
  } else motivos.push('Alguna pata no trae volatilidad implícita: no se calcula delta ni probabilidad con Black-Scholes.');
  const difDelta = componentes.map((c, i) => {
    const dProv = esNumero(c.delta) ? c.delta : c.griegas && esNumero(c.griegas.delta) ? c.griegas.delta : null;
    return bs[i] && dProv != null ? Math.abs(bs[i].delta - dProv) : null;
  }).filter(v => v != null);
  if (difDelta.length) metricas.push(m('diferencia_delta_max', Math.max(...difDelta), 'delta'));
  // IV recalculada desde la prima media (bid+ask)/2 frente a la IV del proveedor.
  const difIv = componentes.map((c, i) => {
    if (ivs[i] == null || !esNumero(c.precio)) return null;
    const iv = volatilidadImplicita({ tipo: c.tipo, precio: c.precio, S, K: c.strike, T, r });
    return iv == null ? null : Math.abs(iv - ivs[i]);
  }).filter(v => v != null);
  if (difIv.length) metricas.push(m('diferencia_iv_max', Math.max(...difIv), 'fraccion_anual'));

  // Probabilidad de ganancia al vencimiento (P[S_T en la zona de ganancia]).
  if (!componentes.every(c => esNumero(c.precio))) return;
  const sobre = (X, sigma) => (sigma == null ? null : probabilidadSobre({ S, X, T, r, sigma }));
  let pop;
  if (estrategia === 'LONG_CALL') pop = sobre(componentes[0].strike + componentes[0].precio, ivs[0]);
  else if (estrategia === 'LONG_PUT') {
    const p = sobre(componentes[0].strike - componentes[0].precio, ivs[0]);
    pop = p == null ? null : 1 - p;
  } else {
    const idx = (tipo, accion) => componentes.findIndex(c => c.tipo === tipo && c.accion === accion);
    const ps = idx('put', 'sell'), cs = idx('call', 'sell');
    const q = componentes[0].cantidad;
    const credito = componentes.reduce((a, c) => a - signo(c) * c.precio * c.cantidad * multiplicador, 0) / (q * multiplicador);
    if (credito <= 0) pop = 0;
    else {
      // Cada breakeven usa la IV de la pata vendida más cercana (aproxima la sonrisa de volatilidad).
      // Un ala más angosta que el crédito no tiene breakeven de ese lado: todo ese lado es ganancia.
      const alaPut = componentes[ps].strike - componentes[idx('put', 'buy')].strike;
      const alaCall = componentes[idx('call', 'buy')].strike - componentes[cs].strike;
      const pInf = alaPut < credito - 1e-9 ? 1 : sobre(componentes[ps].strike - credito, ivs[ps]);
      const pSup = alaCall < credito - 1e-9 ? 0 : sobre(componentes[cs].strike + credito, ivs[cs]);
      pop = pInf == null || pSup == null ? null : Math.min(1, Math.max(0, pInf - pSup));
    }
  }
  if (pop != null) {
    metricas.push(m('probabilidad_ganancia', pop, 'fraccion'));
    motivos.push(`Probabilidad de ganancia al vencimiento ${(pop * 100).toFixed(1)} % (Black-Scholes lognormal, neutral al riesgo, r = ${(r * 100).toFixed(1)} %, IV de las patas).`);
  }
};

export function evaluarConfiguracion(input = {}) {
  const { estrategia, componentes = [], precioSubyacente } = input;
  const delContrato = Array.isArray(componentes) ? componentes[0]?.multiplicador : undefined;
  const multiplicador = [delContrato, input.multiplicador].find(v => esNumero(v) && v > 0) ?? 100;
  const tasa = esNumero(input.tasaLibreRiesgo) ? input.tasaLibreRiesgo : TASA_LIBRE_RIESGO;
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
    metricasBlackScholes({ estrategia, componentes, S: precioSubyacente, fechaReferencia: input.fechaReferencia, r: tasa, multiplicador, metricas, motivos });
    return { valida: true, errores, metricas, motivos };
  }

  const q = componentes[0].cantidad;
  const primaNeta = componentes.reduce((a, c) => a - signo(c) * c.precio * c.cantidad * multiplicador, 0);
  metricas.push(m('prima_neta', primaNeta));

  const riesgo = perfilVencimiento(componentes, multiplicador);
  metricas.push(m('perdida_maxima', riesgo.perdidaMaxima), m('ganancia_maxima', riesgo.gananciaMaxima));

  if (estrategia === 'LONG_CALL' || estrategia === 'LONG_PUT') {
    metricas.push(...riesgo.breakevens.map(b => m('breakeven', b, 'precio')));
    motivos.push(estrategia === 'LONG_CALL'
      ? 'Long call: pérdida limitada a la prima; ganancia ilimitada (ganancia_maxima = null).'
      : 'Long put: pérdida limitada a la prima; ganancia máxima si el subyacente llega a 0.');
    if (!riesgo.breakevens.length) motivos.push('Advertencia: la prima supera el strike; la estructura no tiene ganancia posible.');
  } else {
    const get = (tipo, accion) => componentes.find(c => c.tipo === tipo && c.accion === accion);
    const k1 = get('put', 'buy').strike, k2 = get('put', 'sell').strike, k3 = get('call', 'sell').strike, k4 = get('call', 'buy').strike;
    const credito = primaNeta / (q * multiplicador); // por acción
    const inferior = riesgo.breakevens.find(b => b <= k2), superior = riesgo.breakevens.find(b => b >= k3);
    if (inferior != null) metricas.push(m('breakeven_inferior', inferior, 'precio'));
    if (superior != null) metricas.push(m('breakeven_superior', superior, 'precio'));
    metricas.push(m('ancho_alas', Math.max(k2 - k1, k4 - k3), 'precio'));
    if (credito <= 0) motivos.push('Advertencia: el Iron Condor no genera crédito neto; la estructura no tiene ganancia posible.');
    else motivos.push(`Iron Condor con crédito ${credito.toFixed(2)} por acción; zona de ganancia ${inferior != null ? 'desde ' + inferior.toFixed(2) : 'sin límite inferior'} ${superior != null ? 'hasta ' + superior.toFixed(2) : 'sin límite superior'}.`);
  }

  if (esNumero(precioSubyacente) && precioSubyacente > 0) {
    metricas.push(m('resultado_vencimiento_precio_actual', payoff(componentes, precioSubyacente, multiplicador)));
  }
  metricasBlackScholes({ estrategia, componentes, S: precioSubyacente, fechaReferencia: input.fechaReferencia, r: tasa, multiplicador, metricas, motivos });
  return { valida: true, errores, metricas, motivos };
}

export const evaluar = evaluarConfiguracion;
