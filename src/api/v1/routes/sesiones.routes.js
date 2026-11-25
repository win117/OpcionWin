import { Router } from 'express';
import { sesiones as rutas } from '../schemas';
import createController from '../controllers/sesiones.controller';
import { authenticate, loginLimit } from '../../../middlewares/auth.handler';
import { registrar } from './registrar';

export default ({ auth }) => {
  const router = Router(), c = createController(auth);
  router.base = '/sesiones';
  router.post('/', loginLimit()); // antes de validar: un cuerpo inválido también cuenta como intento
  registrar(router, rutas.login, c.login);
  registrar(router, rutas.actual, authenticate(auth), c.current);
  registrar(router, rutas.logout, authenticate(auth), c.logout);
  return router;
};
