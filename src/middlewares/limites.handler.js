import boom from '@hapi/boom';
import { createLimitador } from './limitador';
const demasiadas = (mensaje, segundos) => {
  const error = boom.tooManyRequests(mensaje);
  error.output.headers['Retry-After'] = String(segundos);
  return error;
};
const noDisponible = (mensaje, segundos) => {
  const error = boom.serverUnavailable(mensaje);
  error.output.headers['Retry-After'] = String(segundos);
  return error;
};
// Inicio de sesión: 10 intentos por minuto y dirección, y 10 fallidos cada 15 minutos por correo (un acierto lo reinicia).
export function loginLimit() {
  const porIp = createLimitador({ max: 10, ventanaMs: 60000 });
  const porEmail = createLimitador({ max: 10, ventanaMs: 15 * 60000 });
  return (req, res, next) => {
    let espera = porIp.sumar(req.ip);
    if (espera) return next(demasiadas('Espera un minuto antes de volver a intentar.', espera));
    if (typeof req.body?.email === 'string') {
      const email = req.body.email.trim().toLowerCase().slice(0, 254);
      espera = porEmail.sumar(email);
      if (espera) return next(demasiadas('Demasiados intentos para este usuario. Espera unos minutos.', espera));
      res.on('finish', () => { if (res.statusCode < 300) porEmail.olvidar(email); });
    }
    next();
  };
}
// Operaciones costosas por usuario. Un análisis completo lanza unos 15 POST; los GET de sondeo no cuentan.
const COSTOSA = /\/(ejecuciones|evaluaciones|ticket|universo\/sincronizaciones)\/?$/i;
const ENCOLA = /\/(ejecuciones|evaluaciones|universo\/sincronizaciones)\/?$/i;
export function limiteOperaciones({ cola, max = 120, ventanaMs = 60000 } = {}) {
  const porUsuario = createLimitador({ max, ventanaMs });
  const enVuelo = new Map(); // solicitudes que aún no llegan a la cola: evita rebasar el tope con una ráfaga
  return (req, res) => {
    const ruta = req.originalUrl.split('?')[0], usuario = req.context?.userId;
    if (req.method !== 'POST' || !usuario || !COSTOSA.test(ruta)) return;
    const espera = porUsuario.sumar(usuario);
    if (espera) throw demasiadas('Demasiadas operaciones seguidas. Espera un momento.', espera);
    if (!cola?.pendientes || !ENCOLA.test(ruta)) return;
    // Apagado en curso: no se crea el registro del trabajo; el cliente reintenta contra la instancia nueva.
    if (cola.aceptando && !cola.aceptando()) throw noDisponible('El servicio se está reiniciando. Intenta de nuevo en unos segundos.', 10);
    const actuales = enVuelo.get(usuario) || 0;
    if (cola.pendientes(usuario) + actuales >= cola.maxPorUsuario) throw demasiadas('Tienes ' + cola.maxPorUsuario + ' trabajos en espera. Deja que terminen antes de lanzar más.', 30);
    enVuelo.set(usuario, actuales + 1);
    res.on('close', () => {
      const n = enVuelo.get(usuario) - 1;
      if (n > 0) enVuelo.set(usuario, n); else enVuelo.delete(usuario);
    });
  };
}
