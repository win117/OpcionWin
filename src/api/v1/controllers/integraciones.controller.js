import { createBusquedaActivos } from '../services/activos.service';
import { input } from '../services/crud.service';
import { createSincronizador } from '../services/sincronizacion.service';
import { iniciarTrabajo } from '../services/trabajos.service';
import { aceptar, handle, respond, trabajoAuditado } from './crud.controller';

const PROVEEDOR = { fundamentales: 'sec', institucional: 'sec' };
const CAMPOS = ['recurso', 'simbolos', 'desde', 'hasta', 'diasVencimientoMin', 'diasVencimientoMax', 'conexionId'];

export default ({ factory, integraciones, cola, ahora, cacheActivos, universo }) => {
  const sync = createSincronizador({ integraciones, factory });
  const busqueda = createBusquedaActivos({ integraciones, factory, ahora, cache: cacheActivos, universo });
  const trabajo = trabajoAuditado(factory);
  return {
    estado: handle(async (_req, res) => respond(res, integraciones.estado())),
    sincronizar: handle(async (req, res) => {
      const body = input(req.datos.body);
      const datos = { proveedor: PROVEEDOR[body.recurso] || 'alpaca', ...Object.fromEntries(CAMPOS.filter(c => body[c] != null).map(c => [c, body[c]])) };
      aceptar(res, await trabajo(req, 'sincronizaciones', 'sincronizacion.crear',
        () => iniciarTrabajo({ name: 'sincronizaciones', ctx: req.context, datos, cola, factory, ejecutar: r => sync.ejecutar(req.context, r) })));
    }),
    buscarActivos: handle(async (req, res) => respond(res, await busqueda.buscar(req.context, req.query.q, req.query.limit))),
  };
};
