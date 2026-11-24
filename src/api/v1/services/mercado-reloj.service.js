// Reloj del mercado con caché corta (evita una solicitud por cada lectura del mapa). Si falla, conserva lo último conocido.
export function createMercadoReloj({ integraciones, ahora = Date.now, ttlMs = 30000 } = {}) {
  let cache = null;
  return async function reloj() {
    if (cache && ahora() < cache.expira) return cache.dato;
    try {
      const dato = await integraciones.alpaca.reloj();
      cache = { dato, expira: ahora() + ttlMs };
      return dato;
    } catch (e) {
      if (cache) return cache.dato;
      throw e;
    }
  };
}
