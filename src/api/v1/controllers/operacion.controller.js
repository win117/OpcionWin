import { auditado } from '../services/auditoria.service';
import { createBroker } from '../services/broker.service';
import { createOperacion } from '../services/operacion.service';
import { handle, respond } from './crud.controller';

export default ({ factory, integraciones, cola, ahora }) => {
  const broker = createBroker({ integraciones, factory });
  const operacion = createOperacion({ integraciones, factory, cola, ahora });
  const auditar = (req, accion, recurso, recursoId, fn) => auditado(req.context, { accion, recurso, recursoId }, fn, factory);
  const clave = req => req.get('Idempotency-Key');
  const yaExistente = orden => 'Orden ya existente para esa Idempotency-Key (estado: ' + orden.estado + ').';
  const responderCierre = (res, { repetida, brokerNombre, orden }) =>
    respond(res, { orden }, repetida ? 200 : 201, repetida ? yaExistente(orden) : 'Orden de cierre enviada a ' + brokerNombre + ' paper.');
  return {
    brokersDisponibles: handle(async (_req, res) => respond(res, await operacion.disponibles())),
    conexion: handle(async (req, res) => respond(res, await operacion.ensureConexion(req.context, req.datos.body))),
    resumen: handle(async (req, res) => respond(res, await operacion.resumen(req.context, req.datos.query.broker))),
    historial: handle(async (req, res) => respond(res, await operacion.historial(req.context, req.datos.query))),
    verificarConexion: handle(async (req, res) => respond(res, await auditar(req, 'conexion.verificar', 'conexiones-broker', req.params.id, () => broker.verificar(req.context, req.params.id)))),
    ticket: handle(async (req, res) => {
      const { repetida, brokerNombre, ...data } = await auditar(req, 'orden.ticket', 'ordenes', r => r?.orden?._id || r?._id, () => operacion.ticket(req.context, req.body, clave(req)));
      respond(res, data, repetida ? 200 : 201, repetida ? yaExistente(data.orden) : 'Orden creada y enviada a ' + brokerNombre + ' paper.');
    }),
    enviar: handle(async (req, res) => respond(res, await auditar(req, 'orden.enviar', 'ordenes', req.params.id, () => broker.enviar(req.context, req.params.id, clave(req))), 200, 'Orden enviada al broker (paper).')),
    cancelar: handle(async (req, res) => respond(res, await auditar(req, 'orden.cancelar', 'ordenes', req.params.id, () => broker.cancelar(req.context, req.params.id)))),
    actualizar: handle(async (req, res) => respond(res, await broker.actualizar(req.context, req.params.id), 200, 'Orden actualizada.')),
    cerrarGrupo: handle(async (req, res) => responderCierre(res, await auditar(req, 'posicion.cerrarGrupo', 'ordenes', r => r?.orden?._id, () => operacion.cierreGrupo(req.context, req.body, clave(req))))),
    cerrar: handle(async (req, res) => responderCierre(res, await auditar(req, 'posicion.cerrar', 'posiciones', req.params.id, () => operacion.cierre(req.context, req.params.id, req.body, clave(req))))),
  };
};
