import boom from '@hapi/boom';
import { registrarEvento } from '../services/auditoria.service';
import { batch, object } from '../services/crud.service';
export const handle = action => async (req, res, next) => { try { await action(req, res); } catch (error) { next(error); } };
export function respond(res, data, status = 200, message = 'Operación completada.') {
  if (data?._revision) res.set('ETag', '"' + data._revision + '"');
  return res.status(status).json({ success: data?.success !== false, message, data });
}
export const aceptar = (res, data) => respond(res, data, 202, 'Trabajo en proceso. Consulta el registro hasta completada o fallida.');
// Creación de trabajos: se audita el registro creado (el resultado final queda en el propio trabajo).
export const trabajoAuditado = factory => async (req, recurso, accion, fn) => {
  const r = await fn();
  await registrarEvento(req.context, { accion, recurso, recursoId: r?._id }, factory);
  return r;
};
function revision(req) {
  const value = req.get('If-Match');
  if (!value) return undefined;
  const parsed = value.replace(/^"|"$/g, '');
  if (!/^[1-9]\d*$/.test(parsed) || !Number.isSafeInteger(Number(parsed))) throw boom.badRequest('If-Match debe contener una versión numérica.');
  return Number(parsed);
}
export function crudController(service) {
  return {
    list: handle(async (req,res) => respond(res, await service.list(req.context,req.query))),
    get: handle(async (req,res) => respond(res, await service.get(req.context,req.params.id))),
    create: handle(async (req,res) => respond(res, await service.create(req.context,req.body),201,'Registro local creado.')),
    update: handle(async (req,res) => respond(res, await service.update(req.context,req.params.id,req.body,revision(req)))),
    remove: handle(async (req,res) => respond(res, await service.remove(req.context,req.params.id))),
    createMany: handle(async (req,res) => respond(res, await batch(object(req.body).items,item=>service.create(req.context,item)))),
    updateMany: handle(async (req,res) => respond(res, await batch(object(req.body).items,item=>{
      object(item);
      if (typeof item.id !== 'string') throw boom.badRequest('Cada elemento necesita id y datos.');
      return service.update(req.context,item.id,item.datos,item.revision);
    }))),
    removeMany: handle(async (req,res) => respond(res, await batch(object(req.body).ids,id=>service.remove(req.context,id)))),
  };
}
export function childController(service) {
  return {
    list: handle(async(req,res)=>respond(res,await service.list(req.context,req.params.id))),
    get: handle(async(req,res)=>respond(res,await service.get(req.context,req.params.id,req.params.childId))),
    create: handle(async(req,res)=>respond(res,await service.create(req.context,req.params.id,req.body),201)),
    update: handle(async(req,res)=>respond(res,await service.update(req.context,req.params.id,req.params.childId,req.body))),
    remove: handle(async(req,res)=>respond(res,await service.remove(req.context,req.params.id,req.params.childId))),
    createMany: handle(async(req,res)=>respond(res,await batch(object(req.body).items,item=>service.create(req.context,req.params.id,item)))),
    updateMany: handle(async(req,res)=>respond(res,await batch(object(req.body).items,item=>service.update(req.context,req.params.id,object(item).id,item.datos)))),
    removeMany: handle(async(req,res)=>respond(res,await batch(object(req.body).ids,id=>service.remove(req.context,req.params.id,id)))),
  };
}
export function nestedController(service) {
  return {
    get: handle(async(req,res)=>respond(res,await service.get(req.context,req.params.id))),
    create: handle(async(req,res)=>respond(res,await service.create(req.context,req.params.id,req.body),201)),
    update: handle(async(req,res)=>respond(res,await service.update(req.context,req.params.id,req.body))),
    remove: handle(async(req,res)=>respond(res,await service.remove(req.context,req.params.id))),
  };
}
