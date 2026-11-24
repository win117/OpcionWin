// Operaciones con broker (ADR-004/005/006): Alpaca o Webull, solo paper; credenciales por referencia env:ALPACA | env:WEBULL.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { obtener, parchar } from './registros';

export const BROKERS = {
  alpaca: { codigo: 'alpaca', nombre: 'Alpaca', ref: 'env:ALPACA' },
  webull: { codigo: 'webull', nombre: 'Webull', ref: 'env:WEBULL' },
};

// Mapa de adaptadores por código de broker (los fakes de prueba pueden omitir alguno).
export const adaptadoresDe = integraciones => ({ alpaca: integraciones.alpaca, webull: integraciones.webull });
export function adaptadorDe(integraciones, codigo) {
  const a = adaptadoresDe(integraciones)[codigo];
  if (!a) throw boom.notImplemented('Broker ' + codigo + ' sin adaptador operativo (ADR-004).');
  return a;
}

export function createBroker({ integraciones, factory = repository }) {
  // Devuelve la conexión y el adaptador del broker al que pertenece.
  async function conexionOperable(ctx, conexionId) {
    const conexion = await obtener('conexiones-broker', ctx, conexionId, factory);
    const broker = await obtener('brokers', ctx, conexion.brokerId, factory);
    const meta = BROKERS[broker.codigo];
    if (!meta) throw boom.notImplemented('Broker ' + broker.codigo + ' sin adaptador operativo (ADR-004).');
    if (conexion.entorno !== 'paper') throw boom.forbidden('Solo se permite el entorno paper en esta versión (ADR-005).');
    const row = await factory('conexiones-broker', ctx).get(conexion._id);
    const ref = row.document.credencialRef;
    if (ref && ref !== meta.ref) throw boom.badRequest('credencialRef no soportada. Usa ' + meta.ref + '.');
    if (conexion.estado === 'revocada') throw boom.conflict('La conexión está revocada.');
    return { conexion, meta, adaptador: adaptadorDe(integraciones, meta.codigo) };
  }

  return {
    async verificar(ctx, conexionId) {
      const { conexion, adaptador } = await conexionOperable(ctx, conexionId);
      try {
        const cuenta = await adaptador.cuenta();
        const actualizada = await parchar('conexiones-broker', ctx, conexion._id, { estado: 'activa', ...(cuenta.cuentaExternaId ? { cuentaExternaId: String(cuenta.cuentaExternaId) } : {}) }, factory);
        // Respuesta plana para la interfaz; sin secretos.
        return { conexionId: actualizada._id, estadoConexion: actualizada.estado, ...cuenta };
      } catch (error) {
        await parchar('conexiones-broker', ctx, conexion._id, { estado: 'error' }, factory).catch(() => {});
        throw error;
      }
    },

    async enviar(ctx, ordenId, idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || !/^[\w-]{8,128}$/.test(idempotencyKey)) throw boom.badRequest('Envía el header Idempotency-Key (8-128 caracteres).');
      const orden = await obtener('ordenes', ctx, ordenId, factory);
      if (orden.idempotencyKey !== idempotencyKey) throw boom.conflict('Idempotency-Key no corresponde a la orden.');
      if (orden.ordenExternaId) return orden; // reintento: ya enviada
      if (orden.estado !== 'pendiente') throw boom.conflict('Solo se envían órdenes pendientes.');
      const { meta, adaptador } = await conexionOperable(ctx, orden.conexionId);
      const componentes = [];
      for (const c of orden.componentes) {
        const contrato = await obtener('contratos', ctx, c.contratoId, factory);
        // Los contratos se sincronizan desde Alpaca (símbolo OCC); Webull convierte el OCC a su formato.
        if (contrato.proveedor !== 'alpaca') throw boom.badRequest('El contrato ' + contrato.simbolo + ' no proviene de Alpaca. Sincroniza contratos.');
        componentes.push({ simbolo: contrato.contratoExternoId, accion: c.accion, intencion: c.intencion, proporcion: c.proporcion });
      }
      let remoto;
      try {
        remoto = await adaptador.enviarOrden({ clientOrderId: idempotencyKey, tipo: orden.tipo, vigencia: orden.vigencia, cantidad: orden.cantidad,
          ...(orden.precioLimite != null ? { precioLimite: orden.precioLimite } : {}), ...(orden.credito ? { credito: true } : {}), componentes });
      } catch (error) {
        await parchar('ordenes', ctx, orden._id, d => ({ ...d, eventos: [...(d.eventos || []), { tipo: 'error_envio', mensaje: String(error?.mensaje || 'Error al enviar').slice(0, 1900) }] }), factory).catch(() => {});
        throw error;
      }
      return parchar('ordenes', ctx, orden._id, d => ({ ...d, ordenExternaId: remoto.ordenExternaId, estado: remoto.estado,
        eventos: [...(d.eventos || []), { tipo: 'enviada', mensaje: meta.nombre + ' paper: ' + (remoto.estadoProveedor || remoto.estado) }] }), factory);
    },

    async cancelar(ctx, ordenId) {
      const orden = await obtener('ordenes', ctx, ordenId, factory);
      if (!orden.ordenExternaId) {
        if (orden.estado !== 'pendiente') throw boom.conflict('La orden no puede cancelarse.');
        return parchar('ordenes', ctx, orden._id, d => ({ ...d, estado: 'cancelada', eventos: [...(d.eventos || []), { tipo: 'cancelada', mensaje: 'Cancelada antes de enviarse.' }] }), factory);
      }
      const { adaptador } = await conexionOperable(ctx, orden.conexionId);
      await adaptador.cancelarOrden(orden.ordenExternaId);
      const remoto = await adaptador.consultarOrden(orden.ordenExternaId);
      return parchar('ordenes', ctx, orden._id, d => ({ ...d, estado: remoto.estado,
        eventos: [...(d.eventos || []), { tipo: 'cancelacion_solicitada', mensaje: 'Estado del broker: ' + (remoto.estadoProveedor || remoto.estado) }] }), factory);
    },
  };
}
