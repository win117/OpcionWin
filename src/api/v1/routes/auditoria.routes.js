import { forRepository } from '../controllers/auditoria.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('auditoria', forRepository(factory), factory);
