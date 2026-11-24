// Estado del mercado: reloj de Alpaca + índices de referencia. Precio y variación se combinan igual que en el mapa
// (IEX en vivo + consolidado retrasado), así la franja y el mapa usan el mismo criterio.
import { createMercadoReloj, diaNY } from './mercado-reloj.service';
import { combinarCotizacion, TTL_CERRADO_MS } from './universo-vivo.service';

const TTL_ABIERTO_MS = 15000; // la franja es secundaria: se actualiza algo menos que el mapa (10 s)
const DIA = 86400000;

// Configuración, no datos: qué ETF representan al mercado. Se cambia con INDICES_REFERENCIA="SIM1,SIM2" (máximo 8).
// Sus nombres y precios siempre vienen de Alpaca; el frontend recibe la lista de /mercado/estado.
export const INDICES_REFERENCIA_DEFECTO = 'SPY,QQQ,IWM,DIA';
export function indicesReferencia(env = process.env) {
  const lista = String(env.INDICES_REFERENCIA || INDICES_REFERENCIA_DEFECTO).split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.]{0,9}$/.test(s));
  return [...new Set(lista)].slice(0, 8);
}

// Nombre de un activo según Alpaca, guardado un día. Si Alpaca no responde se usa el símbolo y se vuelve a intentar.
export function createNombres({ integraciones, ahora = Date.now } = {}) {
  const nombres = new Map(); // símbolo → { t, nombre }
  return async function nombreDe(simbolo) {
    const previo = nombres.get(simbolo);
    if (previo && ahora() - previo.t < DIA) return previo.nombre;
    try {
      const { nombre } = await integraciones.alpaca.buscarActivo(simbolo);
      if (!nombre) return previo?.nombre || simbolo;
      nombres.set(simbolo, { t: ahora(), nombre });
      if (nombres.size > 200) nombres.delete(nombres.keys().next().value);
      return nombre;
    } catch { return previo?.nombre || simbolo; }
  };
}

export function createMercadoEstado({ integraciones, ahora = Date.now, env = process.env, nombreDe = createNombres({ integraciones, ahora }) } = {}) {
  const leerReloj = createMercadoReloj({ integraciones, ahora });
  let cache = null, pendiente = null;
  async function consultar() {
    const alpaca = integraciones.alpaca, simbolos = indicesReferencia(env);
    const [reloj, iex, sip, nombres] = await Promise.all([
      leerReloj(),
      alpaca.cotizacionesLote(simbolos).catch(() => ({})),
      alpaca.cotizacionesLote(simbolos, { feed: 'delayed_sip' }).catch(() => ({})),
      Promise.all(simbolos.map(nombreDe)),
    ]);
    const t = ahora(), hoy = diaNY(t);
    const dato = {
      abierto: reloj.abierto, proximaApertura: reloj.proximaApertura, proximoCierre: reloj.proximoCierre, actualizadoEn: new Date(t),
      indices: simbolos.map((simbolo, i) => {
        const q = combinarCotizacion(iex[simbolo], sip[simbolo], { abierto: reloj.abierto, hoy });
        return { simbolo, nombre: nombres[i], precio: q?.precio ?? null, cambioPct: q?.cambioPct ?? null };
      }),
      fuente: { proveedor: 'alpaca', feed: alpaca.feed || 'iex', consolidado: 'delayed_sip' },
    };
    cache = { dato, expira: t + (reloj.abierto ? TTL_ABIERTO_MS : TTL_CERRADO_MS) };
    return dato;
  }
  return async function estado() {
    if (cache && ahora() < cache.expira) return cache.dato;
    pendiente ||= consultar().finally(() => { pendiente = null; });
    return pendiente;
  };
}
