import service from '../services/sincronizaciones.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('sincronizaciones', factory));
export default crudController(service);
