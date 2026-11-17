import service from '../services/conexiones-broker.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('conexiones-broker', factory));
export default crudController(service);
