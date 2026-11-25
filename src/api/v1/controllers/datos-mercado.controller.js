import { forRepository as servicio } from '../services/datos-mercado.service';
import { crudController } from './crud.controller';

export const forRepository = factory => crudController(servicio(factory));
