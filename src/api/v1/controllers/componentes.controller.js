import { createChildService } from '../services/crud.service';
import { childController } from './crud.controller';
export default factory => childController(createChildService('configuraciones', 'componentes', factory));
