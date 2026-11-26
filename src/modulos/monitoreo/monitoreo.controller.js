// HTTP ↔ servicio de monitoreo. Autoriza con el token de operación y responde sin caché.
import { handle, respond } from '../../api/v1/controllers/crud.controller';

export const crearControladorMonitoreo = servicio => {
  const protegido = accion => handle(async (req, res) => { servicio.autorizar(req.get('Authorization')); res.set('Cache-Control', 'no-store'); await accion(req, res); });
  return {
    metricas: protegido(async (_req, res) => res.type('text/plain; version=0.0.4; charset=utf-8').send(servicio.metricas())),
    errores: protegido(async (_req, res) => respond(res, servicio.errores())),
    uso: protegido(async (_req, res) => respond(res, servicio.uso())),
  };
};
