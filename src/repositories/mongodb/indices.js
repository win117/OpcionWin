// Índices de las colecciones: los documentos viven bajo `document.`, así que los del esquema (autoIndex apagado) no aplican.
// Los usan scripts/setup-mongodb.cjs (explícito) y el repositorio (primer acceso, sin bloquear).
import { resource } from '../resources';
const REINTENTO_MS = 10 * 60000;
export function indicesDe(name) {
  const { Model } = resource(name);
  const unicos = Model.schema.indexes().filter(([, opciones]) => opciones.unique).map(([claves]) => [
    { owner_id: 1, ...Object.fromEntries(Object.entries(claves).map(([k, v]) => ['document.' + k, v])) }, { unique: true }]);
  // Supabase no tiene TTL; en MongoDB las sesiones vencidas se borran solas.
  const ttl = name === 'sesiones' ? [[{ 'document.expiraEn': 1 }, { expireAfterSeconds: 0 }]] : [];
  return [[{ owner_id: 1, _id: 1 }, {}], ...unicos, ...ttl];
}
const proximoIntento = new Map(); // colección → momento del siguiente intento (Infinity: ya están creados)
// Mejor esfuerzo: nunca lanza. Devuelve la promesa solo para pruebas; el repositorio no la espera.
export async function asegurarIndices(collection, name, { ahora = Date.now(), registro = proximoIntento } = {}) {
  const { table } = resource(name);
  if ((registro.get(table) ?? 0) > ahora) return;
  registro.set(table, Infinity);
  for (const [claves, opciones] of indicesDe(name)) {
    try { await collection.createIndex(claves, opciones); }
    catch (error) {
      registro.set(table, ahora + REINTENTO_MS);
      console.warn('[mongodb] No se pudo crear un índice de ' + table + ' (' + (error?.codeName || error?.name || 'error') + '). Revisa duplicados con scripts/setup-mongodb.cjs.');
    }
  }
}
