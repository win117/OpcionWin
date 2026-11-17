import { forRepository } from '../controllers/confluencias.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('confluencias', forRepository(factory), factory);
