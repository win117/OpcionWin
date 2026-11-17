// Punto de entrada de los cores de análisis.
import * as tecnico from './tecnico.core.js';
import * as fundamental from './fundamental.core.js';
import * as institucional from './institucional.core.js';
import * as indicadores from './indicadores.core.js';
import * as noticias from './noticias.core.js';
import * as confluencia from './confluencia.core.js';
import * as estrategias from './estrategias.core.js';
import * as reglas from './reglas.js';
import * as blackscholes from './blackscholes.js';

export const cores = { tecnico, fundamental, institucional, indicadores, noticias };
export { confluencia, estrategias, reglas, blackscholes };
