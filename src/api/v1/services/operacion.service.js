// Operación paper en un paso (ADR-011): conexión asegurada, resumen en vivo, ticket de órdenes y cierre de posiciones.
// Solo Alpaca PAPER (ADR-005/006). Crea una Configuracion por orden y reutiliza createBroker para enviar.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { crear, obtener, todos } from './registros';
import { createBroker } from './broker.service';
import { createSincronizador } from './sincronizacion.service';
import { createAnalisis } from './analisis.service';
import { ESTRATEGIAS } from '../models/shared';

const CLAVE = /^[\w-]{8,128}$/;
const INTENCIONES = ['buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close'];
const OCC = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const fechaDia = v => new Date(v).toISOString().slice(0, 10);

const claveIdempotencia = key => {
  if (typeof key !== 'string' || !CLAVE.test(key)) throw boom.badRequest('Envía el header Idempotency-Key (8-128 caracteres: letras, números, _ o -).');
  return key;
};
const mensajeError = e => String(e?.mensaje || e?.output?.payload?.message || e?.message || 'error').slice(0, 300);

// Interpreta un símbolo OCC (AAPL261125C00200000) cuando no hay contrato guardado.
export function parsearOcc(simbolo) {
  const m = OCC.exec(String(simbolo));
  if (!m) return null;
  return { subyacente: m[1], vencimiento: `20${m[2]}-${m[3]}-${m[4]}`, tipo: m[5] === 'C' ? 'call' : 'put', strike: Number(m[6]) / 1000 };
}

