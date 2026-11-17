import { forRepository } from '../controllers/sincronizaciones.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('sincronizaciones', forRepository(factory), factory);
