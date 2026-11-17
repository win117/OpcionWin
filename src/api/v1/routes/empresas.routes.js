import { forRepository } from '../controllers/empresas.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('empresas', forRepository(factory), factory);
