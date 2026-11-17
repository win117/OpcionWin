import service from '../services/perfiles-analisis.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('perfiles-analisis', factory));
export default crudController(service);
