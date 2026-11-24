import { useEffect, useRef, useState } from 'react';

/**
 * Vuelve a pedir `fn` cada `intervalo(datos)` ms mientras la pestaña esté visible; al volver a ella, actualiza de inmediato.
 * Conserva el último dato si una actualización falla (error queda disponible para avisar). `clave` reinicia el sondeo.
 */
export function useSondeo(fn, intervalo, clave = '') {
  const [estado, setEstado] = useState({ data: undefined, error: null });
  const refs = useRef({});
  refs.current = { fn, intervalo };

  useEffect(() => {
    let vivo = true, timer = null, enCurso = false, ultimo;
    setEstado({ data: undefined, error: null });
    const ciclo = async () => {
      clearTimeout(timer);
      if (enCurso || document.visibilityState === 'hidden') return;
      enCurso = true;
      try {
        ultimo = await refs.current.fn();
        if (vivo) setEstado({ data: ultimo, error: null });
      } catch (error) {
        if (vivo) setEstado(e => ({ ...e, error }));
      } finally {
        enCurso = false;
        if (vivo) timer = setTimeout(ciclo, refs.current.intervalo(ultimo));
      }
    };
    const alVolver = () => { if (document.visibilityState === 'visible') ciclo(); };
    ciclo();
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearTimeout(timer); document.removeEventListener('visibilitychange', alVolver); };
  }, [clave]);

  return { ...estado, loading: estado.data === undefined && !estado.error };
}
