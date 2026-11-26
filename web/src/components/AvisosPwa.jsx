// Avisos de la PWA (openspec: aplicacion-web-pwa): versión nueva disponible y sin conexión.
// Nunca recarga sola: el usuario decide cuándo, para no perder un ticket a medio llenar.
import { useEffect, useState } from 'react';
import { activarVersionNueva, suscribirVersionNueva } from '../pwa/registrar';

function useEnLinea() {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const si = () => setEnLinea(true), no = () => setEnLinea(false);
    window.addEventListener('online', si);
    window.addEventListener('offline', no);
    return () => { window.removeEventListener('online', si); window.removeEventListener('offline', no); };
  }, []);
  return enLinea;
}

export function AvisosPwa() {
  const enLinea = useEnLinea();
  const [versionNueva, setVersionNueva] = useState(false);
  const [activando, setActivando] = useState(false);
  useEffect(() => suscribirVersionNueva(setVersionNueva), []);

  if (enLinea && !versionNueva) return null;
  return (
    <div className="avisos-pwa">
      {!enLinea && (
        <div className="alert alert--warning" role="status">
          <span><strong>Sin conexión.</strong> Los precios, los análisis y las órdenes no están disponibles hasta que vuelva la red.</span>
        </div>
      )}
      {versionNueva && (
        <div className="alert alert--info" role="status">
          <span><strong>Hay una versión nueva</strong> de WinOpciones.</span>
          <button type="button" className="btn btn--sm" disabled={activando} onClick={() => { setActivando(true); activarVersionNueva(); }}>
            {activando ? 'Recargando…' : 'Recargar'}
          </button>
        </div>
      )}
    </div>
  );
}
