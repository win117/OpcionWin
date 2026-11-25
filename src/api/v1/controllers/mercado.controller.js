import boom from '@hapi/boom';
import { createCrudService } from '../services/crud.service';
import { todos } from '../services/registros';
import { empresaPorSimbolo } from '../services/sincronizacion.service';
import { handle, respond } from './crud.controller';
import { createMercadoEstado, createNombres, indicesReferencia } from '../services/mercado-estado.service';
import { diaNY } from '../services/mercado-reloj.service';
import { createEventos } from '../services/eventos.service';
import { createTasa } from '../services/tasa.service';
import { createCadena } from '../services/cadena.service';

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

export default (factory, integraciones, universo, { tasa = createTasa({ integraciones }), eventos = createEventos({ integraciones }) } = {}) => {
  const crud = name => createCrudService(name, factory);
  const cadena = createCadena({ integraciones, factory });
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
    eventos: handle(async (req, res) => respond(res, await eventos(req.datos.params.simbolo))),
    tasa: handle(async (_req, res) => respond(res, await tasa.curva() || { fecha: null, puntos: [], fuente: { proveedor: 'tesoro' } })),
    // Precio diario de un contrato desde que cotiza (máximo 400 días); consulta directa, no se guarda.
    velasOpcion: handle(async (req, res) => {
      const { occ } = req.datos.params;
      const items = (await integraciones.alpaca.velasOpciones([occ], { desde: new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10) }))[occ] || [];
      respond(res, { simbolo: occ, items, total: items.length, fuente: { proveedor: 'alpaca', referencia: 'precios operados del contrato' } });
    }),
    movimientos: handle(async (_req, res) => respond(res, universo.movimientos())),
    mapa: handle(async (_req, res) => respond(res, await universo.mapa())),
    ficha: handle(async (req, res) => respond(res, await universo.ficha(String(req.params.simbolo).toUpperCase()))),
    quotes: serie('cotizacion'),
    history: serie('vela'),
    fundamentals: forCompany('fundamentales'),
    institutional: forCompany('institucional'),
    snapshot: handle(async(req,res)=>respond(res,await crud('datos-mercado').list(req.context,{...req.query,tipo:'snapshot_opcion',contratoId:req.params.contratoId}))),
    // Cadena guardada de un vencimiento (no llama al proveedor), todos los vencimientos que existen y cotización directa.
    resumenOpciones: handle(async (req, res) => respond(res, await cadena.resumen(req.context, req.params.simbolo, req.query.vencimiento))),
    vencimientos: handle(async (req, res) => respond(res, await cadena.vencimientos(req.datos.params.simbolo))),
    traerCadena: handle(async (req, res) => respond(res, await cadena.traer(req.context, req.datos.params.simbolo, req.datos.body.vencimiento))),
    cotizacionesOpciones: handle(async (req, res) => respond(res, await cadena.cotizaciones(req.datos.query.contratos))),
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
      const filtro = { vencimientoDesde: vencimiento || diaNY(Date.now()), vencimientoHasta: vencimiento || diaNY(Date.now() + 60 * 86400000), ...(tipo ? { tipo } : {}) };
      const contratos = await integraciones.alpaca.contratos({ subyacente: simbolo, ...filtro });
      const snaps = new Map((contratos.length ? await integraciones.alpaca.snapshotsOpciones(simbolo, filtro) : []).map(s => [s.contratoExternoId, s]));
      const items = contratos.map(c => ({ ...c, ...(snaps.get(c.contratoExternoId) || {}) })).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.strike - b.strike);
      respond(res, { items, total: items.length, vencimientos: [...new Set(contratos.map(c => c.vencimiento))].sort(), fuente: { proveedor: 'alpaca', feed: 'indicative' } });
    }),
  };
};
