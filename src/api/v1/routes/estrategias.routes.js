import { forRepository } from '../controllers/estrategias.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('estrategias', forRepository(factory), factory);
