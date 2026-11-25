// Operación con brokers, solo paper. Las reglas de negocio (contrato vigente, misma empresa, posición abierta…) siguen en los servicios.
import { z, id, broker, estrategia, idempotencia, definir } from './comunes';

const grupo = 'Operación (paper)';
const deOrden = { params: z.object({ id }) };
const precio = {
  tipo: z.enum(['market', 'limit']), precioLimite: z.number().positive().nullish().describe('Obligatorio en limit; siempre positivo'),
  vigencia: z.enum(['day', 'gtc']).optional(), credito: z.boolean().optional().describe('Solo en varias patas: true si se cobra al abrir'),
};
const repetida = { 200: 'Idempotency-Key ya usada: devuelve la orden existente', 409: 'Clave usada con otros datos, o conflicto de estado' };
const brokerQuery = z.object({ broker: broker.or(z.literal('')).optional() });

export const brokersDisponibles = definir({ metodo: 'get', ruta: '/brokers/disponibles', grupo, resumen: 'Brokers y si están operativos en el servidor.' });
export const conexion = definir({ metodo: 'post', ruta: '/broker/paper/conexion', grupo, resumen: 'Asegura (idempotente) la conexión paper del broker y verifica la cuenta.',
  body: z.looseObject({ broker: broker.or(z.literal('')).nullish() }).optional(), errores: { 503: 'Sin credenciales en el servidor' } });
export const resumen = definir({ metodo: 'get', ruta: '/broker/paper/resumen', grupo, resumen: 'Cuenta, posiciones vivas y últimas órdenes; avisa de órdenes abiertas que no salieron de esta sesión.', query: brokerQuery });
export const historial = definir({ metodo: 'get', ruta: '/broker/paper/historial', grupo, resumen: 'Valor diario de la cuenta simulada: {disponible, items:[{fecha, valor}]}. Webull no lo ofrece.',
  query: z.object({ broker: broker.optional(), periodo: z.enum(['1W', '1M', '3M', '1A']).optional() }) });
export const verificarConexion = definir({ metodo: 'post', ruta: '/conexiones-broker/:id/verificacion', grupo, resumen: 'Verifica la cuenta y activa la conexión.', ...deOrden });

export const ticket = definir({ metodo: 'post', ruta: '/ordenes/ticket', grupo, resumen: 'Crea la configuración y la orden, y la envía al broker.', exito: 201, headers: idempotencia, errores: { ...repetida, 503: 'Sin credenciales' },
  body: z.looseObject({ broker: broker.or(z.literal('')).nullish(), empresaId: id, estrategiaCodigo: estrategia.nullish(), ...precio, cantidad: z.number().int().min(1).max(100),
    componentes: z.array(z.looseObject({ contratoId: id, accion: z.enum(['buy', 'sell']), intencion: z.enum(['buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close']).nullish(), proporcion: z.number().int().min(1).max(10).nullish() })).min(1).max(4) }) });
export const enviar = definir({ metodo: 'post', ruta: '/ordenes/:id/envio', grupo, resumen: 'Envía una orden pendiente (idempotente).', ...deOrden, headers: idempotencia, errores: { 403: 'Entorno no paper', 409: 'Clave distinta o estado inválido' } });
export const cancelar = definir({ metodo: 'post', ruta: '/ordenes/:id/cancelacion', grupo, resumen: 'Cancela una orden en el broker.', ...deOrden, errores: { 409: 'La orden ya terminó' } });
export const actualizar = definir({ metodo: 'post', ruta: '/ordenes/:id/actualizacion', grupo, resumen: 'Consulta esa orden en el broker y devuelve su estado.', ...deOrden });

export const cerrarGrupo = definir({ metodo: 'post', ruta: '/posiciones/cierre-grupo', grupo, resumen: 'Cierra de 2 a 4 posiciones con una sola orden.', exito: 201, headers: idempotencia, errores: repetida,
  body: z.looseObject({ posicionIds: z.array(id).min(2).max(4), ...precio }) });
export const cerrar = definir({ metodo: 'post', ruta: '/posiciones/:id/cierre', grupo, resumen: 'Cierra una posición con lado y cantidad en vivo.', ...deOrden, exito: 201, headers: idempotencia, errores: repetida, body: z.looseObject(precio) });
