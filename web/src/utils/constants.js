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
// Secciones de Configuración, agrupadas. Las usan la navegación y los títulos de página.
export const CONFIG_GRUPOS = [
  {
    nombre: 'Mi análisis', descripcion: 'Qué se analiza y con qué criterios.', secciones: [
      { to: 'perfiles', label: 'Perfiles de análisis', descripcion: 'Conjuntos de reglas para puntuar una empresa.' },
      { to: 'estrategias', label: 'Estrategias', descripcion: 'Las estrategias que se comparan y cuánto pesa cada core.' },
      { to: 'configuraciones', label: 'Configuraciones', descripcion: 'Operaciones preparadas: empresa, estrategia y contratos.' },
      { to: 'empresas', label: 'Empresas', descripcion: 'Las empresas que has analizado.' },
    ],
  },
  {
    nombre: 'Brokers', descripcion: 'Dónde se envían tus órdenes de práctica.', secciones: [
      { to: 'conexiones', label: 'Conexiones de broker', descripcion: 'Cuentas de práctica (paper) vinculadas.' },
    ],
  },
  {
    nombre: 'Avanzado', descripcion: 'Herramientas para revisar el detalle.', secciones: [
      { to: 'cores', label: 'Evaluar cores', descripcion: 'Ejecuta un solo core y mira sus métricas.' },
      { to: 'seleccion', label: 'Selección', descripcion: 'Compara las estrategias para una o varias empresas.' },
      { to: 'mercado', label: 'Mercado', descripcion: 'Los datos guardados de cada empresa.' },
      { to: 'sincronizaciones', label: 'Sincronizaciones', descripcion: 'Descargas de datos y su resultado.' },
      { to: 'auditoria', label: 'Auditoría', descripcion: 'Registro de lo que ha ocurrido en tu cuenta.' },
    ],
  },
];

