// Datos de proveedores: estado, sincronización y búsqueda de activos.
import { Router } from 'express';
import { integraciones as rutas } from '../schemas';
import controller from '../controllers/integraciones.controller';
import { registrar } from './registrar';

export default deps => {
  const router = Router(), c = controller(deps);
  registrar(router, rutas.estado, c.estado);
  registrar(router, rutas.sincronizar, c.sincronizar);
  registrar(router, rutas.buscarActivos, c.buscarActivos);
  return router;
};
