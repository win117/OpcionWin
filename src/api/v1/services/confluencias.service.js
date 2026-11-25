import { createCrudService } from './crud.service';

// Servicio del módulo: reglas comunes de CRUD. Aquí van las reglas propias cuando las haya (ver ordenes.service.js).
export const forRepository = factory => createCrudService('confluencias', factory);
