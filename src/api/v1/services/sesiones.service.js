import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import boom from '@hapi/boom';
import config from '../../../config/config';
import { repository } from '../../../repositories';
import { object, validated } from './crud.service';
import { registrarEvento, enmascararEmail } from './auditoria.service';
const scrypt = promisify(scryptCallback);
const hash = token => createHash('sha256').update(token).digest('hex');
// Usuarios: AUTH_USERS_JSON (variable de entorno, despliegue) tiene prioridad sobre AUTH_USERS_FILE (local).
export function parseUsers(text) {
  const users = JSON.parse(text);
  if (!Array.isArray(users) || users.some(u => !u || typeof u.email !== 'string' || typeof u.salt !== 'string' || typeof u.passwordHash !== 'string')) throw new Error('Formato de usuarios inválido.');
  return users;
}
export async function fileUsers(settings = config) {
  try { return parseUsers(settings.AUTH_USERS_JSON || await readFile(settings.AUTH_USERS_FILE, 'utf8')); }
  catch { throw boom.serverUnavailable('Configura usuarios con scripts/create-user.cjs (local) o la variable AUTH_USERS_JSON (despliegue).'); }
}
export function createSessionService(factory = repository, users = fileUsers) {
  // Supabase no tiene TTL: la expiración se aplica en authenticate (expiraEn <= ahora → 401) y aquí se purgan
  // las expiradas al iniciar sesión (mejor esfuerzo; en MongoDB lo hace además el índice TTL).
  async function limpiarExpiradas(context) {
    try {
      const repo = factory('sesiones', context), ahora = new Date();
      for (const row of await repo.list({ limit: 100 })) if (new Date(row.document.expiraEn) <= ahora) await repo.remove(row._id, row.revision).catch(() => {});
    } catch { /* mejor esfuerzo */ }
  }
  return {
    async login(body) {
      object(body);
      const { email, password, baseDatos } = body;
      if (!['mongodb','supabase'].includes(baseDatos) || typeof email !== 'string' || typeof password !== 'string' || password.length > 1024) throw boom.badRequest('Envía email, password y baseDatos (mongodb o supabase).');
      const user = (await users()).find(u => u.email === email.trim().toLowerCase() && u.activo !== false);
      const salt = user?.salt || 'invalid-user';
      const derived = await scrypt(password, salt, 64);
      const expected = Buffer.from(user?.passwordHash || '00'.repeat(64), 'hex');
      if (!user || expected.length !== derived.length || !timingSafeEqual(expected, derived)) {
        // Sin contraseña; con usuario conocido queda en su propio registro, si no en 'anonimo'.
        await registrarEvento({ userId: user?.id || 'anonimo', database: baseDatos }, { accion: 'login', recurso: 'sesiones', resultado: 'error', detalle: 'Credenciales inválidas: ' + enmascararEmail(email) }, factory);
        throw boom.unauthorized('Credenciales inválidas.');
      }
      const context = { userId: user.id, database: baseDatos };
      const id = randomUUID();
      const token = [baseDatos, user.id, id, randomBytes(32).toString('hex')].join('.');
      const expiraEn = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
      const document = await validated('sesiones', { _id: id, usuarioId: user.id, baseDatos, tokenHash: hash(token), expiraEn, createdAt: new Date(), updatedAt: new Date() });
      await factory('sesiones', context).create(document);
      await registrarEvento(context, { accion: 'login', recurso: 'sesiones', recursoId: id }, factory);
      await limpiarExpiradas(context);
      return { token, tokenType: 'Bearer', usuarioId: user.id, baseDatos, expiraEn };
    },
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 512) throw boom.unauthorized('Token inválido.');
      const parts = token.split('.');
      if (parts.length !== 4 || !['mongodb','supabase'].includes(parts[0]) || !/^[a-f0-9-]{36}$/.test(parts[1]) || !/^[a-f0-9-]{36}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) throw boom.unauthorized('Token inválido.');
      const context = { database: parts[0], userId: parts[1], sessionId: parts[2] };
      const row = await factory('sesiones', context).get(context.sessionId);
      if (!row || row.document.revocadaEn || new Date(row.document.expiraEn) <= new Date() ||
          row.document.baseDatos !== context.database || row.document.tokenHash !== hash(token)) throw boom.unauthorized('Sesión inválida o expirada.');
      return context;
    },
    async current(context) {
      const row = await factory('sesiones', context).get(context.sessionId);
      if (!row) throw boom.unauthorized();
      return { usuarioId: context.userId, baseDatos: context.database, expiraEn: row.document.expiraEn };
    },
    async logout(context) {
      const repo = factory('sesiones', context), row = await repo.get(context.sessionId);
      if (row) await repo.replace(row._id, { ...row.document, revocadaEn: new Date() }, row.revision);
      await registrarEvento(context, { accion: 'logout', recurso: 'sesiones', recursoId: context.sessionId }, factory);
    },
  };
}
export default createSessionService();
