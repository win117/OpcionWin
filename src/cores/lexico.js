// Léxico financiero propio (inglés y español) para el core noticias.
// Puntajes de −2 (muy negativo) a +2 (muy positivo). Claves en minúsculas y sin acentos.
export const VERSION = 'lexico@1.0.0';

export const LEXICO = {
  // Inglés positivo
  beat: 1.5, beats: 1.5, exceed: 1.5, exceeds: 1.5, exceeded: 1.5, surpass: 1.5, surpassed: 1.5,
  record: 1, growth: 1, grow: 1, grows: 1, grew: 1, gain: 1, gains: 1, gained: 1,
  rise: 1, rises: 1, rose: 1, rising: 1, rally: 1.5, rallies: 1.5, surge: 2, surges: 2, surged: 2, soar: 2, soars: 2, soared: 2,
  jump: 1.5, jumps: 1.5, jumped: 1.5, climb: 1, climbs: 1, climbed: 1,
  upgrade: 1.5, upgraded: 1.5, upgrades: 1.5, outperform: 1.5, outperforms: 1.5, buy: 0.5, bullish: 1.5,
  strong: 1, stronger: 1, strength: 1, robust: 1, solid: 0.5, profit: 1, profits: 1, profitable: 1,
  raise: 0.5, raises: 0.5, raised: 0.5, boost: 1, boosts: 1, boosted: 1, expand: 0.5, expands: 0.5, expansion: 0.5,
  approval: 1.5, approved: 1.5, approves: 1.5, win: 1, wins: 1, won: 1, partnership: 0.5, innovative: 0.5,
  dividend: 0.5, buyback: 1, optimistic: 1, optimism: 1, positive: 1, improve: 1, improves: 1, improved: 1, recovery: 1,
  // Inglés negativo
  miss: -1.5, misses: -1.5, missed: -1.5, fall: -1, falls: -1, fell: -1, falling: -1, drop: -1, drops: -1, dropped: -1,
  decline: -1, declines: -1, declined: -1, plunge: -2, plunges: -2, plunged: -2, slump: -1.5, slumps: -1.5, slumped: -1.5,
  tumble: -1.5, tumbles: -1.5, tumbled: -1.5, sink: -1, sinks: -1, sank: -1, crash: -2, crashes: -2, crashed: -2,
  downgrade: -1.5, downgraded: -1.5, downgrades: -1.5, underperform: -1.5, sell: -0.5, bearish: -1.5,
  weak: -1, weaker: -1, weakness: -1, loss: -1, losses: -1, lose: -1, loses: -1, lost: -1,
  cut: -0.5, cuts: -0.5, lawsuit: -1.5, sued: -1.5, probe: -1, investigation: -1, fraud: -2, recall: -1, recalls: -1,
  bankruptcy: -2, default: -1.5, layoffs: -1, layoff: -1, warning: -1, warns: -1, warned: -1, risk: -0.5, risks: -0.5,
  concern: -1, concerns: -1, fear: -1, fears: -1, pessimistic: -1, negative: -1, delay: -1, delayed: -1, halt: -1, halted: -1,
  volatile: -0.5, uncertainty: -1, slowdown: -1, recession: -1.5, fined: -1, penalty: -1, rejected: -1.5,
  // Español positivo
  sube: 1, suben: 1, subio: 1, alza: 1, ganancia: 1, ganancias: 1, utilidad: 0.5, crecimiento: 1, crece: 1,
  supera: 1.5, supero: 1.5, mejora: 1, mejoro: 1, alcista: 1.5, aprobacion: 1.5, aprobado: 1.5,
  repunte: 1.5, dispara: 1.5, optimismo: 1, solido: 0.5, fuerte: 1, beneficio: 1, beneficios: 1,
  // Español negativo
  baja: -1, bajan: -1, cae: -1, caen: -1, cayo: -1, caida: -1, perdida: -1, perdidas: -1, desplome: -2, desploma: -2,
  bajista: -1.5, rebaja: -1, recorte: -0.5, fraude: -2, quiebra: -2, despidos: -1, advierte: -1,
  riesgo: -0.5, riesgos: -0.5, preocupacion: -1, temor: -1, incertidumbre: -1, debil: -1, retraso: -1, multa: -1, rechazo: -1.5,
};

// Negadores: invierten el signo de las siguientes VENTANA_NEGACION palabras con puntaje.
export const NEGADORES = new Set([
  'not', 'no', 'never', 'without', 'nor', 'neither', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'isnt', 'wasnt', 'arent', 'werent', 'wont', 'fails', 'failed',
  'sin', 'nunca', 'tampoco', 'ni',
]);
export const VENTANA_NEGACION = 3;
