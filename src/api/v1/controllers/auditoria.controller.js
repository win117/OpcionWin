import { forRepository as servicio } from '../services/auditoria.service';
import { crudController } from './crud.controller';

export const forRepository = factory => crudController(servicio(factory));
