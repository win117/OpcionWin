export const CORES = ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias'];
export const CORE_LABELS = {
  tecnico: 'Técnico',
  fundamental: 'Fundamental',
  institucional: 'Institucional',
  indicadores: 'Indicadores',
  noticias: 'Noticias',
  configuracion: 'Configuración',
};
export const CORE_DESCRIPCION = {
  tecnico: 'Tendencia y estructura de precio: medias móviles, pendiente, soportes/resistencias y volumen relativo.',
  fundamental: 'Crecimiento de ingresos y utilidad, márgenes, endeudamiento, liquidez y flujo operativo (SEC).',
  institucional: 'Cambio en tenencias reportadas en formularios 13F entre los dos cortes más recientes.',
  indicadores: 'Osciladores de momentum y volatilidad: RSI, MACD, estocástico, Bollinger, ATR, IV vs HV.',
  noticias: 'Sentimiento léxico de noticias recientes con decaimiento por antigüedad.',
};
export const CORE_OPTIONS = CORES.map(value => ({ value, label: CORE_LABELS[value] }));
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];
export const ESTRATEGIA_LABELS = { LONG_CALL: 'Long Call', LONG_PUT: 'Long Put', IRON_CONDOR: 'Iron Condor' };
export const ESTRATEGIA_OPTIONS = ESTRATEGIAS.map(value => ({ value, label: ESTRATEGIA_LABELS[value] }));
export const ESTADOS_TRABAJO = ['pendiente', 'procesando', 'completada', 'fallida'];
export const RECURSOS_SYNC = ['empresas', 'contratos', 'cotizaciones', 'historicos', 'fundamentales', 'institucional', 'noticias', 'ordenes', 'posiciones'];
export const RECURSO_LABELS = {
  empresas: 'Empresas', contratos: 'Contratos de opciones', cotizaciones: 'Cotizaciones', historicos: 'Históricos (velas)',
  fundamentales: 'Fundamentales', institucional: 'Institucional (13F)', noticias: 'Noticias', ordenes: 'Órdenes', posiciones: 'Posiciones',
};
export const OPERADORES = [
  { value: 'eq', label: 'igual (=)' }, { value: 'ne', label: 'distinto (≠)' },
  { value: 'gt', label: 'mayor (>)' }, { value: 'gte', label: 'mayor o igual (≥)' },
  { value: 'lt', label: 'menor (<)' }, { value: 'lte', label: 'menor o igual (≤)' },
  { value: 'between', label: 'entre (rango)' },
];
export const ESTADOS_ORDEN = ['pendiente', 'enviada', 'aceptada', 'parcial', 'ejecutada', 'cancelada', 'rechazada', 'expirada'];
export const DISCLAIMER = 'Este análisis es informativo y educativo: no es garantía de rentabilidad ni una recomendación de inversión.';
