// Valida una petición con los esquemas de su definición (api/v1/schemas). Lo ya convertido queda en req.datos: { params, query, headers, body }.
import boom from '@hapi/boom';

const PARTES = ['params', 'query', 'headers', 'body'];
const texto = issue => {
  const campo = issue.path.join('.');
  return campo && campo !== 'idempotency-key' ? `${campo}: ${issue.message}` : issue.message;
};

export const validar = definicion => (req, _res, next) => {
  req.datos = {};
  for (const parte of PARTES) {
    const esquema = definicion[parte];
    if (!esquema) continue;
    const r = esquema.safeParse(req[parte]);
    if (!r.success) return next(boom.badRequest(r.error.issues.slice(0, 3).map(texto).join(' | ').slice(0, 600)));
    req.datos[parte] = r.data;
  }
  next();
};
