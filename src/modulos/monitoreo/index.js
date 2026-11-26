// Frontera del módulo de monitoreo: lo único que importa el resto de la app. Dependencias inyectadas.
//   servicio   → registrar solicitudes y capturar errores (app.js lo usa en su manejador de errores)
//   instrumentar → middleware que va al inicio, justo después del requestId
//   rutas      → /metrics y /monitoreo/*, montadas después de las cabeceras de seguridad
import { createMonitoreo } from './monitoreo.service';
import { crearControladorMonitoreo } from './monitoreo.controller';
import rutasMonitoreo from './monitoreo.routes';
import { instrumentar, rutaDe } from './instrumentacion';

export function crearMonitoreo({ env = process.env, ...opciones } = {}) {
  const servicio = createMonitoreo({
    token: env.MONITOREO_TOKEN || '', sal: env.MONITOREO_SAL || '', logJson: env.LOG_FORMATO === 'json', sentryDsn: env.SENTRY_DSN || '', ...opciones,
  });
  return { servicio, instrumentar: instrumentar(servicio), rutas: rutasMonitoreo(crearControladorMonitoreo(servicio)) };
}
export { rutaDe };
