// Todas las rutas que no son CRUD, descritas una sola vez. Las CRUD salen de los modelos (routes/crud.routes.js).
import * as sesiones from './sesiones.schema';
import * as analisis from './analisis.schema';
import * as integraciones from './integraciones.schema';
import * as operacion from './operacion.schema';
import * as mercado from './mercado.schema';

const deRuta = modulo => Object.values(modulo).filter(d => d?.metodo && d?.ruta);
export const rutas = [sesiones, analisis, integraciones, operacion, mercado].flatMap(deRuta);
export { sesiones, analisis, integraciones, operacion, mercado };
