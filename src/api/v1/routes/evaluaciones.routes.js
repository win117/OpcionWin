import { forRepository } from '../controllers/evaluaciones.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('evaluaciones', forRepository(factory), factory);
