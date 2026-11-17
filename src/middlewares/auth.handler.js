import boom from '@hapi/boom';
export const authenticate = service => async (req,res,next) => {
  try {
    const match = /^Bearer (\S+)$/.exec(req.get('Authorization') || '');
    if (!match) throw boom.unauthorized('Envía Authorization: Bearer <token>.');
    req.context = { ...await service.authenticate(match[1]), requestId: req.requestId };
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) { next(error); }
};
export function loginLimit() {
  const requests = new Map();
  return (req,res,next) => {
    const now = Date.now(), key = req.ip;
    for (const [ip, entry] of requests) if (entry.until <= now) requests.delete(ip);
    if (!requests.has(key)) {
      if (requests.size >= 10000) return next(boom.tooManyRequests());
      requests.set(key,{count:0,until:now+60000});
    }
    const entry = requests.get(key); entry.count++;
    if (entry.count > 10) return next(boom.tooManyRequests('Espera un minuto antes de volver a intentar.'));
    next();
  };
}
