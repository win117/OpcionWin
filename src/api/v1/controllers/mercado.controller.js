import boom from '@hapi/boom';
import { createCrudService } from '../services/crud.service';
import { handle, respond } from './crud.controller';
export default factory => {
  const crud = name => createCrudService(name, factory);
  const forCompany = (name, extra = {}) => handle(async(req,res) => {
    const matches = await crud('empresas').list(req.context,{simbolo:req.params.simbolo.toUpperCase()});
    if (!matches.items.length) throw boom.notFound('Empresa no registrada.');
    respond(res,await crud(name).list(req.context,{...req.query,...extra,empresaId:matches.items[0]._id}));
  });
  return {
    quotes: forCompany('datos-mercado',{tipo:'cotizacion'}),
    history: forCompany('datos-mercado',{tipo:'vela'}),
    fundamentals: forCompany('fundamentales'),
    institutional: forCompany('institucional'),
    snapshot: handle(async(req,res)=>respond(res,await crud('datos-mercado').list(req.context,{...req.query,tipo:'snapshot_opcion',contratoId:req.params.contratoId}))),
  };
};
