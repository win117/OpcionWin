import service from '../services/contratos.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('contratos', factory));
export default crudController(service);
