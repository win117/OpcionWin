import boom from '@hapi/boom';
import { createCrudService } from '../services/crud.service';
import { todos } from '../services/registros';
import { empresaPorSimbolo } from '../services/sincronizacion.service';
import { handle, respond } from './crud.controller';
import { createMercadoEstado, createNombres, indicesReferencia } from '../services/mercado-estado.service';
import { diaNY } from '../services/mercado-reloj.service';

const fecha = d => new Date(d).getTime();
const limite = (valor, porDefecto, maximo) => {
  const n = Number(valor ?? porDefecto);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) throw boom.badRequest('limit debe estar entre 1 y ' + maximo + '.');
  return n;
};

// Panorama de mercado (consulta directa al proveedor, sin guardar). Caché por proceso de 5 min.
const cachePanorama = new Map();
async function panoramaSimbolo(alpaca, simbolo, nombreDe, ahora = Date.now()) {
  const previo = cachePanorama.get(simbolo);
  if (previo && ahora - previo.t < 5 * 60000) return previo.dato;
  const velas = await alpaca.velas(simbolo, { intervalo: '1Day', desde: new Date(ahora - 70 * 86400000).toISOString(), hasta: new Date(ahora).toISOString(), limite: 100 });
  const q = await alpaca.cotizacion(simbolo).catch(() => null);
  const cierres = velas.map(v => ({ fecha: new Date(v.fecha).toISOString(), cierre: v.cierre })).slice(-45);
  const ultimaVela = cierres.at(-1);
  const hoy = new Date(ahora).toISOString().slice(0, 10);
  // Cierre previo: si la última vela es de hoy, la anterior; si no, la última.
  const previa = ultimaVela?.fecha.slice(0, 10) === hoy ? cierres.at(-2) : ultimaVela;
  const ultimo = q?.ultimo ?? ultimaVela?.cierre ?? null;
  const dato = { simbolo, nombre: await nombreDe(simbolo), ultimo,
    cambioPct: ultimo != null && previa?.cierre ? (ultimo - previa.cierre) / previa.cierre : null,
    cierres, fechaDato: q?.fechaDato || ultimaVela?.fecha || null };
  cachePanorama.set(simbolo, { t: ahora, dato });
  return dato;
}

