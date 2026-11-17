import controller from '../controllers/reglas.controller';
import { childRouter } from './crud.routes';
export default ({ factory } = {}) => childRouter(controller(factory));
