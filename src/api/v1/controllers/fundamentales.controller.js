import service from '../services/fundamentales.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('fundamentales', factory));
export default crudController(service);
