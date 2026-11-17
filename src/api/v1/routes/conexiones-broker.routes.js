import { forRepository } from '../controllers/conexiones-broker.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('conexiones-broker', forRepository(factory), factory);
