// Definiciones de los endpoints de operación (openspec: monitoreo-servicio). Fuera de /api/v1 y de OpenAPI, como /health.
// Todos exigen Authorization: Bearer <MONITOREO_TOKEN>; sin token configurado no existen (404).
import { definir } from '../../api/v1/schemas/comunes';

const grupo = 'Operación';
const errores = { 401: 'Token de monitoreo inválido', 404: 'Monitoreo sin configurar (MONITOREO_TOKEN)' };
export const metricas = definir({ metodo: 'get', ruta: '/metrics', grupo, errores, resumen: 'Métricas en formato Prometheus (solicitudes, latencia, proceso, circuitos y cola).' });
export const errores_ = definir({ metodo: 'get', ruta: '/monitoreo/errores', grupo, errores, resumen: 'Errores 500 inesperados agrupados por huella.' });
export const uso = definir({ metodo: 'get', ruta: '/monitoreo/uso', grupo, errores, resumen: 'Analítica de uso por endpoint y usuario seudonimizado, con p50/p95 y rechazos.' });
