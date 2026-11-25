import { forRepository as servicio } from '../services/perfiles-analisis.service';
import { crudController } from './crud.controller';

export const forRepository = factory => crudController(servicio(factory));