const TITULOS = { '': 'Inicio', analisis: 'Análisis', posiciones: 'Posiciones', ordenes: 'Órdenes', configuracion: 'Configuración', glosario: 'Glosario' };
/** Título de la pestaña del navegador según la ruta. */
export function tituloDeRuta(pathname) {
  const [a = '', b] = pathname.split('/').filter(Boolean);
  if (a === 'analisis' && b) return 'Análisis de ' + b.toUpperCase();
  if (a === 'configuracion' && b) return CONFIG_GRUPOS.flatMap(g => g.secciones).find(s => s.to === b)?.label || TITULOS.configuracion;
  return TITULOS[a] || 'Página no encontrada';
}
// Glosario (componente Termino y página /glosario). `grupo` ordena la página.
export const GLOSARIO_GRUPOS = ['Opciones', 'Griegas y volatilidad', 'Estrategias', 'Órdenes', 'Cómo lee la app una empresa'];
export const GLOSARIO = {
  strike: { grupo: 'Opciones', nombre: 'Strike', texto: 'Precio al que la opción permite comprar (call) o vender (put) la acción.' },
  vencimiento: { grupo: 'Opciones', nombre: 'Vencimiento', texto: 'Último día de vida de la opción. Después deja de existir, valga o no valga algo.' },
  prima: { grupo: 'Opciones', nombre: 'Prima', texto: 'Precio de la opción por acción. Un contrato cubre 100 acciones: una prima de 2.50 cuesta 250 dólares.' },
  patas: { grupo: 'Opciones', nombre: 'Patas', texto: 'Cada una de las opciones que forman una estrategia. Un Long Call tiene una pata; un Iron Condor, cuatro.' },
  itm: { grupo: 'Opciones', nombre: 'ITM (dentro del dinero)', texto: 'La opción ya tiene valor si se ejerciera hoy: un call con strike menor al precio, o un put con strike mayor.' },
  atm: { grupo: 'Opciones', nombre: 'ATM (en el dinero)', texto: 'El strike está prácticamente al mismo precio que la acción.' },
  otm: { grupo: 'Opciones', nombre: 'OTM (fuera del dinero)', texto: 'La opción no valdría nada si se ejerciera hoy; solo tiene valor por el tiempo que le queda.' },
  breakeven: { grupo: 'Opciones', nombre: 'Punto de equilibrio (breakeven)', texto: 'Precio de la acción, al vencimiento, en el que no ganas ni pierdes.' },
  delta: { grupo: 'Griegas y volatilidad', nombre: 'Delta', texto: 'Cuánto cambia la opción si la acción sube 1 dólar. También se lee como la probabilidad aproximada de acabar dentro del dinero.' },
  gamma: { grupo: 'Griegas y volatilidad', nombre: 'Gamma', texto: 'Cuánto cambia el delta si la acción se mueve 1 dólar. Gamma alta: la opción cambia de ritmo muy rápido.' },
  theta: { grupo: 'Griegas y volatilidad', nombre: 'Theta', texto: 'Cuánto valor pierde la opción cada día que pasa, si lo demás no cambia. Perjudica a quien compra y favorece a quien vende.' },
  vega: { grupo: 'Griegas y volatilidad', nombre: 'Vega', texto: 'Cuánto cambia la opción si la volatilidad implícita sube un punto porcentual.' },
  iv: { grupo: 'Griegas y volatilidad', nombre: 'IV (volatilidad implícita)', texto: 'Movimiento anual que el mercado espera de la acción, deducido del precio de sus opciones. IV alta: primas caras.' },
  hv: { grupo: 'Griegas y volatilidad', nombre: 'HV (volatilidad histórica)', texto: 'Cuánto se ha movido de verdad la acción en el periodo indicado. Compararla con la IV dice si las primas están caras o baratas.' },
  long_call: { grupo: 'Estrategias', nombre: 'Long Call', texto: 'Comprar un call. Ganas si la acción sube lo suficiente antes del vencimiento; como mucho pierdes la prima.' },
  long_put: { grupo: 'Estrategias', nombre: 'Long Put', texto: 'Comprar un put. Ganas si la acción baja lo suficiente antes del vencimiento; como mucho pierdes la prima.' },
  iron_condor: { grupo: 'Estrategias', nombre: 'Iron Condor', texto: 'Vender un call y un put alejados del precio y comprar otros dos más lejos como protección. Ganas si la acción se queda en un rango; ganancia y pérdida están limitadas.' },
  debito: { grupo: 'Estrategias', nombre: 'Débito', texto: 'Pagas para abrir la operación. Es lo habitual al comprar opciones.' },
  credito: { grupo: 'Estrategias', nombre: 'Crédito', texto: 'Cobras al abrir la operación, a cambio de asumir una obligación. Es lo habitual en un Iron Condor.' },
  spread: { grupo: 'Órdenes', nombre: 'Spread (diferencia bid/ask)', texto: 'Distancia entre lo que pagan (bid) y lo que piden (ask). Si es grande, entrar y salir cuesta más y el precio es poco fiable.' },
  gtc: { grupo: 'Órdenes', nombre: 'GTC y Day', texto: 'Vigencia de la orden. Day se cancela al cierre del día; GTC sigue activa hasta que se ejecuta o la cancelas.' },
  paper: { grupo: 'Órdenes', nombre: 'Paper (simulado)', texto: 'Cuenta de práctica con dinero ficticio. Esta aplicación solo opera en paper.' },
  core: { grupo: 'Cómo lee la app una empresa', nombre: 'Core o factor', texto: 'Cada punto de vista del análisis: técnico, fundamental, institucional, indicadores y noticias. Cada uno da un puntaje de 0 a 100.' },
  confianza: { grupo: 'Cómo lee la app una empresa', nombre: 'Confianza', texto: 'Qué tan de acuerdo están las señales y qué tan completos son los datos. Con confianza baja, el puntaje vale menos.' },
  cobertura: { grupo: 'Cómo lee la app una empresa', nombre: 'Cobertura', texto: 'Parte de los datos necesarios que sí se encontró. 100 % significa que no faltó ninguno.' },
  dispersion: { grupo: 'Cómo lee la app una empresa', nombre: 'Dispersión', texto: 'Cuánto difieren los cores entre sí. Si es alta, unos ven subida y otros bajada: conviene ir con cautela.' },
};
export const DISCLAIMER = 'Este análisis es informativo y educativo: no es garantía de rentabilidad ni una recomendación de inversión.';
