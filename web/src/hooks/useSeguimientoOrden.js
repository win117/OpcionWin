import { useEffect, useRef, useState } from 'react';
import { operacion } from '../api/resources';
import { seguirOrden } from '../api/client';

export const ESTADOS_TERMINALES = ['ejecutada', 'cancelada', 'rechazada', 'expirada'];
const SONDEO_MS = 3000, SONDEO_MAX_MS = 60000, AVISO_LENTA_MS = 60000;

/**
 * Sigue una orden hasta su estado final. Primero por avisos del servidor (SSE); si no se puede, preguntando cada 3 s durante un minuto.
 * Devuelve { siguiendo, lenta, enVivo }: `lenta` a partir de un minuto sin terminar.
 */
export function useSeguimientoOrden(ordenId, { activo = true, alCambio }) {
  const [estado, setEstado] = useState({ siguiendo: false, lenta: false, enVivo: false });
  const cb = useRef(alCambio);
  cb.current = alCambio;

  useEffect(() => {
    if (!ordenId || !activo) { setEstado(e => ({ ...e, siguiendo: false })); return undefined; }
    const control = new AbortController();
    let vivo = true, timer = null;
    setEstado({ siguiendo: true, lenta: false, enVivo: false });
    const lenta = setTimeout(() => { if (vivo) setEstado(e => ({ ...e, lenta: true })); }, AVISO_LENTA_MS);
    const recibir = (orden, enVivo) => { if (!vivo) return; cb.current?.(orden); setEstado(e => ({ ...e, enVivo: Boolean(enVivo) })); };
    const parar = () => { if (vivo) setEstado(e => ({ ...e, siguiendo: false, lenta: true })); };
    const sondear = () => {
      const t0 = Date.now();
      const tick = async () => {
        try { const r = await operacion.actualizarOrden(ordenId); const o = r?.orden || r; recibir(o, false); if (ESTADOS_TERMINALES.includes(o?.estado)) return; } catch { /* se reintenta */ }
        if (!vivo) return;
        if (Date.now() - t0 >= SONDEO_MAX_MS) parar(); else timer = setTimeout(tick, SONDEO_MS);
      };
      timer = setTimeout(tick, SONDEO_MS);
    };
    seguirOrden(ordenId, { signal: control.signal, alEvento: (evento, data) => { if (evento === 'orden') recibir(data.orden, data.enVivo); } })
      .then(fin => { if (vivo && fin !== 'final') (fin === 'tiempo' ? parar : sondear)(); })
      .catch(e => { if (vivo && e?.name !== 'AbortError') sondear(); });
    return () => { vivo = false; control.abort(); clearTimeout(timer); clearTimeout(lenta); };
  }, [ordenId, activo]);
  return estado;
}
