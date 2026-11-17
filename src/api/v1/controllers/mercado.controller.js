import boom from '@hapi/boom';
import { createCrudService } from '../services/crud.service';
import { todos } from '../services/registros';
import { empresaPorSimbolo } from '../services/sincronizacion.service';
import { handle, respond } from './crud.controller';

const fecha = d => new Date(d).getTime();
const limite = (valor, porDefecto, maximo) => {
  const n = Number(valor ?? porDefecto);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) throw boom.badRequest('limit debe estar entre 1 y ' + maximo + '.');
  return n;
};

export default (factory, integraciones) => {
  const crud = name => createCrudService(name, factory);
  const forCompany = (name, extra = {}) => handle(async(req,res) => {
    const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
    respond(res,await crud(name).list(req.context,{...req.query,...extra,empresaId:empresa._id}));
  });
  // Serie ordenada por fecha (las más recientes), lista para gráficos de velas.
  const serie = tipo => handle(async (req, res) => {
    const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
    const n = limite(req.query.limit, tipo === 'vela' ? 300 : 20, 1000);
    const intervalo = req.query.intervalo || '1Day';
    const items = (await todos('datos-mercado', req.context, { empresaId: empresa._id, tipo }, factory))
      .filter(v => tipo !== 'vela' || (v.intervalo || '1Day') === intervalo)
      .sort((a, b) => fecha(a.fuente.fechaDato) - fecha(b.fuente.fechaDato)).slice(-n);
    respond(res, { items, page: 1, limit: n, total: items.length, empresa: { _id: empresa._id, simbolo: empresa.simbolo, nombre: empresa.nombre } });
  });
  return {
    quotes: serie('cotizacion'),
    history: serie('vela'),
    fundamentals: forCompany('fundamentales'),
    institutional: forCompany('institucional'),
    snapshot: handle(async(req,res)=>respond(res,await crud('datos-mercado').list(req.context,{...req.query,tipo:'snapshot_opcion',contratoId:req.params.contratoId}))),
    // Contratos guardados + snapshot almacenado (IV y griegas) de un vencimiento; no llama al proveedor.
    resumenOpciones: handle(async (req, res) => {
      const { vencimiento } = req.query;
      if (vencimiento !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) throw boom.badRequest('vencimiento: AAAA-MM-DD.');
      const empresa = await empresaPorSimbolo(req.context, req.params.simbolo, factory).catch(() => { throw boom.notFound('Empresa no registrada.'); });
      const contratos = (await todos('contratos', req.context, { empresaId: empresa._id }, factory)).filter(c => c.activo !== false && c.vencimiento);
      const dia = c => new Date(c.vencimiento).toISOString().slice(0, 10);
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
        vencimientos, vencimiento: elegido, items, total: items.length });
    }),
    // Consultas directas al proveedor (no se guardan; para guardar usar /sincronizaciones/ejecuciones).
    liveQuote: handle(async (req, res) => respond(res, await integraciones.alpaca.cotizacion(req.params.simbolo.toUpperCase()))),
    chain: handle(async (req, res) => {
      const simbolo = req.params.simbolo.toUpperCase();
      const { vencimiento, tipo } = req.query;
      if (tipo && !['call', 'put'].includes(tipo)) throw boom.badRequest('tipo: call o put.');
      if (vencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) throw boom.badRequest('vencimiento: AAAA-MM-DD.');
      const hoy = new Date().toISOString().slice(0, 10);
      const en60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const contratos = await integraciones.alpaca.contratos({ subyacente: simbolo, vencimientoDesde: vencimiento || hoy, vencimientoHasta: vencimiento || en60, ...(tipo ? { tipo } : {}) });
      const snaps = new Map((contratos.length ? await integraciones.alpaca.snapshotsOpciones(simbolo) : []).map(s => [s.contratoExternoId, s]));
      const items = contratos.map(c => ({ ...c, ...(snaps.get(c.contratoExternoId) || {}) })).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.strike - b.strike);
      respond(res, { items, total: items.length, vencimientos: [...new Set(contratos.map(c => c.vencimiento))].sort(), fuente: { proveedor: 'alpaca', feed: 'indicative' } });
    }),
  };
};
