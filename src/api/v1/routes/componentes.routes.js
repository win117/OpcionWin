import controller from '../controllers/componentes.controller';
import { childRouter } from './crud.routes';
export default ({ factory } = {}) => childRouter(controller(factory));
