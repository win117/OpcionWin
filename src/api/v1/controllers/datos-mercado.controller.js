import service from '../services/datos-mercado.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('datos-mercado', factory));
export default crudController(service);
