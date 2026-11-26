// Frontera del módulo de salud: lo único que importa el resto de la app. Dependencias inyectadas.
import { createSalud } from './salud.service';
import { crearControladorSalud } from './salud.controller';
import rutasSalud from './salud.routes';
import { comprobacionesReales } from './salud.comprobaciones';

export function montarSalud(app, { integraciones, cola, comprobaciones = comprobacionesReales(), ...opciones } = {}) {
  const servicio = createSalud({ integraciones, cola, comprobaciones, ...opciones });
  app.use(rutasSalud(crearControladorSalud(servicio)));
  return servicio;
}

export { crearApagado } from './apagado';
