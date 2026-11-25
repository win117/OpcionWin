// Tasa libre de riesgo continua para un plazo, a partir de la curva de letras del Tesoro (rendimiento simple anual por plazo).
// Interpolación lineal entre plazos; fuera del rango, el extremo. Función pura: la curva la obtiene el servidor.
const finito = v => typeof v === 'number' && Number.isFinite(v);

export const tasaParaPlazo = (puntos, dias) => {
  const p = (Array.isArray(puntos) ? puntos : []).filter(x => finito(x?.dias) && x.dias > 0 && finito(x?.tasa)).sort((a, b) => a.dias - b.dias);
  if (!p.length || !finito(dias) || dias <= 0) return null;
  const i = p.findIndex(x => x.dias >= dias);
  let simple;
  if (i === 0) simple = p[0].tasa;
  else if (i < 0) simple = p.at(-1).tasa;
  else simple = p[i - 1].tasa + ((p[i].tasa - p[i - 1].tasa) * (dias - p[i - 1].dias)) / (p[i].dias - p[i - 1].dias);
  const T = dias / 365;
  return Math.log(1 + simple * T) / T;
};

/** Rendimiento continuo por dividendo a partir de lo pagado por acción en un año. Sin datos: 0. */
export const rendimientoDividendo = (anualPorAccion, precio) =>
  (finito(anualPorAccion) && anualPorAccion > 0 && finito(precio) && precio > 0 ? Math.log(1 + anualPorAccion / precio) : 0);
