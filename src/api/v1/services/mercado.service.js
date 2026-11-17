import { createCrudService } from './crud.service';
export const empresas = createCrudService('empresas');
export const contratos = createCrudService('contratos');
export const datos = createCrudService('datos-mercado');
export const fundamentales = createCrudService('fundamentales');
export const institucional = createCrudService('institucional');
export const noticias = createCrudService('noticias');
// Datos almacenados: no se simula una respuesta de un proveedor externo.
