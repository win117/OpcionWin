import { cores as modulosCores } from '../../../cores';
import { createAnalisis } from '../services/analisis.service';
import { createScreener } from '../services/screener.service';
import { input } from '../services/crud.service';
import { aceptar, handle, respond, trabajoAuditado } from './crud.controller';

export default ({ factory, cola, tasa, eventos, universo }) => {
  const analisis = createAnalisis({ cola, factory, tasa, eventos }), screener = createScreener({ factory, universo });
  const trabajo = trabajoAuditado(factory);
  return {
    catalogoCores: handle(async (_req, res) => respond(res, { items: Object.entries(modulosCores).map(([core, m]) => ({ core, version: m.VERSION, requiere: [...(m.REQUIERE || [])], senales: m.SENALES || [] })) })),
    ejecutarCore: handle(async (req, res) => aceptar(res, await trabajo(req, 'evaluaciones', 'evaluacion.crear', () => analisis.ejecutarCore(req.context, req.params.core, input(req.datos.body))))),
    seleccionar: handle(async (req, res) => aceptar(res, await trabajo(req, 'selecciones', 'seleccion.crear', () => analisis.ejecutarSeleccion(req.context, input(req.datos.body))))),
    confluir: handle(async (req, res) => aceptar(res, await trabajo(req, 'confluencias', 'confluencia.crear', () => analisis.ejecutarConfluencia(req.context, input(req.datos.body))))),
    evaluarConfiguracion: handle(async (req, res) => aceptar(res, await trabajo(req, 'evaluaciones', 'evaluacion.crear', () => analisis.evaluarConfiguracion(req.context, req.params.id, input(req.datos.body || {}))))),
    catalogoEstrategias: handle(async (req, res) => respond(res, [...(await analisis.asegurarEstrategias(req.context)).values()])),
    ranking: handle(async (req, res) => respond(res, await screener.ranking(req.context, req.datos.query))),
  };
};
