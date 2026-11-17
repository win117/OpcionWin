// Endpoints de acción (contratos.md §5): ejecutan trabajos, consultan proveedores u operan en paper.
// Se montan antes de los CRUD para que /ejecuciones no se confunda con /:id.
import { Router } from 'express';
import boom from '@hapi/boom';
import { handle, respond } from '../controllers/crud.controller';
import { input } from '../services/crud.service';
import { auditado, registrarEvento } from '../services/auditoria.service';
import { iniciarTrabajo } from '../services/trabajos.service';
import { createSincronizador } from '../services/sincronizacion.service';
import { createAnalisis } from '../services/analisis.service';
import { createBroker } from '../services/broker.service';
import { createOperacion } from '../services/operacion.service';
import { createBusquedaActivos } from '../services/activos.service';
import { cores as modulosCores } from '../../../cores';

const SIMBOLO = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const PROVEEDOR = { fundamentales: 'sec', institucional: 'sec' };

export default ({ factory, integraciones, cola, ahora, cacheActivos }) => {
  const router = Router();
  const sync = createSincronizador({ integraciones, factory });
  const analisis = createAnalisis({ cola, factory });
  const broker = createBroker({ integraciones, factory });
  const operacion = createOperacion({ integraciones, factory, cola, ahora });
  const busqueda = createBusquedaActivos({ integraciones, factory, ahora, cache: cacheActivos });
  const aceptado = (res, data) => respond(res, data, 202, 'Trabajo en proceso. Consulta el registro hasta completada o fallida.');
  const auditar = (req, accion, recurso, recursoId, fn) => auditado(req.context, { accion, recurso, recursoId }, fn, factory);
  // Creación de trabajos: se audita el registro creado (el resultado final queda en el propio trabajo).
  const trabajo = async (req, recurso, accion, fn) => { const r = await fn(); await registrarEvento(req.context, { accion, recurso, recursoId: r?._id }, factory); return r; };

  router.get('/integraciones/estado', handle(async (_req, res) => respond(res, integraciones.estado())));

  router.post('/sincronizaciones/ejecuciones', handle(async (req, res) => {
    const body = input(req.body);
    if (!sync.recursos.includes(body.recurso)) throw boom.badRequest('recurso inválido. Usa: ' + sync.recursos.join(', '));
    const simbolos = Array.isArray(body.simbolos) ? [...new Set(body.simbolos.map(s => String(s).trim().toUpperCase()))] : [];
    if (simbolos.length > 25 || simbolos.some(s => !SIMBOLO.test(s))) throw boom.badRequest('simbolos: arreglo de hasta 25 símbolos válidos.');
    const datos = { recurso: body.recurso, proveedor: PROVEEDOR[body.recurso] || 'alpaca', simbolos,
      ...(body.desde ? { desde: body.desde } : {}), ...(body.hasta ? { hasta: body.hasta } : {}),
      ...(body.diasVencimientoMin != null ? { diasVencimientoMin: Number(body.diasVencimientoMin) } : {}), ...(body.diasVencimientoMax != null ? { diasVencimientoMax: Number(body.diasVencimientoMax) } : {}), ...(body.conexionId ? { conexionId: body.conexionId } : {}) };
    if (['ordenes', 'posiciones'].includes(body.recurso) && !body.conexionId) throw boom.badRequest('conexionId requerido para ' + body.recurso + '.');
    aceptado(res, await trabajo(req, 'sincronizaciones', 'sincronizacion.crear', () => iniciarTrabajo({ name: 'sincronizaciones', ctx: req.context, datos, cola, factory, ejecutar: r => sync.ejecutar(req.context, r) })));
  }));

  // Catálogo de señales por core (para elegir parametros.indicadores). /cores/catalogo no choca con /cores/:core/evaluaciones.
  router.get('/cores/catalogo', handle(async (_req, res) => respond(res, { items: Object.entries(modulosCores).map(([core, m]) => ({
    core, version: m.VERSION, requiere: [...(m.REQUIERE || [])], senales: m.SENALES || [] })) })));
  router.get('/activos/busqueda', handle(async (req, res) => respond(res, await busqueda.buscar(req.context, req.query.q, req.query.limit))));

  router.post('/cores/:core/evaluaciones', handle(async (req, res) => aceptado(res, await trabajo(req, 'evaluaciones', 'evaluacion.crear', () => analisis.ejecutarCore(req.context, req.params.core, input(req.body))))));
  router.post('/selecciones/ejecuciones', handle(async (req, res) => aceptado(res, await trabajo(req, 'selecciones', 'seleccion.crear', () => analisis.ejecutarSeleccion(req.context, input(req.body))))));
  router.post('/confluencias/ejecuciones', handle(async (req, res) => aceptado(res, await trabajo(req, 'confluencias', 'confluencia.crear', () => analisis.ejecutarConfluencia(req.context, input(req.body))))));
  router.post('/configuraciones/:id/evaluaciones', handle(async (req, res) => aceptado(res, await trabajo(req, 'evaluaciones', 'evaluacion.crear', () => analisis.evaluarConfiguracion(req.context, req.params.id, req.body ? input(req.body) : {})))));
  router.post('/estrategias/catalogo-base', handle(async (req, res) => respond(res, [...(await analisis.asegurarEstrategias(req.context)).values()])));

  router.post('/ordenes/:id/envio', handle(async (req, res) => respond(res, await auditar(req, 'orden.enviar', 'ordenes', req.params.id, () => broker.enviar(req.context, req.params.id, req.get('Idempotency-Key'))), 200, 'Orden enviada a Alpaca paper.')));
  router.post('/ordenes/:id/cancelacion', handle(async (req, res) => respond(res, await auditar(req, 'orden.cancelar', 'ordenes', req.params.id, () => broker.cancelar(req.context, req.params.id)))));
  router.post('/conexiones-broker/:id/verificacion', handle(async (req, res) => respond(res, await auditar(req, 'conexion.verificar', 'conexiones-broker', req.params.id, () => broker.verificar(req.context, req.params.id)))));

  // Operación paper en un paso (ADR-011).
  router.post('/broker/paper/conexion', handle(async (req, res) => respond(res, await operacion.ensureConexion(req.context))));
  router.get('/broker/paper/resumen', handle(async (req, res) => respond(res, await operacion.resumen(req.context))));
  router.post('/ordenes/ticket', handle(async (req, res) => {
    const { repetida, ...data } = await auditar(req, 'orden.ticket', 'ordenes', r => r?.orden?._id || r?._id, () => operacion.ticket(req.context, req.body, req.get('Idempotency-Key')));
    respond(res, data, repetida ? 200 : 201, repetida ? 'Orden ya existente para esa Idempotency-Key.' : 'Orden creada y enviada a Alpaca paper.');
  }));
  router.post('/posiciones/:id/cierre', handle(async (req, res) => {
    const { repetida, ...data } = await auditar(req, 'posicion.cerrar', 'posiciones', req.params.id, () => operacion.cierre(req.context, req.params.id, req.body, req.get('Idempotency-Key')));
    respond(res, data, repetida ? 200 : 201, repetida ? 'Orden ya existente para esa Idempotency-Key.' : 'Orden de cierre enviada a Alpaca paper.');
  }));
  return router;
};
