import { Router } from 'express';
import { analisis as rutas } from '../schemas';
import controller from '../controllers/cores.controller';
import { registrar } from './registrar';

export default ({ factory } = {}) => {
  const router = Router(), c = controller(factory);
  router.base = '/cores';
  registrar(router, rutas.listarEvaluaciones, c.list);
  registrar(router, rutas.verEvaluacion, c.get);
  return router;
};
