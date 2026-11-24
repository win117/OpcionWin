import { Router } from 'express';
import { forRepository } from '../controllers/posiciones.controller';
import { moduleRouter } from './crud.routes';
import { soloLectura } from './auditoria.routes';
// Las posiciones vienen del broker (sincronización); se cierran con /posiciones/:id/cierre y /posiciones/cierre-grupo.
export default ({ factory } = {}) => Router().use(soloLectura, moduleRouter('posiciones', forRepository(factory), factory));
