import { Router } from 'express';
import boom from '@hapi/boom';
import { forRepository } from '../controllers/auditoria.controller';
import { moduleRouter } from './crud.routes';
// La API solo lee estos registros: los escribe el servidor.
export const soloLectura = (req, _res, next) => next(['GET', 'HEAD'].includes(req.method) ? undefined : boom.methodNotAllowed('Registro de solo lectura.'));
export default ({ factory } = {}) => Router().use(soloLectura, moduleRouter('auditoria', forRepository(factory), factory));
