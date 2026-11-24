// Screener: ranking por estrategia leído de datos guardados + trabajo de fondo que refresca el universo.
import { Router } from 'express';
import { handle, respond } from '../controllers/crud.controller';
import { input } from '../services/crud.service';
import { registrarEvento } from '../services/auditoria.service';
import { createScreener } from '../services/screener.service';

export default ({ factory, integraciones, cola, ahora } = {}) => {
  const router = Router();
  const screener = createScreener({ integraciones, factory, cola, ahora });
  router.post('/universo/sincronizaciones', handle(async (req, res) => {
    const trabajo = await screener.iniciarSincronizacion(req.context, input(req.body ?? {}));
    await registrarEvento(req.context, { accion: 'screener.sincronizar', recurso: 'sincronizaciones', recursoId: trabajo._id }, factory);
    respond(res, trabajo, 202, 'Trabajo en proceso. Consulta el registro hasta completada o fallida.');
  }));
  router.get('/universo/sincronizaciones/:id', handle(async (req, res) => respond(res, await screener.obtenerSincronizacion(req.context, req.params.id))));
  router.get('/ranking', handle(async (req, res) => respond(res, await screener.ranking(req.context, { estrategia: req.query.estrategia, limite: req.query.limite }))));
  return router;
};
