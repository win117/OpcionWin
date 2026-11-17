import { forRepository } from '../controllers/configuraciones.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('configuraciones', forRepository(factory), factory);
