// Motor de reglas compartido por los cores (contrato §1).
// criterio = nombre de una métrica del core. Operadores: eq, ne, gt, gte, lt, lte, between.
export const VERSION = 'reglas@1.0.0';
export const OPERADORES = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'];
const TOLERANCIA = 1e-9;
const finito = v => typeof v === 'number' && Number.isFinite(v);

/** Evalúa el operador; null si la regla está mal formada. */
export const comparar = (valor, operador, referencia, superior) => {
  if (!finito(valor) || !finito(referencia)) return null;
  switch (operador) {
    case 'eq': return Math.abs(valor - referencia) <= TOLERANCIA;
    case 'ne': return Math.abs(valor - referencia) > TOLERANCIA;
    case 'gt': return valor > referencia;
    case 'gte': return valor >= referencia - TOLERANCIA;
    case 'lt': return valor < referencia;
    case 'lte': return valor <= referencia + TOLERANCIA;
    case 'between':
      if (!finito(superior) || superior < referencia) return null;
      return valor >= referencia - TOLERANCIA && valor <= superior + TOLERANCIA;
    default: return null;
  }
};

/** Reglas activas (activo !== false) y, si traen `core`, solo las del core indicado. */
export const reglasActivas = (reglas, core) =>
  (Array.isArray(reglas) ? reglas : []).filter(r => r && r.activo !== false && (!core || !r.core || r.core === core));

/** Evalúa cada regla contra las métricas → [{ criterio, cumplida, valor }]. */
export const evaluarReglas = (reglas, metricas, core) => {
  const mapa = new Map();
  for (const m of metricas || []) if (m && finito(m.valor)) mapa.set(m.nombre, m.valor);
  return reglasActivas(reglas, core).map(regla => {
    const valor = mapa.has(regla.criterio) ? mapa.get(regla.criterio) : null;
    const cumplida = valor == null ? null : comparar(valor, regla.operador, regla.valorReferencia, regla.valorSuperior);
    return { regla, criterio: regla.criterio, cumplida, valor };
  });
};

/**
 * Aplica reglas sobre el sesgo base:
 * - puntaje base = 50 + 50·sesgo (null si sesgo null).
 * - No obligatoria: cumplida suma `peso` puntos hacia la dirección del sesgo; incumplida los resta. Acotado a 0..100.
 *   Con sesgo 0 no hay dirección y no se ajusta.
 * - Obligatoria incumplida: puntaje = 50, confianza = 0, motivo explícito.
 * - Métrica inexistente: cumplida null y se agrega a datosFaltantes.
 * El sesgo final se recalcula como (puntaje − 50) / 50 para mantener puntaje = 50 + 50·sesgo.
 */
export const aplicarReglas = ({ sesgo, confianza, metricas, reglas, core }) => {
  const evaluadas = evaluarReglas(reglas, metricas, core);
  const motivos = [];
  const datosFaltantes = [];
  let puntaje = finito(sesgo) ? 50 + 50 * sesgo : null;
  let conf = finito(confianza) ? confianza : 0;
  const direccion = finito(sesgo) ? Math.sign(sesgo) : 0;
  let obligatoriaFallida = false;

  for (const { regla, criterio, cumplida, valor } of evaluadas) {
    if (valor == null) {
      datosFaltantes.push(`metrica:${criterio}`);
      motivos.push(`Regla sobre "${criterio}" no evaluable: la métrica no está disponible.`);
      continue;
    }
    if (cumplida == null) {
      motivos.push(`Regla sobre "${criterio}" mal formada (operador ${regla.operador}); se ignora.`);
      continue;
    }
    if (regla.obligatoria && !cumplida) {
      obligatoriaFallida = true;
      motivos.push(`Regla obligatoria incumplida: ${criterio} ${regla.operador} ${regla.valorReferencia}${regla.operador === 'between' ? `..${regla.valorSuperior}` : ''} (valor ${valor}). Resultado forzado a neutral.`);
      continue;
    }
    const peso = finito(regla.peso) && regla.peso > 0 ? regla.peso : 0;
    if (puntaje != null && direccion !== 0 && peso > 0 && !regla.obligatoria) {
      puntaje += (cumplida ? 1 : -1) * direccion * peso;
      motivos.push(`Regla ${criterio} ${cumplida ? 'cumplida' : 'incumplida'}: ${cumplida ? '+' : '−'}${peso} puntos en la dirección del sesgo.`);
    }
  }

  if (puntaje != null) puntaje = Math.min(100, Math.max(0, puntaje));
  if (obligatoriaFallida) {
    conf = 0;
    if (puntaje != null) puntaje = 50;
  }
  const sesgoFinal = puntaje == null ? null : (puntaje - 50) / 50;
  return {
    puntaje: puntaje == null ? null : Math.round(puntaje * 100) / 100,
    sesgo: sesgoFinal,
    confianza: conf,
    reglas: evaluadas.map(({ criterio, cumplida, valor }) => ({ criterio, cumplida, valor })),
    motivos,
    datosFaltantes,
    obligatoriaFallida,
  };
};
