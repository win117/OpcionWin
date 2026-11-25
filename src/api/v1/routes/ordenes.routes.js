import { Router } from 'express';
import { forRepository } from '../controllers/ordenes.controller';
import { moduleRouter } from './crud.routes';
import { soloLectura } from './auditoria.routes';

// Borradores editables hasta el primer envío (reglas en ordenes.service.js); eventos y patas los escribe el servidor.
export default ({ factory } = {}) => Router()
  .use(['/:id/eventos', '/:id/componentes'], soloLectura)
  .use(moduleRouter('ordenes', forRepository(factory), factory));
