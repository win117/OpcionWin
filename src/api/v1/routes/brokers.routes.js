import { forRepository } from '../controllers/brokers.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('brokers', forRepository(factory), factory);
