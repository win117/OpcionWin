import service from '../services/estrategias.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('estrategias', factory));
export default crudController(service);
