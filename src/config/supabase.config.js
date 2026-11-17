import boom from '@hapi/boom';
import config from './config';
// REST del servidor: nunca enviar esta clave al navegador.
export function createSupabaseTransport(settings = config, fetcher = fetch) {
  return async (table, method, query = {}, body) => {
    if (!settings.SUPABASE_URL || !settings.SUPABASE_SECRET_KEY) throw boom.serverUnavailable('Falta configurar Supabase.');
    const base = new URL(settings.SUPABASE_URL);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw boom.serverUnavailable('Supabase requiere HTTPS.');
    const url = new URL('/rest/v1/' + table, base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const key = settings.SUPABASE_SECRET_KEY;
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
    let response;
    try { response = await fetcher(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) }); }
    catch { throw boom.serverUnavailable('No se pudo conectar con Supabase.'); }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (detail.code === '23505') throw boom.conflict('El registro ya existe.');
      throw boom.serverUnavailable('Supabase no pudo completar la operación. Verifica esquema y permisos.');
    }
    if (response.status === 204) return [];
    return response.json();
  };
}
