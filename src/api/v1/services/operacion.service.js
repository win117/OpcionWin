// Operación paper en un paso (ADR-011): conexión asegurada, resumen en vivo, ticket de órdenes y cierre de posiciones (una o en grupo).
// Alpaca o Webull, solo PAPER (ADR-004/005/006), según el broker elegido. Crea una Configuracion por orden y reutiliza createBroker para enviar.
import boom from '@hapi/boom';
import { createHash } from 'node:crypto';
import { repository } from '../../../repositories';
import { crear, obtener, todos, idDeterminista } from './registros';
import { createBroker, BROKERS, adaptadorDe, ESTADOS_TERMINALES } from './broker.service';
import { createSincronizador } from './sincronizacion.service';
import { createAnalisis } from './analisis.service';
import { ESTRATEGIAS } from '../models/shared';

const CLAVE = /^[\w-]{8,128}$/;
const INTENCIONES = ['buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close'];
const PROPORCION_MAX = 10;
const OCC = /^([A-Z]{1,6}\d?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const fechaDia = v => new Date(v).toISOString().slice(0, 10);

const claveIdempotencia = key => {
  if (typeof key !== 'string' || !CLAVE.test(key)) throw boom.badRequest('Envía el header Idempotency-Key (8-128 caracteres: letras, números, _ o -).');
  return key;
};
const mcd = (a, b) => (b ? mcd(b, a % b) : a);
// Huella de la solicitud: permite distinguir un reintento de una clave reutilizada con otro contenido.
const huellaDe = (...partes) => createHash('sha256').update(JSON.stringify(partes)).digest('hex');
const huellaTicket = b => huellaDe('ticket', b?.broker || 'alpaca', b?.empresaId ?? null, b?.estrategiaCodigo ?? null, ...huellaPrecio(b), b?.cantidad ?? null,
  (Array.isArray(b?.componentes) ? b.componentes : []).map(c => [c?.contratoId, c?.accion, c?.intencion ?? `${c?.accion}_to_open`, c?.proporcion ?? 1]));
const huellaPrecio = b => [b?.tipo ?? null, b?.precioLimite ?? null, b?.vigencia ?? 'day', Boolean(b?.credito)];
const esConflicto = e => boom.isBoom(e) && e.output.statusCode === 409;
const mensajeError = e => String(e?.mensaje || e?.output?.payload?.message || e?.message || 'error').slice(0, 300);

// Interpreta un símbolo OCC (AAPL261125C00200000) cuando no hay contrato guardado.
export function parsearOcc(simbolo) {
  const m = OCC.exec(String(simbolo));
  if (!m) return null;
  return { subyacente: m[1], vencimiento: `20${m[2]}-${m[3]}-${m[4]}`, tipo: m[5] === 'C' ? 'call' : 'put', strike: Number(m[6]) / 1000 };
}

export function createOperacion({ integraciones, factory = repository, cola, ahora = () => new Date() }) {
  const broker = createBroker({ integraciones, factory });
  const sync = createSincronizador({ integraciones, factory });
  const analisis = createAnalisis({ cola, factory });

  // Código de broker pedido por el cliente (def. alpaca).
  function codigoBroker(v) {
    if (v == null || v === '') return 'alpaca';
    if (typeof v !== 'string' || !BROKERS[v]) throw boom.badRequest('broker debe ser ' + Object.keys(BROKERS).join(' o ') + '.');
    return v;
  }

  // Crea con _id determinista; si otra petición simultánea ya lo creó, devuelve ese registro.
  async function crearUnico(name, ctx, _id, datos) {
    try { return await crear(name, ctx, { _id, ...datos }, factory); }
    catch (error) { if (!esConflicto(error)) throw error; return obtener(name, ctx, _id, factory); }
  }

  // Encuentra o crea el broker del catálogo y la conexión paper no revocada del usuario para ese broker. Idempotente.
  async function asegurarConexion(ctx, codigo = 'alpaca') {
    const meta = BROKERS[codigoBroker(codigo)];
    let [b] = await todos('brokers', ctx, { codigo: meta.codigo }, factory);
    if (!b) b = await crearUnico('brokers', ctx, idDeterminista(ctx.userId, 'broker', meta.codigo), { codigo: meta.codigo, nombre: meta.nombre, activo: true, entornos: ['paper'] });
    const conexiones = await todos('conexiones-broker', ctx, { brokerId: b._id, entorno: 'paper' }, factory);
    const vigente = conexiones.find(c => c.estado !== 'revocada');
    if (vigente) return vigente;
    for (let n = conexiones.length; ; n++) { // n distingue la nueva de las revocadas
      const c = await crearUnico('conexiones-broker', ctx, idDeterminista(ctx.userId, 'conexion', b._id, 'paper', n), { brokerId: b._id, alias: meta.nombre + ' paper', entorno: 'paper', credencialRef: meta.ref });
      if (c.estado !== 'revocada') return c;
    }
  }

  async function nombreBrokerDe(ctx, conexionId) {
    const c = await obtener('conexiones-broker', ctx, conexionId, factory).catch(() => null);
    const b = c ? await obtener('brokers', ctx, c.brokerId, factory).catch(() => null) : null;
    return BROKERS[b?.codigo]?.nombre || 'Broker';
  }

  async function asegurarYVerificar(ctx, codigo) {
    const conexion = await asegurarConexion(ctx, codigo);
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
  // El _id de la orden sale de la clave: dos peticiones simultáneas con la misma clave no crean dos órdenes.
  async function crearYEnviar(ctx, key, huella, { conexion, empresaId, estrategia, nombre, orden, componentes }) {
    const configuracion = await crear('configuraciones', ctx, { empresaId, estrategiaId: await estrategiaId(ctx, estrategia), nombre, estado: 'validada',
      componentes: componentes.map(c => ({ contratoId: c.contratoId, accion: c.accion, cantidad: orden.cantidad, proporcion: c.proporcion })) }, factory);
    let creada;
    try {
      creada = await crear('ordenes', ctx, { _id: idDeterminista(ctx.userId, 'orden', key), conexionId: conexion._id, configuracionId: configuracion._id, idempotencyKey: key, huella, ...orden, estado: 'pendiente',
        componentes: componentes.map(c => ({ contratoId: c.contratoId, simbolo: c.simbolo, accion: c.accion, intencion: c.intencion, proporcion: c.proporcion })),
        // Si el proceso se interrumpe aquí, este evento indica que pudo llegar al broker.
        eventos: [{ tipo: 'envio', mensaje: 'Envío iniciado.' }] }, factory);
    } catch (error) {
      const previa = esConflicto(error) ? await reintentar(ctx, key, huella) : null;
      if (previa) return previa;
      throw error;
    }
    const enviada = await broker.enviar(ctx, creada._id, key, { primerEnvio: true });
    return { orden: enviada, configuracion };
  }

  // Reintento con la misma clave: si la orden quedó pendiente, se busca en el broker y solo se reenvía si allí no existe.
  async function reintentar(ctx, key, huella) {
    let [orden] = await todos('ordenes', ctx, { idempotencyKey: key }, factory);
    if (!orden) return null;
    if (orden.huella !== huella) throw boom.conflict('Esa Idempotency-Key ya se usó con otros datos. Genera una clave nueva.');
    if (orden.estado === 'pendiente' && !orden.ordenExternaId) orden = await broker.enviar(ctx, orden._id, key);
    const configuracion = await obtener('configuraciones', ctx, orden.configuracionId, factory).catch(() => null);
    return { orden, configuracion, repetida: true, brokerNombre: await nombreBrokerDe(ctx, orden.conexionId) };
  }

  // Órdenes vivas en el broker sin registro de este usuario (otra sesión o la plataforma del broker). Si el broker no responde: [].
  async function ordenesAjenas(adaptador, locales) {
    if (!adaptador.ordenesAbiertas) return [];
    const propias = new Set(locales.map(o => o.ordenExternaId).filter(Boolean));
    const abiertas = await adaptador.ordenesAbiertas().catch(() => []);
    return abiertas.filter(o => !propias.has(o.ordenExternaId) && !ESTADOS_TERMINALES.includes(o.estado));
  }

  // 409 si ya hay una orden de cierre viva para alguno de los contratos. Antes refresca las candidatas: la copia local puede estar atrasada.
  async function exigirSinCierreEnCurso(ctx, conexion, componentes, contratoIds) {
    const locales = await todos('ordenes', ctx, { conexionId: conexion._id }, factory);
    const cierra = o => !ESTADOS_TERMINALES.includes(o.estado) && o.componentes.some(c => c.intencion.endsWith('_to_close') && contratoIds.includes(c.contratoId));
    for (const o of locales.filter(cierra)) {
      if (cierra(await broker.actualizar(ctx, o._id).catch(() => o))) throw boom.conflict('Ya hay una orden de cierre en curso para uno de estos contratos. Espera a que termine o cancélala.');
    }
    const { codigo } = await obtener('brokers', ctx, conexion.brokerId, factory);
    // Misma pata y mismo lado, salvo que el broker diga que es para abrir.
    const choca = c => !c.intencion?.endsWith('_to_open') && componentes.some(x => x.simbolo === c.simbolo && x.accion === c.accion);
    if ((await ordenesAjenas(adaptadorDe(integraciones, codigo), locales)).some(o => o.componentes.some(choca))) {
      throw boom.conflict('El broker ya tiene abierta una orden sobre uno de estos contratos, enviada desde otra sesión o desde su plataforma. Cancélala ahí o espera a que termine.');
    }
  }

  // Cierra una o varias posiciones de la misma conexión con una sola orden, usando lado y cantidad en vivo.
  async function cerrar(ctx, ids, body, idempotencyKey) {
    const key = claveIdempotencia(idempotencyKey), grupo = ids.length > 1;
    const huella = huellaDe('cierre', [...ids].sort(), ...huellaPrecio(grupo ? body : { ...body, credito: false }));
    const previa = await reintentar(ctx, key, huella);
    if (previa) return previa;
    const { cantidad: _sinUso, ...base } = validarOrdenBase({ ...(body || {}), ...(grupo ? {} : { credito: false }) }); void _sinUso;
    const leer = () => Promise.all(ids.map(id => obtener('posiciones', ctx, id, factory)));
    let posiciones = await leer();
    const conexionId = posiciones[0].conexionId;
    if (posiciones.some(p => p.conexionId !== conexionId)) throw boom.badRequest('Las posiciones deben ser de la misma conexión.');
    const conexion = await obtener('conexiones-broker', ctx, conexionId, factory);
    if (conexion.entorno !== 'paper') throw boom.forbidden('Solo se permite el entorno paper (ADR-005).');
    await sync.ejecutar(ctx, { recurso: 'posiciones', conexionId });
    posiciones = await leer();
    if (posiciones.some(p => p.estado !== 'abierta')) throw boom.conflict('La posición no está abierta.');
    if (posiciones.some(p => p.cerrable === false)) throw boom.conflict('El broker no informa el lado o la cantidad de la posición: ciérrala en su plataforma.');
    if (posiciones.some(p => !Number.isSafeInteger(p.cantidad))) throw boom.badRequest('La cantidad de la posición no es un entero de contratos.');
    const contratos = await Promise.all(posiciones.map(p => obtener('contratos', ctx, p.contratoId, factory)));
    if (contratos.some(c => c.proveedor !== 'alpaca')) throw boom.badRequest('El contrato no proviene de Alpaca.');
    const { empresaId } = contratos[0], contratoIds = contratos.map(c => c._id);
    if (contratos.some(c => c.empresaId !== empresaId) || new Set(contratoIds).size !== contratoIds.length) throw boom.badRequest('Las posiciones deben ser contratos distintos de la misma empresa.');
    const cantidad = posiciones.map(p => p.cantidad).reduce(mcd);
    const componentes = posiciones.map((p, i) => {
      const accion = p.lado === 'long' ? 'sell' : 'buy', proporcion = p.cantidad / cantidad;
      if (proporcion > PROPORCION_MAX) throw boom.badRequest('Las cantidades de las patas no forman una estructura (proporción mayor que ' + PROPORCION_MAX + '). Ciérralas por separado.');
      return { contratoId: contratoIds[i], simbolo: contratos[i].simbolo, accion, intencion: `${accion}_to_close`, proporcion };
    });
    await exigirSinCierreEnCurso(ctx, conexion, componentes, contratoIds);
    const r = await crearYEnviar(ctx, key, huella, { conexion, empresaId, componentes, orden: { ...base, cantidad },
      estrategia: ids.length === 4 ? 'IRON_CONDOR' : contratos[0].tipo === 'call' ? 'LONG_CALL' : 'LONG_PUT',
      nombre: grupo ? `Cierre ${ids.length} patas ${parsearOcc(contratos[0].simbolo)?.subyacente || contratos[0].simbolo}` : 'Cierre ' + contratos[0].simbolo });
    return { orden: r.orden, repetida: r.repetida, brokerNombre: await nombreBrokerDe(ctx, conexionId) };
  }

  function validarOrdenBase(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw boom.badRequest('Body inválido.');
    const { tipo, precioLimite, vigencia = 'day', cantidad, credito = false } = body;
    if (!['market', 'limit'].includes(tipo)) throw boom.badRequest('tipo debe ser market o limit.');
    if (!['day', 'gtc'].includes(vigencia)) throw boom.badRequest('vigencia debe ser day o gtc.');
    if (typeof credito !== 'boolean') throw boom.badRequest('credito debe ser booleano.');
    if (tipo === 'limit' && !(Number.isFinite(precioLimite) && precioLimite > 0)) throw boom.badRequest('precioLimite (positivo) requerido para orden limit.');
    if (tipo === 'market' && precioLimite != null) throw boom.badRequest('Una orden market no lleva precioLimite.');
    return { tipo, vigencia, credito, ...(tipo === 'limit' ? { precioLimite } : {}), cantidad };
  }

  return {
    asegurarConexion,
    nombreBrokerDe,

    // 0) GET /brokers/disponibles
    async disponibles() {
      return { items: Object.values(BROKERS).map(m => {
        const a = integraciones[m.codigo];
        const configurado = Boolean(a?.configurado);
        return { codigo: m.codigo, nombre: m.nombre, configurado, operativo: configurado, entornos: ['paper'],
          ...(configurado ? {} : { mensaje: m.codigo === 'webull'
            ? 'Faltan WEBULL_APP_KEY / WEBULL_APP_SECRET en el servidor (o WEBULL_ENTORNO/WEBULL_BASE_URL no permitidos: solo paper).'
            : 'Faltan ALPACA_KEY_ID / ALPACA_SECRET_KEY en el servidor.' }) };
      }) };
    },

    // 1) POST /broker/paper/conexion  (body opcional { broker })
    ensureConexion: (ctx, body) => asegurarYVerificar(ctx, codigoBroker(body?.broker)),

    // 2) GET /broker/paper/resumen?broker=
    async resumen(ctx, brokerParam) {
      const codigo = codigoBroker(brokerParam);
      const adaptador = adaptadorDe(integraciones, codigo);
      const conexion = await asegurarConexion(ctx, codigo);
      let cuenta = null, error;
      try { const { conexionId, estadoConexion, ...resto } = await broker.verificar(ctx, conexion._id); cuenta = resto; }
      catch (e) { error = mensajeError(e); }
      let avisoSincronizacion; // se muestra lo vivo, pero lo guardado (necesario para cerrar) puede estar atrasado
      try { await sync.ejecutar(ctx, { recurso: 'posiciones', conexionId: conexion._id }); }
      catch (e) { avisoSincronizacion = 'No se pudieron guardar las posiciones: ' + mensajeError(e); }
      // Si el broker no da las posiciones, se avisa y se muestran cuenta y órdenes; nunca "sin posiciones".
      let vivas = [], posicionesDisponibles = true;
      try { vivas = await adaptador.posiciones(); }
      catch (e) { posicionesDisponibles = false; avisoSincronizacion = 'No se pudieron consultar las posiciones: ' + mensajeError(e); }
      const simbolos = [...new Set(vivas.map(p => p.simbolo))];
      const contratos = new Map((await Promise.all(simbolos.map(s => todos('contratos', ctx, { proveedor: 'alpaca', contratoExternoId: s }, factory)))).flat().map(c => [c.contratoExternoId, c]));
      const guardadas = new Map((await todos('posiciones', ctx, { conexionId: conexion._id }, factory)).filter(p => p.estado === 'abierta').map(p => [p.posicionExternaId, p]));
      const posiciones = vivas.map(p => {
        const c = contratos.get(p.simbolo), occ = c ? null : parsearOcc(p.simbolo), g = guardadas.get(p.posicionExternaId || p.simbolo);
        const signo = p.lado ? (p.lado === 'short' ? -1 : 1) : null;
        const base = p.precioPromedio != null && p.cantidad != null ? p.precioPromedio * p.cantidad * 100 : null;
        const pl = p.plNoRealizado ?? (signo && base != null && p.precioActual != null ? (p.precioActual - p.precioPromedio) * p.cantidad * 100 * signo : null);
        const plPct = p.plPctNoRealizado != null ? p.plPctNoRealizado * 100 : (pl != null && base ? pl / base * 100 : null);
        return { posicionId: g?._id ?? null, contratoId: c?._id ?? null, simbolo: p.simbolo,
          subyacente: c ? (c.simbolo && OCC.test(c.simbolo) ? parsearOcc(c.simbolo).subyacente : c.simbolo) : (occ?.subyacente ?? p.simbolo),
          tipo: c?.tipo ?? occ?.tipo ?? null, strike: c?.strike ?? occ?.strike ?? null, vencimiento: c ? fechaDia(c.vencimiento) : (occ?.vencimiento ?? null),
          lado: p.lado, cantidad: p.cantidad, precioPromedio: p.precioPromedio, precioActual: p.precioActual, valorMercado: p.valorMercado, pl, plPct,
          grupoId: p.grupoId ?? null, cerrable: Boolean(g) && g.cerrable !== false && p.cerrable !== false };
      });
      const locales = await todos('ordenes', ctx, { conexionId: conexion._id }, factory);
      const ordenesExternas = (await ordenesAjenas(adaptador, locales)).map(o => ({ ordenExternaId: o.ordenExternaId, estado: o.estado, componentes: o.componentes.map(c => ({ simbolo: c.simbolo, accion: c.accion })) }));
      const ordenes = [...locales]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 15)
        .map(o => ({ _id: o._id, estado: o.estado, tipo: o.tipo, cantidad: o.cantidad, precioLimite: o.precioLimite ?? null, credito: Boolean(o.credito), componentes: o.componentes,
          cantidadEjecutada: o.cantidadEjecutada ?? null, precioPromedioEjecucion: o.precioPromedioEjecucion ?? null,
          createdAt: o.createdAt, ordenExternaId: o.ordenExternaId ?? null, eventos: (o.eventos || []).slice(-3) }));
      return { conexionId: conexion._id, broker: codigo, cuenta, ...(error ? { error } : {}), ...(avisoSincronizacion ? { avisoSincronizacion } : {}), posicionesDisponibles, posiciones, ordenes, ordenesExternas };
    },

    // 3) POST /ordenes/ticket
    async ticket(ctx, body, idempotencyKey) {
      const key = claveIdempotencia(idempotencyKey);
      const huella = huellaTicket(body);
      const previa = await reintentar(ctx, key, huella);
      if (previa) return previa;
      const codigo = codigoBroker(body?.broker);
      const base = validarOrdenBase(body);
      if (!Number.isSafeInteger(base.cantidad) || base.cantidad < 1 || base.cantidad > 100) throw boom.badRequest('cantidad debe ser un entero entre 1 y 100.');
      if (!Array.isArray(body.componentes) || body.componentes.length < 1 || body.componentes.length > 4) throw boom.badRequest('componentes: de 1 a 4 patas.');
      if (body.componentes.length < 2) base.credito = false; // sin sentido en una sola pata: se ignora
      if (body.estrategiaCodigo != null && !ESTRATEGIAS.includes(body.estrategiaCodigo)) throw boom.badRequest('estrategiaCodigo: ' + ESTRATEGIAS.join(', ') + '.');
      const empresa = await obtener('empresas', ctx, body.empresaId, factory);
      const hoy = ahora().toISOString().slice(0, 10), vistos = new Set(), componentes = [], contratos = [];
      for (const c of body.componentes) {
        if (!c || typeof c !== 'object') throw boom.badRequest('Pata inválida.');
        if (!['buy', 'sell'].includes(c.accion)) throw boom.badRequest('accion debe ser buy o sell.');
        const intencion = c.intencion ?? `${c.accion}_to_open`;
        if (!INTENCIONES.includes(intencion) || !intencion.startsWith(c.accion + '_')) throw boom.badRequest('intencion inválida para la acción.');
        const proporcion = c.proporcion ?? 1;
        if (!Number.isSafeInteger(proporcion) || proporcion < 1 || proporcion > PROPORCION_MAX) throw boom.badRequest('proporcion debe ser un entero entre 1 y ' + PROPORCION_MAX + '.');
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
      adaptadorDe(integraciones, codigo);
      const conexion = await asegurarConexion(ctx, codigo);
      const { cantidad, ...resto } = base;
      return { brokerNombre: BROKERS[codigo].nombre, ...await crearYEnviar(ctx, key, huella, { conexion, empresaId: empresa._id, estrategia, nombre, orden: { ...resto, cantidad }, componentes }) };
    },

    // 4) POST /posiciones/:id/cierre
    cierre: (ctx, posicionId, body, idempotencyKey) => cerrar(ctx, [posicionId], body, idempotencyKey),

    // 5) POST /posiciones/cierre-grupo: una sola orden multi-pata {posicionIds[2-4], tipo, precioLimite?, credito?}
    async cierreGrupo(ctx, body, idempotencyKey) {
      const ids = body?.posicionIds;
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw boom.badRequest('posicionIds: de 2 a 4 posiciones distintas.');
      return cerrar(ctx, ids, body, idempotencyKey);
    },
  };
}
