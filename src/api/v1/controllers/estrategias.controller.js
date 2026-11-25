import { forRepository as servicio } from '../services/estrategias.service';
import { crudController } from './crud.controller';

export const forRepository = factory => crudController(servicio(factory));
