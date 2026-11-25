// Operación con brokers (solo paper): conexión, órdenes y cierre de posiciones (ADR-011).
import { Router } from 'express';
import { operacion as rutas } from '../schemas';
import controller from '../controllers/operacion.controller';
import { registrar } from './registrar';

export default deps => {
  const router = Router(), c = controller(deps);
  registrar(router, rutas.brokersDisponibles, c.brokersDisponibles);
  registrar(router, rutas.conexion, c.conexion);
  registrar(router, rutas.resumen, c.resumen);
  registrar(router, rutas.historial, c.historial);
  registrar(router, rutas.verificarConexion, c.verificarConexion);
  registrar(router, rutas.ticket, c.ticket);
  registrar(router, rutas.enviar, c.enviar);
  registrar(router, rutas.cancelar, c.cancelar);
  registrar(router, rutas.actualizar, c.actualizar);
  registrar(router, rutas.cerrarGrupo, c.cerrarGrupo);
  registrar(router, rutas.cerrar, c.cerrar);
  return router;
};
