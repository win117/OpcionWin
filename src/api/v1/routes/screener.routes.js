// Ranking por estrategia del universo vivo (o lo último guardado si no está activo).
import { Router } from 'express';
import { analisis as rutas } from '../schemas';
import controller from '../controllers/analisis.controller';
import { registrar } from './registrar';

export default deps => {
  const router = Router(), c = controller(deps);
  router.base = '/screener';
  return registrar(router, rutas.ranking, c.ranking);
};
