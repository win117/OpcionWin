import { fmtDateTime, fmtHoraCorta } from '../utils/format';

/** «Cerrado, abre mar 07:30» (hora local). `estado` = resultado de useAsync(cargarEstadoMercado). Rojo solo si hay un error. */
export function MercadoEstado({ estado }) {
  const { data, error } = estado;
  const abierto = data?.abierto;
  const fecha = abierto === true ? data?.proximoCierre : data?.proximaApertura;
  let tono = 'neutral', texto = 'Mercado…', detalle = '', titulo;
  if (error && !data) { tono = 'error'; texto = 'Mercado sin datos'; titulo = error.message; }
  else if (data) {
    tono = error ? 'error' : abierto === true ? 'ok' : 'neutral';
    texto = abierto === true ? 'Abierto' : abierto === false ? 'Cerrado' : 'Mercado';
    if (fecha) {
      detalle = `, ${abierto === true ? 'cierra' : 'abre'} ${fmtHoraCorta(fecha)}`;
      titulo = `${error ? 'No se pudo actualizar. ' : ''}${abierto === true ? 'Próximo cierre' : 'Próxima apertura'}: ${fmtDateTime(fecha)}, tu hora local`;
    }
  }
  return (
    <span className="mkt-state" title={titulo}>
      <span className={'dot dot--' + tono} aria-hidden="true" />
      <span><span className="mkt-state__txt">{texto}</span><span className="mkt-state__det">{detalle}</span></span>
    </span>
  );
}
