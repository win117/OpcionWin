import { forRepository } from '../controllers/posiciones.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('posiciones', forRepository(factory), factory);
