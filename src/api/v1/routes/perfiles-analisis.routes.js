import { forRepository } from '../controllers/perfiles-analisis.controller';
import { moduleRouter } from './crud.routes';
export default ({ factory } = {}) => moduleRouter('perfiles-analisis', forRepository(factory), factory);
