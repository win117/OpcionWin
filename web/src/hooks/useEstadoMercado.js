// Mercado abierto o cerrado, al día: se consulta cada minuto y justo al abrir o cerrar.
import { useEffect } from 'react';
import { cargarEstadoMercado } from '../api/resources';
import { useAsync } from './useAsync';

const CADA_MS = 60000;

export function useEstadoMercado(activo = true) {
  const estado = useAsync(cargarEstadoMercado, [], { enabled: activo });
  const { reload } = estado, cambio = estado.data?.abierto ? estado.data?.proximoCierre : estado.data?.proximaApertura;
  useEffect(() => {
    if (!activo) return undefined;
    const t = setInterval(reload, CADA_MS), falta = Date.parse(cambio) - Date.now();
    const justo = falta > 0 && falta < 24 * 3600000 ? setTimeout(reload, falta + 1500) : null;
    return () => { clearInterval(t); clearTimeout(justo); };
  }, [activo, cambio, reload]);
  return estado;
}
