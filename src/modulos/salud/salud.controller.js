// HTTP ↔ servicio de salud. 200 si está listo, 503 si no; nunca se guarda en caché.
import { handle } from '../../api/v1/controllers/crud.controller';

export const crearControladorSalud = servicio => ({
  listo: handle(async (_req, res) => {
    const { listo, cuerpo } = await servicio.estado();
    res.set('Cache-Control', 'no-store').status(listo ? 200 : 503).json(cuerpo);
  }),
});
