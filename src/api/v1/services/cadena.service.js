// Cadena de opciones como la muestra un broker: todos los vencimientos que existen y cualquiera de ellos bajo demanda.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { guardarLote, todos } from './registros';
import { documentosOpciones, empresaPorSimbolo } from './sincronizacion.service';
import { diaNY } from './mercado-reloj.service';

const fecha = d => new Date(d).getTime();
const DIA = 86400000, ANIOS = 3, VIGENCIA_MS = 10 * 60000, REPETIR_MS = 10000, MAX_STRIKES = 60, MAX_CACHE = 500;
const dia = c => new Date(c.vencimiento).toISOString().slice(0, 10);
const diaDe = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Une contratos y snapshots guardados en la respuesta que usan la cadena, el panel y el ticket. */
function armar({ empresa, contratos, snapshots, vencimiento, precio }) {
  const hoy = diaNY(Date.now()), vigentes = contratos.filter(c => c.activo !== false && c.vencimiento && dia(c) >= hoy);
  const vencimientos = [...new Set(vigentes.map(dia))].sort(), elegido = vencimiento || vencimientos[0] || null;
  const snaps = new Map();
  for (const s of snapshots) {
    const prev = snaps.get(s.contratoId);
    if (!prev || fecha(s.fuente?.fechaDato) > fecha(prev.fuente?.fechaDato)) snaps.set(s.contratoId, s);
  }
  const items = vigentes.filter(c => dia(c) === elegido).map(c => {
    const s = snaps.get(c._id);
    return { contratoId: c._id, simbolo: c.simbolo, tipo: c.tipo, strike: c.strike, vencimiento: dia(c),
      bid: s?.bid ?? null, ask: s?.ask ?? null, ultimo: s?.ultimo ?? null, ultimoFecha: s?.ultimoFecha ?? null, cierreAnterior: s?.cierreAnterior ?? null, volumen: s?.volumen ?? null,
      volatilidadImplicita: s?.volatilidadImplicita ?? null, interesAbierto: c.interesAbierto ?? null, interesAbiertoFecha: diaDe(c.interesAbiertoFecha),
      griegas: s?.griegas ?? null, fechaDato: s?.fuente?.fechaDato ?? null };
  }).sort((a, b) => a.strike - b.strike || String(a.tipo).localeCompare(String(b.tipo)));
  // Cuánto se sabe de cada vencimiento: los recién listados existen, pero nadie los ha cotizado ni negociado todavía.
  const detalle = new Map(vencimientos.map(v => [v, { vencimiento: v, contratos: 0, conPrecio: 0, conInteres: 0 }]));
  for (const c of vigentes) {
    const d = detalle.get(dia(c)), s = snaps.get(c._id);
    d.contratos += 1; d.conPrecio += s?.bid > 0 || s?.ultimo > 0 ? 1 : 0; d.conInteres += c.interesAbierto > 0 ? 1 : 0;
  }
  return { empresa: { _id: empresa._id, simbolo: empresa.simbolo, nombre: empresa.nombre }, precioSubyacente: precio ?? null,
    vencimientos, detalleVencimientos: [...detalle.values()], vencimiento: elegido, items, total: items.length,
    fechaDato: items.reduce((max, i) => (i.fechaDato && (!max || fecha(i.fechaDato) > fecha(max)) ? i.fechaDato : max), null) };
}

