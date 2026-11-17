import { randomUUID } from 'node:crypto';
import { repository } from '../../../repositories';
import { createCrudService } from './crud.service';
import { crear } from './registros';

export default createCrudService('auditoria');

// a***@d***.com: suficiente para reconocer el intento sin guardar el correo completo.
export function enmascararEmail(email) {
  const [local = '', dominio = ''] = String(email ?? '').trim().toLowerCase().split('@');
  if (!local || !dominio) return '***';
  const punto = dominio.lastIndexOf('.');
  return local[0] + '***@' + dominio[0] + '***' + (punto > 0 ? dominio.slice(punto) : '');
}

// Mejor esfuerzo: nunca propaga errores ni retrasa de forma relevante la operación principal.
// ctx: { userId, database, requestId? }. detalle: texto corto (sin secretos ni contraseñas).
export async function registrarEvento(ctx, { accion, recurso, recursoId, resultado = 'exito', detalle }, factory = repository) {
  try {
    if (!ctx?.userId || !ctx?.database) return null;
    return await crear('auditoria', ctx, {
      usuarioId: ctx.userId, accion, recurso, resultado, requestId: ctx.requestId || randomUUID(),
      ocurridoEn: new Date(),
      ...(recursoId ? { recursoId: String(recursoId) } : {}), ...(detalle ? { descripcion: String(detalle).slice(0, 1900) } : {}),
    }, factory);
  } catch { return null; }
}

// Ejecuta fn y registra exito/error sin alterar su resultado ni su error. recursoId: valor o función(resultado).
export async function auditado(ctx, evento, fn, factory = repository) {
  let resultado;
  try { resultado = await fn(); }
  catch (error) {
    await registrarEvento(ctx, { ...evento, recursoId: typeof evento.recursoId === 'function' ? undefined : evento.recursoId, resultado: 'error', detalle: evento.detalle }, factory);
    throw error;
  }
  await registrarEvento(ctx, { ...evento, recursoId: typeof evento.recursoId === 'function' ? evento.recursoId(resultado) : evento.recursoId }, factory);
  return resultado;
}
