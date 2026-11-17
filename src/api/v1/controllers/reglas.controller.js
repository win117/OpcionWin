import { createChildService } from '../services/crud.service';
import { childController } from './crud.controller';
export default factory => childController(createChildService('perfiles-analisis', 'reglas', factory));
