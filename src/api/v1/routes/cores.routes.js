import { Router } from 'express';
import controller from '../controllers/cores.controller';
export default ({factory}={})=>{
  const router=Router(), c=controller(factory);
  router.get('/:core/evaluaciones',c.list);
  router.get('/:core/evaluaciones/:id',c.get);
  return router;
};
