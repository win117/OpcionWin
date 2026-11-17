import service from '../services/confluencias.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('confluencias', factory));
export default crudController(service);
