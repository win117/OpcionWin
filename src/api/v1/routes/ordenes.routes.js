import { forRepository } from '../controllers/ordenes.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('ordenes', forRepository(factory), factory);
