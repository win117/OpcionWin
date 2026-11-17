import { forRepository } from '../controllers/fundamentales.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('fundamentales', forRepository(factory), factory);
