// Análisis: cores, confluencia, selección y configuraciones. Se monta antes de los CRUD para que /ejecuciones no se confunda con /:id.
import { Router } from 'express';
import { analisis as rutas } from '../schemas';
import controller from '../controllers/analisis.controller';
import { registrar } from './registrar';

export default deps => {
  const router = Router(), c = controller(deps);
  registrar(router, rutas.catalogoCores, c.catalogoCores);
  registrar(router, rutas.ejecutarCore, c.ejecutarCore);
  registrar(router, rutas.seleccionar, c.seleccionar);
  registrar(router, rutas.confluir, c.confluir);
  registrar(router, rutas.evaluarConfiguracion, c.evaluarConfiguracion);
  registrar(router, rutas.catalogoEstrategias, c.catalogoEstrategias);
  return router;
};
