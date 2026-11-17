import service from '../services/ordenes.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('ordenes', factory));
export default crudController(service);
