import { forRepository } from '../controllers/noticias.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('noticias', forRepository(factory), factory);
