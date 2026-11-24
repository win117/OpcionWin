// Estado del mercado: reloj de Alpaca + variación de los índices (ETF). Caché por proceso (~60 s).
export const INDICES = ['SPY', 'QQQ', 'IWM', 'DIA'];
const TTL_MS = 60000;

export function createMercadoEstado({ integraciones, ahora = Date.now, ttlMs = TTL_MS } = {}) {
  let cache = null;
  return async function estado() {
    if (cache && ahora() < cache.expira) return cache.dato;
    const alpaca = integraciones.alpaca;
    const [reloj, snaps] = await Promise.all([alpaca.reloj(), alpaca.cotizacionesLote(INDICES).catch(() => ({}))]);
    const dato = {
      abierto: reloj.abierto, proximaApertura: reloj.proximaApertura, proximoCierre: reloj.proximoCierre,
      indices: INDICES.map(simbolo => {
        const s = snaps[simbolo] || {};
        const precio = s.ultimo ?? s.cierre ?? null;
        return { simbolo, precio, cambioPct: precio != null && s.cierreAnterior > 0 ? precio / s.cierreAnterior - 1 : null };
      }),
      fuente: { proveedor: 'alpaca', feed: alpaca.feed || 'iex' },
    };
    cache = { dato, expira: ahora() + ttlMs };
    return dato;
  };
}
