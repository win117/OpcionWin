import { z, id, simbolo, dia, definir } from './comunes';

const grupo = 'Mercado';
const porSimbolo = { params: z.object({ simbolo }) };
const get = (ruta, resumen, extra = {}) => definir({ metodo: 'get', ruta: '/mercado' + ruta, grupo, resumen, ...extra });
const opciones = { query: z.looseObject({ vencimiento: dia.optional(), tipo: z.enum(['call', 'put']).optional() }) };

export const empresas = get('/empresas', 'Empresas guardadas.');
export const estado = get('/estado', 'Reloj del mercado e índices de referencia.');
export const movimientos = get('/movimientos', 'Alzas, bajas y volumen inusual del universo.');
export const mapa = get('/mapa', 'Mapa del mercado en vivo.');
export const ficha = get('/mapa/:simbolo', 'Ficha en vivo de una empresa, sin guardar nada.', porSimbolo);
export const tasa = get('/tasa', 'Tasa libre de riesgo: rendimiento de las letras del Tesoro de EE. UU. {fecha, puntos:[{dias, tasa}]}.');
export const eventos = get('/eventos/:simbolo', 'Dividendos anunciados, divisiones y próximo reporte de resultados (estimado con los anteriores de la SEC).', porSimbolo);
export const panorama = get('/panorama', 'Cierres recientes de los índices de referencia o de ?simbolos=.', { query: z.object({ simbolos: z.string().optional() }) });
export const cotizacionEnVivo = get('/cotizaciones/:simbolo/en-vivo', 'Cotización directa del proveedor (no se guarda).', porSimbolo);
export const cotizaciones = get('/cotizaciones/:simbolo', 'Cotizaciones guardadas.', porSimbolo);
export const historicos = get('/historicos/:simbolo', 'Velas guardadas.', porSimbolo);
export const fundamentales = get('/fundamentales/:simbolo', 'Reportes financieros guardados.', porSimbolo);
export const institucional = get('/institucional/:simbolo', 'Tenencias 13F guardadas.', porSimbolo);
export const cadena = get('/opciones/cadena/:simbolo', 'Cadena de opciones del proveedor con IV y griegas.', { ...porSimbolo, ...opciones });
export const resumenOpciones = get('/opciones/resumen/:simbolo', 'Contratos guardados de un vencimiento con cotización, IV, griegas e interés abierto.', { ...porSimbolo, query: z.looseObject({ vencimiento: dia.optional() }) });
const occ = z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}\d?\d{6}[CP]\d{8}$/, 'contrato inválido (formato OCC)');
export const vencimientos = get('/opciones/vencimientos/:simbolo', 'Todas las fechas de vencimiento que existen para una empresa (consulta directa).', porSimbolo);
export const traerCadena = definir({ metodo: 'post', ruta: '/mercado/opciones/cadena/:simbolo', grupo, resumen: 'Trae del proveedor un vencimiento completo, lo guarda y lo devuelve.', ...porSimbolo,
  body: z.object({ vencimiento: dia }), errores: { 404: 'Empresa no registrada o vencimiento sin contratos' } });
export const cotizacionesOpciones = get('/opciones/cotizaciones', 'Cotización directa de hasta 100 contratos: ?contratos=OCC,OCC (no se guarda).', {
  query: z.object({ contratos: z.string().transform(v => v.split(',')).pipe(z.array(occ).min(1).max(100)) }) });
export const velasOpcion = get('/opciones/velas/:occ', 'Precio diario de un contrato (hasta 400 días).', { params: z.object({ occ }) });
export const contratos = get('/opciones', 'Contratos guardados.');
export const snapshot = get('/opciones/:contratoId/snapshot', 'Cotización guardada de un contrato.', { params: z.object({ contratoId: id }) });
export const contrato = get('/opciones/:id', 'Un contrato guardado.', { params: z.object({ id }) });
export const noticias = get('/noticias', 'Noticias guardadas.');
