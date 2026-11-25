import { forRepository as servicio } from '../services/contratos.service';
import { crudController } from './crud.controller';

export const forRepository = factory => crudController(servicio(factory));
