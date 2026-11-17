import service from '../services/institucional.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('institucional', factory));
export default crudController(service);
