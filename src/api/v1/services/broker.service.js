// Operaciones con broker (ADR-004/005/006): Alpaca o Webull, solo paper; credenciales por referencia env:ALPACA | env:WEBULL.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { obtener, parchar } from './registros';

export const BROKERS = {
  alpaca: { codigo: 'alpaca', nombre: 'Alpaca', ref: 'env:ALPACA' },
  webull: { codigo: 'webull', nombre: 'Webull', ref: 'env:WEBULL' },
  ibkr: { codigo: 'ibkr', nombre: 'Interactive Brokers', ref: 'env:IBKR' },
};

// Mapa de adaptadores por código de broker (los fakes de prueba pueden omitir alguno).
export const adaptadoresDe = integraciones => ({ alpaca: integraciones.alpaca, webull: integraciones.webull, ibkr: integraciones.ibkr });
export function adaptadorDe(integraciones, codigo) {
  const a = adaptadoresDe(integraciones)[codigo];
  if (!a) throw boom.notImplemented('Broker ' + codigo + ' sin adaptador operativo (ADR-004).');
  return a;
}

export const ESTADOS_TERMINALES = ['ejecutada', 'cancelada', 'rechazada', 'expirada'];
// Último evento que deja en duda si la orden llegó al broker: envío sin respuesta, 5xx o proceso interrumpido.
const envioAmbiguo = orden => ['envio', 'error_envio'].includes(orden.eventos?.at(-1)?.tipo);
// Error al enviar → 'error_previo' (no llegó; se puede reintentar), 'rechazada' (definitivo) o 'error_envio' (ambiguo).
function clasificarErrorEnvio({ codigo, status } = {}) {
  if (['SIN_CREDENCIALES', 'LIMITE'].includes(codigo)) return 'error_previo';
  if (['VALIDACION', 'NO_PERMITIDO', 'NO_IMPLEMENTADO'].includes(codigo)) return 'rechazada';
  if (status >= 400 && status < 500 && ![408, 409, 425].includes(status)) return 'rechazada';
  return 'error_envio';
}
const ejecucionDe = remoto => ({
  ...(remoto.cantidadEjecutada != null ? { cantidadEjecutada: remoto.cantidadEjecutada } : {}),
  ...(remoto.precioPromedioEjecucion != null ? { precioPromedioEjecucion: remoto.precioPromedioEjecucion } : {}),
});

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

  // Guarda lo que informa el broker (id externo, estado y ejecución) junto con un evento.
  const registrar = (ctx, ordenId, remoto, tipo, mensaje) => parchar('ordenes', ctx, ordenId, d => ({ ...d,
    ...(remoto.ordenExternaId ? { ordenExternaId: remoto.ordenExternaId } : {}), estado: remoto.estado, ...ejecucionDe(remoto),
    eventos: [...(d.eventos || []), { tipo, mensaje }] }), factory);

  // Busca en el broker la orden por su client_order_id; si existe, la adopta. null = el broker no la tiene.
  async function adoptar(ctx, orden, { meta, adaptador }) {
    let remoto;
    try { remoto = await adaptador.consultarPorClientOrderId(orden.idempotencyKey); }
    catch (error) { if (error?.codigo === 'NO_ENCONTRADO') return null; throw error; }
    return registrar(ctx, orden._id, remoto, 'recuperada', meta.nombre + ' paper ya tenía la orden: ' + remoto.estado);
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

    // Un reintento (la orden ya tiene eventos) consulta primero al broker; solo reenvía si allí no existe.
    async enviar(ctx, ordenId, idempotencyKey, { primerEnvio = false } = {}) {
      if (typeof idempotencyKey !== 'string' || !/^[\w-]{8,128}$/.test(idempotencyKey)) throw boom.badRequest('Envía el header Idempotency-Key (8-128 caracteres).');
      const orden = await obtener('ordenes', ctx, ordenId, factory);
      if (orden.idempotencyKey !== idempotencyKey) throw boom.conflict('Idempotency-Key no corresponde a la orden.');
      if (orden.ordenExternaId) return orden; // reintento: ya enviada
      if (orden.estado !== 'pendiente') throw boom.conflict('Solo se envían órdenes pendientes.');
      const operable = await conexionOperable(ctx, orden.conexionId), { meta, adaptador } = operable;
      const reintento = !primerEnvio && orden.eventos?.length > 0;
      if (reintento) {
        const adoptada = await adoptar(ctx, orden, operable);
        if (adoptada) return adoptada;
      }
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
          ...(orden.precioLimite != null ? { precioLimite: orden.precioLimite } : {}), ...(orden.credito && componentes.length > 1 ? { credito: true } : {}), componentes });
      } catch (error) {
        let tipo = clasificarErrorEnvio(error);
        const mensaje = String(error?.mensaje || 'Error al enviar').slice(0, 1900);
        // Un rechazo por clave duplicada (o en un reintento) puede significar que el primer envío sí entró.
        if (tipo === 'rechazada' && (reintento || /client.?order.?id|duplic/i.test(mensaje))) {
          let adoptada = null;
          try { adoptada = await adoptar(ctx, orden, operable); } catch { tipo = 'error_envio'; }
          if (adoptada) return adoptada;
        }
        await parchar('ordenes', ctx, orden._id, d => (d.ordenExternaId ? d : { ...d, ...(tipo === 'rechazada' ? { estado: 'rechazada' } : {}),
          eventos: [...(d.eventos || []), { tipo, mensaje }] }), factory).catch(() => {});
        throw error;
      }
      return registrar(ctx, orden._id, remoto, 'enviada', meta.nombre + ' paper: ' + remoto.estado);
    },

    // Refresca una sola orden. Una terminal no se consulta (salvo ejecutada sin precio); una pendiente ya intentada se busca por su clave.
    async actualizar(ctx, ordenId) {
      const orden = await obtener('ordenes', ctx, ordenId, factory);
      const faltaPrecio = orden.estado === 'ejecutada' && orden.precioPromedioEjecucion == null && orden.ordenExternaId;
      if (ESTADOS_TERMINALES.includes(orden.estado) && !faltaPrecio) return orden;
      if (!orden.ordenExternaId) {
        if (!orden.eventos?.length) return orden; // nunca se intentó enviar
        return await adoptar(ctx, orden, await conexionOperable(ctx, orden.conexionId)) || orden;
      }
      const { adaptador } = await conexionOperable(ctx, orden.conexionId);
      const remoto = await adaptador.consultarOrden(orden.ordenExternaId), ejecucion = ejecucionDe(remoto);
      const mismoEstado = remoto.estado === orden.estado;
      if (mismoEstado && Object.entries(ejecucion).every(([k, v]) => orden[k] === v)) return orden;
      // Primera lectura sin nada ejecutado: se guarda el 0 sin agregar un evento.
      if (mismoEstado && !ejecucion.cantidadEjecutada && ejecucion.precioPromedioEjecucion == null) return parchar('ordenes', ctx, orden._id, ejecucion, factory);
      const detalle = (remoto.cantidadEjecutada ? '; ejecutadas ' + remoto.cantidadEjecutada : '') + (remoto.precioPromedioEjecucion != null ? ' a ' + remoto.precioPromedioEjecucion : '');
      return registrar(ctx, orden._id, { ...remoto, ordenExternaId: orden.ordenExternaId }, 'sincronizacion', 'Estado del broker: ' + remoto.estado + detalle);
    },

    async cancelar(ctx, ordenId) {
      let orden = await obtener('ordenes', ctx, ordenId, factory);
      if (!orden.ordenExternaId) {
        if (orden.estado !== 'pendiente') throw boom.conflict('La orden no puede cancelarse.');
        let adoptada = null;
        try { adoptada = await adoptar(ctx, orden, await conexionOperable(ctx, orden.conexionId)); }
        catch (error) { if (envioAmbiguo(orden)) throw error; } // en duda y sin poder comprobar: no se marca cancelada
        if (!adoptada) {
          const local = await parchar('ordenes', ctx, orden._id, d => (d.ordenExternaId ? d
            : { ...d, estado: 'cancelada', eventos: [...(d.eventos || []), { tipo: 'cancelada', mensaje: 'Cancelada: el broker no tiene esta orden.' }] }), factory);
          if (local.ordenExternaId) throw boom.conflict('La orden acaba de enviarse al broker. Vuelve a cancelarla.');
          return local;
        }
        if (ESTADOS_TERMINALES.includes(adoptada.estado)) return adoptada;
        orden = adoptada;
      }
      const { adaptador } = await conexionOperable(ctx, orden.conexionId);
      await adaptador.cancelarOrden(orden.ordenExternaId);
      const remoto = await adaptador.consultarOrden(orden.ordenExternaId);
      return registrar(ctx, orden._id, { ...remoto, ordenExternaId: orden.ordenExternaId }, 'cancelacion_solicitada', 'Estado del broker: ' + remoto.estado);
    },
  };
}
