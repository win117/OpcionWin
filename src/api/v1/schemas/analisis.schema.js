import { z, id, core, estrategia, parametros, ponderaciones, definir, trabajo } from './comunes';

const grupo = 'Análisis';

export const catalogoCores = definir({ metodo: 'get', ruta: '/cores/catalogo', grupo, resumen: 'Catálogo de cores: versión, datos que requiere y señales que se pueden elegir.' });

export const ejecutarCore = trabajo({ metodo: 'post', ruta: '/cores/:core/evaluaciones', grupo, resumen: 'Ejecuta un core sobre los datos sincronizados.',
  params: z.object({ core: z.string().min(1).max(40).describe('tecnico, fundamental, institucional, indicadores o noticias') }),
  body: z.looseObject({ empresaId: id, perfilId: id.nullish(), parametros: parametros.optional() }), errores: { 404: 'Core desconocido' } });

export const listarEvaluaciones = definir({ metodo: 'get', ruta: '/cores/:core/evaluaciones', grupo, resumen: 'Evaluaciones guardadas de un core (paginadas y con filtros).', params: z.object({ core: z.string() }) });
export const verEvaluacion = definir({ metodo: 'get', ruta: '/cores/:core/evaluaciones/:id', grupo, resumen: 'Una evaluación guardada.', params: z.object({ core: z.string(), id }) });

export const seleccionar = trabajo({ metodo: 'post', ruta: '/selecciones/ejecuciones', grupo, resumen: 'Combina los cores y ordena las estrategias (o las empresas) por compatibilidad.',
  body: z.looseObject({ modo: z.enum(['empresa', 'estrategia', 'empresa_estrategia']), empresaId: id.nullish(), estrategiaId: id.nullish(), empresasCandidatas: z.array(id).optional(),
    estrategiasCandidatas: z.array(estrategia).optional(), coresSeleccionados: z.array(core).min(1), perfilId: id.nullish(), ponderaciones: ponderaciones.optional(), filtros: parametros.optional() }) });

export const confluir = trabajo({ metodo: 'post', ruta: '/confluencias/ejecuciones', grupo, resumen: 'Combina evaluaciones ya completadas para una estrategia.',
  body: z.looseObject({ empresaId: id, estrategiaId: id, evaluacionesIds: z.array(id).min(1), coresSeleccionados: z.array(core).min(1), ponderaciones: ponderaciones.optional() }) });

export const evaluarConfiguracion = trabajo({ metodo: 'post', ruta: '/configuraciones/:id/evaluaciones', grupo, resumen: 'Valida la estructura y calcula pérdida, ganancia y probabilidad.',
  params: z.object({ id }), body: z.looseObject({ precioSubyacente: z.number().positive().optional() }).optional() });

export const catalogoEstrategias = definir({ metodo: 'post', ruta: '/estrategias/catalogo-base', grupo, resumen: 'Crea LONG_CALL, LONG_PUT e IRON_CONDOR si faltan.' });

export const ranking = definir({ metodo: 'get', ruta: '/screener/ranking', grupo, resumen: 'Mejores empresas del universo por estrategia. Lee lo ya calculado: no llama a proveedores.',
  query: z.object({ estrategia: z.string().optional().describe('LONG_CALL, LONG_PUT o IRON_CONDOR; sin ella, las tres'), limite: z.string().optional().describe('1 a 50; por defecto 5') }) });