export function createCadena({ integraciones, factory = repository, ahora = Date.now } = {}) {
  const alpaca = () => integraciones.alpaca;
  const cache = new Map(), enCurso = new Map();
  const recordar = (m, k, v) => { m.delete(k); m.set(k, v); if (m.size > MAX_CACHE) m.delete(m.keys().next().value); };
  const empresaDe = (ctx, simbolo) => empresaPorSimbolo(ctx, simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
  const datos = (ctx, empresa, tipo) => todos('datos-mercado', ctx, { empresaId: empresa._id, tipo }, factory);
  const guardados = (ctx, empresa) => todos('contratos', ctx, { empresaId: empresa._id }, factory);

  async function descargar(ctx, empresa, vencimiento) {
    const filtro = { vencimientoDesde: vencimiento, vencimientoHasta: vencimiento };
    const [q, todosStrikes, snaps, previos, contratos] = await Promise.all([
      alpaca().cotizacion(empresa.simbolo).catch(() => null), alpaca().contratos({ subyacente: empresa.simbolo, ...filtro }),
      alpaca().snapshotsOpciones(empresa.simbolo, filtro), datos(ctx, empresa, 'snapshot_opcion'), guardados(ctx, empresa),
    ]);
    const precio = q?.ultimo ?? q?.cierre;
    let lista = todosStrikes;
    if (precio > 0) {
      const cerca = new Set([...new Set(lista.map(c => c.strike))].sort((a, b) => Math.abs(a - precio) - Math.abs(b - precio)).slice(0, MAX_STRIKES));
      lista = lista.filter(c => cerca.has(c.strike));
    }
    if (!lista.length) throw boom.notFound('No hay contratos para ese vencimiento.');
    const docs = documentosOpciones(ctx, empresa, lista, snaps, previos);
    await guardarLote('contratos', ctx, docs.contratos, factory); // la orden los necesita guardados
    // Las cotizaciones ya van en la respuesta: se guardan sin hacer esperar. Si falla, la próxima consulta las trae de nuevo.
    const guardando = guardarLote('datos-mercado', ctx, docs.snapshots, factory).catch(() => 0);
    const unir = (viejos, nuevos) => [...new Map([...viejos.map(x => [x._id, x]), ...nuevos.map(x => [x.id, { _id: x.id, ...x.datos }])]).values()];
    return { guardando, respuesta: armar({ empresa, contratos: unir(contratos, docs.contratos), snapshots: unir(previos, docs.snapshots), vencimiento, precio }) };
  }

  return {
    // Lo guardado de un vencimiento, sin llamar al proveedor. Precio: última cotización o, si no hay, cierre de la última vela.
    async resumen(ctx, simbolo, vencimiento) {
      const empresa = await empresaDe(ctx, simbolo);
      const [contratos, snapshots, cotizaciones] = await Promise.all([guardados(ctx, empresa), datos(ctx, empresa, 'snapshot_opcion'), datos(ctx, empresa, 'cotizacion')]);
      const ultima = lista => lista.sort((a, b) => fecha(b.fuente.fechaDato) - fecha(a.fuente.fechaDato))[0];
      const cot = ultima(cotizaciones.filter(q => q.ultimo != null && q.fuente?.fechaDato));
      const vela = cot ? null : ultima((await datos(ctx, empresa, 'vela')).filter(v => v.cierre != null && v.fuente?.fechaDato));
      return armar({ empresa, contratos, snapshots, vencimiento, precio: cot?.ultimo ?? vela?.cierre });
    },
    // Solo calls cercanos al precio: basta para saber qué fechas existen y evita recorrer miles de contratos.
    async vencimientos(simbolo) {
      const hoy = diaNY(ahora()), previo = cache.get(simbolo);
      if (previo && previo.hoy === hoy && ahora() - previo.t < VIGENCIA_MS) return previo.dato;
      const q = await alpaca().cotizacion(simbolo).catch(() => null), precio = q?.ultimo ?? q?.cierre;
      const banda = precio > 0 ? { strikeMin: Math.floor(precio * 0.85), strikeMax: Math.ceil(precio * 1.15) } : {};
      const pedir = extra => alpaca().contratos({ subyacente: simbolo, tipo: 'call', vencimientoDesde: hoy, vencimientoHasta: new Date(ahora() + ANIOS * 365 * DIA).toISOString().slice(0, 10), ...extra });
      let lista = await pedir(banda);
      if (!lista.length && precio > 0) lista = await pedir({});
      const items = [...new Set(lista.map(c => c.vencimiento))].sort(), dato = { items, total: items.length };
      recordar(cache, simbolo, { t: ahora(), hoy, dato });
      return dato;
    },
    // Trae del proveedor un vencimiento, lo guarda y lo devuelve. Repetirlo en segundos comparte la misma descarga.
    async traer(ctx, simbolo, vencimiento) {
      if (vencimiento < diaNY(ahora())) throw boom.badRequest('Ese vencimiento ya pasó.');
      const empresa = await empresaDe(ctx, simbolo), clave = [ctx.database, ctx.userId, empresa.simbolo, vencimiento].join('|'), previo = enCurso.get(clave);
      if (!previo || ahora() - previo.t > REPETIR_MS) {
        const tarea = descargar(ctx, empresa, vencimiento);
        recordar(enCurso, clave, { t: ahora(), tarea });
        tarea.catch(() => enCurso.delete(clave));
      }
      return (await enCurso.get(clave).tarea).respuesta;
    },
    // Cotización directa de contratos concretos (no se guarda): refresca la cadena y el ticket.
    async cotizaciones(contratos) {
      const items = await alpaca().snapshotsOpciones(contratos);
      return { items, total: items.length, fuente: { proveedor: 'alpaca', feed: 'indicative' } };
    },
  };
}
