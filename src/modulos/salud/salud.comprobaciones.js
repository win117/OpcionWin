// Adaptadores reales para la readiness: cómo se comprueba cada base. null = sin configurar.
// Nunca devuelven ni registran la cadena de conexión, la URL ni las claves.
import config from '../../config/config';
import { connectMongo } from '../../config/database.config';

export function comprobacionesReales(c = config, fetcher = globalThis.fetch) {
  return {
    mongodb: c.CONNECTION_STRING ? async () => { const conexion = await connectMongo(); await conexion.db.admin().ping(); } : null,
    supabase: c.SUPABASE_URL && c.SUPABASE_SECRET_KEY ? async () => {
      const clave = c.SUPABASE_SECRET_KEY, headers = { apikey: clave };
      if (!clave.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + clave;
      const r = await fetcher(new URL('/rest/v1/', c.SUPABASE_URL), { headers, signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error('Supabase respondió ' + r.status);
    } : null,
  };
}
