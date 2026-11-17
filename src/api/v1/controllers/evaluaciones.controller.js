import service from '../services/evaluaciones.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('evaluaciones', factory));
export default crudController(service);
