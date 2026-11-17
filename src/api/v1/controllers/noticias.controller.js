import service from '../services/noticias.service';
import { createCrudService } from '../services/crud.service';
import { crudController } from './crud.controller';
export const forRepository = factory => crudController(createCrudService('noticias', factory));
export default crudController(service);
