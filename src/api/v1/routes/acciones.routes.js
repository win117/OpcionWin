// Endpoints de acción (contratos.md §5): ejecutan trabajos, consultan proveedores u operan en paper.
// Se montan antes de los CRUD para que /ejecuciones no se confunda con /:id.
import { Router } from 'express';
import boom from '@hapi/boom';
import { handle, respond } from '../controllers/crud.controller';
import { input } from '../services/crud.service';
import { iniciarTrabajo } from '../services/trabajos.service';
import { createSincronizador } from '../services/sincronizacion.service';
import { createAnalisis } from '../services/analisis.service';
import { createBroker } from '../services/broker.service';

const SIMBOLO = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const PROVEEDOR = { fundamentales: 'sec', institucional: 'sec' };

export default ({ factory, integraciones, cola }) => {
  const router = Router();
  const sync = createSincronizador({ integraciones, factory });
  const analisis = createAnalisis({ cola, factory });
  const broker = createBroker({ integraciones, factory });
  const aceptado = (res, data) => respond(res, data, 202, 'Trabajo en proceso. Consulta el registro hasta completada o fallida.');

  router.get('/integraciones/estado', handle(async (_req, res) => respond(res, integraciones.estado())));

  router.post('/sincronizaciones/ejecuciones', handle(async (req, res) => {
    const body = input(req.body);
    if (!sync.recursos.includes(body.recurso)) throw boom.badRequest('recurso inválido. Usa: ' + sync.recursos.join(', '));
    const simbolos = Array.isArray(body.simbolos) ? [...new Set(body.simbolos.map(s => String(s).trim().toUpperCase()))] : [];
    if (simbolos.length > 25 || simbolos.some(s => !SIMBOLO.test(s))) throw boom.badRequest('simbolos: arreglo de hasta 25 símbolos válidos.');
    const datos = { recurso: body.recurso, proveedor: PROVEEDOR[body.recurso] || 'alpaca', simbolos,
      ...(body.desde ? { desde: body.desde } : {}), ...(body.hasta ? { hasta: body.hasta } : {}), ...(body.conexionId ? { conexionId: body.conexionId } : {}) };
    if (['ordenes', 'posiciones'].includes(body.recurso) && !body.conexionId) throw boom.badRequest('conexionId requerido para ' + body.recurso + '.');
    aceptado(res, await iniciarTrabajo({ name: 'sincronizaciones', ctx: req.context, datos, cola, factory, ejecutar: r => sync.ejecutar(req.context, r) }));
  }));

  router.post('/cores/:core/evaluaciones', handle(async (req, res) => aceptado(res, await analisis.ejecutarCore(req.context, req.params.core, input(req.body)))));
  router.post('/selecciones/ejecuciones', handle(async (req, res) => aceptado(res, await analisis.ejecutarSeleccion(req.context, input(req.body)))));
  router.post('/confluencias/ejecuciones', handle(async (req, res) => aceptado(res, await analisis.ejecutarConfluencia(req.context, input(req.body)))));
  router.post('/configuraciones/:id/evaluaciones', handle(async (req, res) => aceptado(res, await analisis.evaluarConfiguracion(req.context, req.params.id, req.body ? input(req.body) : {}))));
  router.post('/estrategias/catalogo-base', handle(async (req, res) => respond(res, [...(await analisis.asegurarEstrategias(req.context)).values()])));

  router.post('/ordenes/:id/envio', handle(async (req, res) => respond(res, await broker.enviar(req.context, req.params.id, req.get('Idempotency-Key')), 200, 'Orden enviada a Alpaca paper.')));
  router.post('/ordenes/:id/cancelacion', handle(async (req, res) => respond(res, await broker.cancelar(req.context, req.params.id))));
  router.post('/conexiones-broker/:id/verificacion', handle(async (req, res) => respond(res, await broker.verificar(req.context, req.params.id))));
  return router;
};
