import { forRepository } from '../controllers/institucional.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('institucional', forRepository(factory), factory);
