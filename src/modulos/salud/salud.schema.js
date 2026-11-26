// Definición del endpoint de readiness (openspec: salud-servicio). Fuera de /api/v1 y de OpenAPI, como /health.
import { definir } from '../../api/v1/schemas/comunes';

export const listo = definir({
  metodo: 'get', ruta: '/health/listo', grupo: 'Plataforma',
  resumen: 'Readiness: si el servicio puede atender (bases de datos, circuitos de proveedores y cola). 200 listo / 503 no listo.',
  errores: { 503: 'No listo: ninguna base de datos responde o el servicio se está apagando' },
});
