// Conecta una definición (schemas/) con su controlador: verbo + dirección → validación → controlador.
import { validar } from '../../../middlewares/validar.handler';

/** `base`: parte de la dirección que ya aportó quien monta el router (por ejemplo '/mercado'). */
export function registrar(router, definicion, ...manejadores) {
  const base = router.base || '';
  if (!definicion.ruta.startsWith(base)) throw new Error('La ruta ' + definicion.ruta + ' no pertenece a ' + base);
  router[definicion.metodo](definicion.ruta.slice(base.length) || '/', validar(definicion), ...manejadores);
  return router;
}
