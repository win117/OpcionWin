// Solo conecta la definición con su controlador (mismas reglas que src/api/v1/routes).
import { Router } from 'express';
import { registrar } from '../../api/v1/routes/registrar';
import { listo } from './salud.schema';

export default function rutasSalud(controlador) {
  const router = Router();
  registrar(router, listo, controlador.listo);
  return router;
}