export function createOperacion({ integraciones, factory = repository, cola, ahora = () => new Date() }) {
  const { alpaca } = integraciones;
  const broker = createBroker({ integraciones, factory });
  const sync = createSincronizador({ integraciones, factory });
  const analisis = createAnalisis({ cola, factory });

  // Encuentra o crea broker alpaca y la conexión paper no revocada del usuario. Idempotente.
  async function asegurarConexion(ctx) {
    let [b] = await todos('brokers', ctx, { codigo: 'alpaca' }, factory);
    if (!b) b = await crear('brokers', ctx, { codigo: 'alpaca', nombre: 'Alpaca', activo: true, entornos: ['paper'] }, factory);
    const conexiones = await todos('conexiones-broker', ctx, { brokerId: b._id, entorno: 'paper' }, factory);
    return conexiones.find(c => c.estado !== 'revocada')
      || crear('conexiones-broker', ctx, { brokerId: b._id, alias: 'Alpaca paper', entorno: 'paper', credencialRef: 'env:ALPACA' }, factory);
  }

  async function asegurarYVerificar(ctx) {
    const conexion = await asegurarConexion(ctx);
    const { conexionId, estadoConexion, ...cuenta } = await broker.verificar(ctx, conexion._id);
    return { conexion: { _id: conexion._id, alias: conexion.alias, estado: estadoConexion }, cuenta };
  }

  async function estrategiaId(ctx, codigo) {
    return (await analisis.asegurarEstrategias(ctx)).get(codigo)._id;
  }

  function estrategiaPorPatas(componentes, contratos) {
    if (componentes.length === 4) return 'IRON_CONDOR';
    // Una sola pata (compra o venta): la configuración se asocia por tipo de contrato; Alpaca valida el nivel de opciones.
    if (componentes.length === 1) return contratos[0].tipo === 'call' ? 'LONG_CALL' : 'LONG_PUT';
    throw boom.badRequest('No se puede deducir la estrategia: indica estrategiaCodigo (LONG_CALL, LONG_PUT o IRON_CONDOR).');
  }

  // Crea Configuracion + Orden pendiente y la envía. Si el envío falla, la orden queda con su evento de error.
  async function crearYEnviar(ctx, key, { conexion, empresaId, estrategia, nombre, orden, componentes }) {
    const configuracion = await crear('configuraciones', ctx, { empresaId, estrategiaId: await estrategiaId(ctx, estrategia), nombre, estado: 'validada',
      componentes: componentes.map(c => ({ contratoId: c.contratoId, accion: c.accion, cantidad: orden.cantidad, proporcion: c.proporcion })) }, factory);
    const creada = await crear('ordenes', ctx, { conexionId: conexion._id, configuracionId: configuracion._id, idempotencyKey: key, ...orden, estado: 'pendiente',
      componentes: componentes.map(c => ({ contratoId: c.contratoId, simbolo: c.simbolo, accion: c.accion, intencion: c.intencion, proporcion: c.proporcion })), eventos: [] }, factory);
    const enviada = await broker.enviar(ctx, creada._id, key);
    return { orden: enviada, configuracion };
  }

  async function existente(ctx, key) {
    const [orden] = await todos('ordenes', ctx, { idempotencyKey: key }, factory);
    if (!orden) return null;
    const configuracion = await obtener('configuraciones', ctx, orden.configuracionId, factory).catch(() => null);
    return { orden, configuracion };
  }

  function validarOrdenBase(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw boom.badRequest('Body inválido.');
    const { tipo, precioLimite, vigencia = 'day', cantidad, credito = false } = body;
    if (!['market', 'limit'].includes(tipo)) throw boom.badRequest('tipo debe ser market o limit.');
    if (!['day', 'gtc'].includes(vigencia)) throw boom.badRequest('vigencia debe ser day o gtc.');
    if (typeof credito !== 'boolean') throw boom.badRequest('credito debe ser booleano.');
    if (tipo === 'limit' && !(Number.isFinite(precioLimite) && precioLimite > 0)) throw boom.badRequest('precioLimite (positivo) requerido para orden limit.');
    if (tipo === 'market' && precioLimite != null) throw boom.badRequest('Una orden market no lleva precioLimite.');
    if (credito && tipo !== 'limit') throw boom.badRequest('credito requiere una orden limit.');
    return { tipo, vigencia, credito, ...(tipo === 'limit' ? { precioLimite } : {}), cantidad };
  }

  return {
    asegurarConexion,

    // 1) POST /broker/paper/conexion
    ensureConexion: ctx => asegurarYVerificar(ctx),

    // 2) GET /broker/paper/resumen
    async resumen(ctx) {
      const conexion = await asegurarConexion(ctx);
      let cuenta = null, error;
      try { const { conexionId, estadoConexion, ...resto } = await broker.verificar(ctx, conexion._id); cuenta = resto; }
      catch (e) { error = mensajeError(e); }
      try { await sync.ejecutar(ctx, { recurso: 'posiciones', conexionId: conexion._id }); } catch { /* tolerado: se muestra lo vivo */ }
      const vivas = await alpaca.posiciones();
      const contratos = new Map((await todos('contratos', ctx, { proveedor: 'alpaca' }, factory)).map(c => [c.contratoExternoId, c]));
      const guardadas = new Map((await todos('posiciones', ctx, { conexionId: conexion._id }, factory)).filter(p => p.estado === 'abierta').map(p => [p.posicionExternaId, p]));
      const posiciones = vivas.map(p => {
        const c = contratos.get(p.simbolo), occ = c ? null : parsearOcc(p.simbolo), g = guardadas.get(p.posicionExternaId || p.simbolo);
        const signo = p.lado === 'short' ? -1 : 1;
        const base = p.precioPromedio != null ? p.precioPromedio * p.cantidad * 100 : null;
        const pl = p.plNoRealizado ?? (p.precioActual != null && p.precioPromedio != null ? (p.precioActual - p.precioPromedio) * p.cantidad * 100 * signo : null);
        const plPct = p.plPctNoRealizado != null ? p.plPctNoRealizado * 100 : (pl != null && base ? pl / base * 100 : null);
        return { posicionId: g?._id ?? null, contratoId: c?._id ?? null, simbolo: p.simbolo,
          subyacente: c ? (c.simbolo && OCC.test(c.simbolo) ? parsearOcc(c.simbolo).subyacente : c.simbolo) : (occ?.subyacente ?? p.simbolo),
          tipo: c?.tipo ?? occ?.tipo ?? null, strike: c?.strike ?? occ?.strike ?? null, vencimiento: c ? fechaDia(c.vencimiento) : (occ?.vencimiento ?? null),
          lado: p.lado, cantidad: p.cantidad, precioPromedio: p.precioPromedio, precioActual: p.precioActual, valorMercado: p.valorMercado, pl, plPct };
      });
      const ordenes = (await todos('ordenes', ctx, { conexionId: conexion._id }, factory))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 15)
        .map(o => ({ _id: o._id, estado: o.estado, tipo: o.tipo, cantidad: o.cantidad, precioLimite: o.precioLimite ?? null, credito: Boolean(o.credito), componentes: o.componentes,
          createdAt: o.createdAt, ordenExternaId: o.ordenExternaId ?? null, eventos: (o.eventos || []).slice(-3) }));
      return { conexionId: conexion._id, cuenta, ...(error ? { error } : {}), posiciones, ordenes };
    },

    // 3) POST /ordenes/ticket
    async ticket(ctx, body, idempotencyKey) {
      const key = claveIdempotencia(idempotencyKey);
      const previa = await existente(ctx, key);
      if (previa) return { ...previa, repetida: true };
      const base = validarOrdenBase(body);
      if (!Number.isSafeInteger(base.cantidad) || base.cantidad < 1 || base.cantidad > 100) throw boom.badRequest('cantidad debe ser un entero entre 1 y 100.');
      if (!Array.isArray(body.componentes) || body.componentes.length < 1 || body.componentes.length > 4) throw boom.badRequest('componentes: de 1 a 4 patas.');
      if (base.credito && body.componentes.length < 2) throw boom.badRequest('credito solo aplica a órdenes multi-pata.');
      if (body.estrategiaCodigo != null && !ESTRATEGIAS.includes(body.estrategiaCodigo)) throw boom.badRequest('estrategiaCodigo: ' + ESTRATEGIAS.join(', ') + '.');
      const empresa = await obtener('empresas', ctx, body.empresaId, factory);
      const hoy = ahora().toISOString().slice(0, 10), vistos = new Set(), componentes = [], contratos = [];
      for (const c of body.componentes) {
        if (!c || typeof c !== 'object') throw boom.badRequest('Pata inválida.');
        if (!['buy', 'sell'].includes(c.accion)) throw boom.badRequest('accion debe ser buy o sell.');
        const intencion = c.intencion ?? `${c.accion}_to_open`;
        if (!INTENCIONES.includes(intencion) || !intencion.startsWith(c.accion + '_')) throw boom.badRequest('intencion inválida para la acción.');
        const proporcion = c.proporcion ?? 1;
        if (!Number.isSafeInteger(proporcion) || proporcion < 1) throw boom.badRequest('proporcion debe ser un entero positivo.');
        if (vistos.has(c.contratoId)) throw boom.badRequest('Contrato repetido en las patas.');
        vistos.add(c.contratoId);
        const contrato = await obtener('contratos', ctx, c.contratoId, factory);
        if (contrato.empresaId !== empresa._id) throw boom.badRequest('El contrato ' + contrato.simbolo + ' pertenece a otra empresa.');
        if (contrato.proveedor !== 'alpaca') throw boom.badRequest('El contrato ' + contrato.simbolo + ' no proviene de Alpaca.');
        if (fechaDia(contrato.vencimiento) < hoy) throw boom.badRequest('El contrato ' + contrato.simbolo + ' ya venció.');
        contratos.push(contrato);
        componentes.push({ contratoId: contrato._id, simbolo: contrato.simbolo, accion: c.accion, intencion, proporcion });
      }
      const estrategia = body.estrategiaCodigo || estrategiaPorPatas(componentes, contratos);
      const venc = fechaDia([...contratos].sort((a, b) => new Date(a.vencimiento) - new Date(b.vencimiento))[0].vencimiento);
      const nombre = String(body.nombre || `${body.estrategiaCodigo || (estrategia)} ${empresa.simbolo} ${venc}`).slice(0, 200);
      const conexion = await asegurarConexion(ctx);
      const { cantidad, ...resto } = base;
      return crearYEnviar(ctx, key, { conexion, empresaId: empresa._id, estrategia, nombre, orden: { ...resto, cantidad }, componentes });
    },

    // 4) POST /posiciones/:id/cierre
    async cierre(ctx, posicionId, body, idempotencyKey) {
      const key = claveIdempotencia(idempotencyKey);
      const previa = await existente(ctx, key);
      if (previa) return { orden: previa.orden, repetida: true };
      const base = validarOrdenBase({ ...(body || {}), cantidad: 1, credito: false });
      const posicion = await obtener('posiciones', ctx, posicionId, factory);
      if (posicion.estado !== 'abierta') throw boom.conflict('La posición no está abierta.');
      const conexion = await obtener('conexiones-broker', ctx, posicion.conexionId, factory);
      if (conexion.entorno !== 'paper') throw boom.forbidden('Solo se permite el entorno paper (ADR-005).');
      const contrato = await obtener('contratos', ctx, posicion.contratoId, factory);
      if (contrato.proveedor !== 'alpaca') throw boom.badRequest('El contrato no proviene de Alpaca.');
      if (!Number.isSafeInteger(posicion.cantidad)) throw boom.badRequest('La cantidad de la posición no es un entero de contratos.');
      const accion = posicion.lado === 'long' ? 'sell' : 'buy';
      const componentes = [{ contratoId: contrato._id, simbolo: contrato.simbolo, accion, intencion: `${accion}_to_close`, proporcion: 1 }];
      const { cantidad, ...resto } = base; void cantidad;
      const { orden } = await crearYEnviar(ctx, key, { conexion, empresaId: contrato.empresaId, estrategia: contrato.tipo === 'call' ? 'LONG_CALL' : 'LONG_PUT',
        nombre: 'Cierre ' + contrato.simbolo, orden: { ...resto, cantidad: posicion.cantidad }, componentes });
      return { orden };
    },
  };
}
