import boom from '@hapi/boom';
import { usuarioActual } from '../jobs/cola';
export { loginLimit } from './limites.handler';
export const authenticate = service => async (req,res,next) => {
  try {
    const match = /^Bearer (\S+)$/.exec(req.get('Authorization') || '');
    if (!match) throw boom.unauthorized('Envía Authorization: Bearer <token>.');
    req.context = { ...await service.authenticate(match[1]), requestId: req.requestId };
    res.set('Cache-Control', 'no-store');
    req.app.locals.limiteOperaciones?.(req, res);
    // La cola identifica al dueño de cada trabajo a partir de este contexto.
    usuarioActual.run(req.context.userId, next);
  } catch (error) { next(error); }
};
