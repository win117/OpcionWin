import { Router } from 'express';
import createController from '../controllers/sesiones.controller';
import { authenticate, loginLimit } from '../../../middlewares/auth.handler';
export default ({ auth }) => {
  const router=Router(), controller=createController(auth);
  router.post('/',loginLimit(),controller.login);
  router.get('/actual',authenticate(auth),controller.current);
  router.delete('/actual',authenticate(auth),controller.logout);
  return router;
};
