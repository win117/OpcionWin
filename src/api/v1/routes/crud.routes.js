import { Router } from 'express';
import { resources } from '../../../repositories/resources';
import { createChildService } from '../services/crud.service';
import { createNestedService } from '../services/nested.service';
import { childController, nestedController } from '../controllers/crud.controller';
export function attachCrud(router, controller) {
  router.get('/',controller.list);
  router.post('/lote',controller.createMany);
  router.put('/lote',controller.updateMany);
  router.post('/eliminacion-lote',controller.removeMany);
  router.post('/',controller.create);
  router.get('/:id',controller.get);
  router.put('/:id',controller.update);
  router.delete('/:id',controller.remove);
  return router;
}
export function childRouter(controller) {
  const router=Router({mergeParams:true});
  router.get('/',controller.list);
  router.post('/lote',controller.createMany);
  router.put('/lote',controller.updateMany);
  router.post('/eliminacion-lote',controller.removeMany);
  router.post('/',controller.create);
  router.get('/:childId',controller.get);
  router.put('/:childId',controller.update);
  router.delete('/:childId',controller.remove);
  return router;
}
export function moduleRouter(name, controller, factory) {
  const router=Router();
  for(const [field,path] of Object.entries(resources[name].Model.schema.paths)){
    if(!path.schema) continue;
    if(path.$isMongooseDocumentArray){
      router.use('/:id/'+field,childRouter(childController(createChildService(name,field,factory))));
    } else {
      const c=nestedController(createNestedService(name,field,factory));
      router.route('/:id/'+field).get(c.get).post(c.create).put(c.update).delete(c.remove);
    }
  }
  return attachCrud(router,controller);
}
