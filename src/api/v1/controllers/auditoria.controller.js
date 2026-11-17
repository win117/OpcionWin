import service from '../services/auditoria.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('auditoria', factory));
export default crudController(service);
