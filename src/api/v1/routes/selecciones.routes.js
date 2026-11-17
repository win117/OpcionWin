import { forRepository } from '../controllers/selecciones.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('selecciones', forRepository(factory), factory);
