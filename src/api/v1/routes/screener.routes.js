// Ranking por estrategia del universo vivo (o lo último guardado si no está activo).
import { Router } from 'express';
import { handle, respond } from '../controllers/crud.controller';
import { createScreener } from '../services/screener.service';

export default ({ factory, universo } = {}) => {
  const router = Router();
  const screener = createScreener({ factory, universo });
  router.get('/ranking', handle(async (req, res) => respond(res, await screener.ranking(req.context, { estrategia: req.query.estrategia, limite: req.query.limite }))));
  return router;
};
