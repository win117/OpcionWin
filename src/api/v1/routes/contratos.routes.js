import { forRepository } from '../controllers/contratos.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('contratos', forRepository(factory), factory);
