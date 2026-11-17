import boom from '@hapi/boom';
import { mongoRepository } from './mongodb/repository';
import { supabaseRepository } from './supabase/repository';
export function repository(name, context) {
  if (!context?.userId) throw boom.unauthorized('Sesión requerida.');
  if (context.database === 'mongodb') return mongoRepository(name, context.userId);
  if (context.database === 'supabase') return supabaseRepository(name, context.userId);
  throw boom.badRequest('Base de datos inválida.');
}