export default (factory, integraciones, universo) => {
  const crud = name => createCrudService(name, factory);
  const nombreDe = createNombres({ integraciones });
  const estadoMercado = createMercadoEstado({ integraciones, nombreDe });
  const forCompany = (name, extra = {}) => handle(async(req,res) => {
    const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
    respond(res,await crud(name).list(req.context,{...req.query,...extra,empresaId:empresa._id}));
  });
  // Serie ordenada por fecha (las más recientes), lista para gráficos de velas.
  const serie = tipo => handle(async (req, res) => {
    const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
    const n = limite(req.query.limit, tipo === 'vela' ? 300 : 20, 10000);
    const intervalo = req.query.intervalo || '1Day';
    const items = (await todos('datos-mercado', req.context, { empresaId: empresa._id, tipo }, factory))
      .filter(v => tipo !== 'vela' || (v.intervalo || '1Day') === intervalo)
      .sort((a, b) => fecha(a.fuente.fechaDato) - fecha(b.fuente.fechaDato)).slice(-n);
    respond(res, { items, page: 1, limit: n, total: items.length, empresa: { _id: empresa._id, simbolo: empresa.simbolo, nombre: empresa.nombre } });
  });
  return {
    estado: handle(async (_req, res) => respond(res, await estadoMercado())),
    movimientos: handle(async (_req, res) => respond(res, universo.movimientos())),
    mapa: handle(async (_req, res) => respond(res, await universo.mapa())),
    ficha: handle(async (req, res) => respond(res, await universo.ficha(String(req.params.simbolo).toUpperCase()))),
    quotes: serie('cotizacion'),
    history: serie('vela'),
    fundamentals: forCompany('fundamentales'),
    institutional: forCompany('institucional'),
    snapshot: handle(async(req,res)=>respond(res,await crud('datos-mercado').list(req.context,{...req.query,tipo:'snapshot_opcion',contratoId:req.params.contratoId}))),
    // Contratos guardados + snapshot almacenado (IV y griegas) de un vencimiento vigente (fecha de Nueva York); no llama al proveedor.
    resumenOpciones: handle(async (req, res) => {
      const { vencimiento } = req.query;
      if (vencimiento !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) throw boom.badRequest('vencimiento: AAAA-MM-DD.');
      const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
      const dia = c => new Date(c.vencimiento).toISOString().slice(0, 10), hoy = diaNY(Date.now());
      const contratos = (await todos('contratos', req.context, { empresaId: empresa._id }, factory)).filter(c => c.activo !== false && c.vencimiento && dia(c) >= hoy);
      const vencimientos = [...new Set(contratos.map(dia))].sort();
      const elegido = vencimiento || vencimientos[0] || null;
      const snaps = new Map();
      for (const s of await todos('datos-mercado', req.context, { empresaId: empresa._id, tipo: 'snapshot_opcion' }, factory)) {
        const prev = snaps.get(s.contratoId);
        if (!prev || fecha(s.fuente?.fechaDato) > fecha(prev.fuente?.fechaDato)) snaps.set(s.contratoId, s);
      }
      const items = contratos.filter(c => dia(c) === elegido).map(c => {
        const s = snaps.get(c._id);
        return { contratoId: c._id, simbolo: c.simbolo, tipo: c.tipo, strike: c.strike, vencimiento: dia(c),
          bid: s?.bid ?? null, ask: s?.ask ?? null, ultimo: s?.ultimo ?? null, volatilidadImplicita: s?.volatilidadImplicita ?? null,
          griegas: s?.griegas ?? null, fechaDato: s?.fuente?.fechaDato ?? null };
      }).sort((a, b) => a.strike - b.strike || String(a.tipo).localeCompare(String(b.tipo)));
      // Precio del subyacente: última cotización guardada; si no hay, cierre de la última vela.
      const ultima = lista => lista.sort((a, b) => fecha(b.fuente.fechaDato) - fecha(a.fuente.fechaDato))[0];
      const cot = ultima((await todos('datos-mercado', req.context, { empresaId: empresa._id, tipo: 'cotizacion' }, factory)).filter(q => q.ultimo != null && q.fuente?.fechaDato));
      const vela = cot ? null : ultima((await todos('datos-mercado', req.context, { empresaId: empresa._id, tipo: 'vela' }, factory)).filter(v => v.cierre != null && v.fuente?.fechaDato));
      respond(res, { empresa: { _id: empresa._id, simbolo: empresa.simbolo, nombre: empresa.nombre }, precioSubyacente: cot?.ultimo ?? vela?.cierre ?? null,
        vencimientos, vencimiento: elegido, items, total: items.length,
        fechaDato: items.reduce((max, i) => (i.fechaDato && (!max || fecha(i.fechaDato) > fecha(max)) ? i.fechaDato : max), null) });
    }),
    // Consultas directas al proveedor (no se guardan; para guardar usar /sincronizaciones/ejecuciones).
    panorama: handle(async (req, res) => {
      const lista = req.query.simbolos ? String(req.query.simbolos).split(',').map(x => x.trim().toUpperCase()).filter(Boolean) : indicesReferencia();
      if (lista.length > 8 || lista.some(x => !/^[A-Z][A-Z0-9.]{0,9}$/.test(x))) throw boom.badRequest('simbolos: hasta 8 símbolos separados por coma.');
      const items = await Promise.all(lista.map(x => panoramaSimbolo(integraciones.alpaca, x, nombreDe).catch(e => ({ simbolo: x, nombre: x, error: e?.mensaje || 'Sin datos' }))));
      respond(res, { items, total: items.length, fuente: { proveedor: 'alpaca', feed: integraciones.alpaca.feed || 'iex' } });
    }),
    liveQuote: handle(async (req, res) => respond(res, await integraciones.alpaca.cotizacion(req.params.simbolo.toUpperCase()))),
    chain: handle(async (req, res) => {
      const simbolo = req.params.simbolo.toUpperCase();
      const { vencimiento, tipo } = req.query;
      if (tipo && !['call', 'put'].includes(tipo)) throw boom.badRequest('tipo: call o put.');
      if (vencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) throw boom.badRequest('vencimiento: AAAA-MM-DD.');
      const filtro = { vencimientoDesde: vencimiento || diaNY(Date.now()), vencimientoHasta: vencimiento || diaNY(Date.now() + 60 * 86400000), ...(tipo ? { tipo } : {}) };
      const contratos = await integraciones.alpaca.contratos({ subyacente: simbolo, ...filtro });
      const snaps = new Map((contratos.length ? await integraciones.alpaca.snapshotsOpciones(simbolo, filtro) : []).map(s => [s.contratoExternoId, s]));
      const items = contratos.map(c => ({ ...c, ...(snaps.get(c.contratoExternoId) || {}) })).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.strike - b.strike);
      respond(res, { items, total: items.length, vencimientos: [...new Set(contratos.map(c => c.vencimiento))].sort(), fuente: { proveedor: 'alpaca', feed: 'indicative' } });
    }),
  };
};
