import boom from '@hapi/boom';
import { CORES } from '../models/shared';
import { createCrudService } from '../services/crud.service';
import { handle, respond } from './crud.controller';
export default factory => {
  const service = createCrudService('evaluaciones',factory);
  const core = req => { if (!CORES.includes(req.params.core)) throw boom.notFound('Core desconocido.'); return req.params.core; };
  return {
    list: handle(async(req,res)=>respond(res,await service.list(req.context,{...req.query,core:core(req)}))),
    get: handle(async(req,res)=>{
      const selected=core(req), value=await service.get(req.context,req.params.id);
      if(value.core!==selected) throw boom.notFound();
      respond(res,value);
    }),
  };
};
