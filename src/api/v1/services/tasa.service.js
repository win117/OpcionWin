// Curva del Tesoro en memoria (se publica una vez al día). Si el Tesoro no responde se conserva la última conocida.
import { tasaParaPlazo } from '../../../cores/tasa';

const VIGENCIA_MS = 12 * 3600000, REINTENTO_MS = 10 * 60000;

export function createTasa({ integraciones, ahora = Date.now } = {}) {
  let dato = null, expira = 0, pendiente = null;
  async function actualizar() {
    try {
      if (!integraciones?.tesoro) return;
      dato = { ...await integraciones.tesoro.curva(), fuente: { proveedor: 'tesoro', referencia: 'Letras del Tesoro de EE. UU., rendimiento equivalente' } };
      expira = ahora() + VIGENCIA_MS;
    } catch { expira = ahora() + REINTENTO_MS; }
  }
  const curva = async () => {
    if (ahora() >= expira) {
      pendiente ||= actualizar().finally(() => { pendiente = null; });
      await pendiente;
    }
    return dato; // null: aún no se ha podido obtener
  };
  return { curva, para: async dias => tasaParaPlazo((await curva())?.puntos, dias) };
}
