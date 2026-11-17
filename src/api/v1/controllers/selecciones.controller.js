import service from '../services/selecciones.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('selecciones', factory));
export default crudController(service);
