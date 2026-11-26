// Solo conecta definiciones con su controlador (mismas reglas que src/api/v1/routes).
import { Router } from 'express';
import { registrar } from '../../api/v1/routes/registrar';
import { metricas, errores_, uso } from './monitoreo.schema';

export default function rutasMonitoreo(controlador) {
  const router = Router();
  registrar(router, metricas, controlador.metricas);
  registrar(router, errores_, controlador.errores);
  registrar(router, uso, controlador.uso);
  return router;
}
