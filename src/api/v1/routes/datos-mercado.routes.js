import { forRepository } from '../controllers/datos-mercado.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('datos-mercado', forRepository(factory), factory);
