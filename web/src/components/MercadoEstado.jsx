import { fmtDateTime } from '../utils/format';

/** Indicador «● ABIERTO / CERRADO · fecha». `estado` = resultado de useAsync(cargarEstadoMercado). */
export function MercadoEstado({ estado }) {
  const { data, loading, error } = estado;
  if (loading && !data) return <span className="mkt-state muted"><span className="dot dot--neutral" aria-hidden="true" /> Mercado…</span>;
  if (error && !data) return <span className="mkt-state muted" title={error.message}><span className="dot dot--neutral" aria-hidden="true" /> Mercado sin datos</span>;
  const abierto = data?.abierto;
  const texto = abierto === true ? 'ABIERTO' : abierto === false ? 'CERRADO' : 'MERCADO';
  const fecha = abierto === true ? data?.proximoCierre : data?.proximaApertura;
  const titulo = abierto === true ? 'Próximo cierre' : abierto === false ? 'Próxima apertura' : 'Sin estado de sesión';
  return (
    <span className="mkt-state" title={fecha ? `${titulo}: ${fmtDateTime(fecha)}` : undefined}>
      <span className={'dot ' + (abierto === true ? 'dot--ok' : abierto === false ? 'dot--off' : 'dot--neutral')} aria-hidden="true" />
      <strong>{texto}</strong>
      {fecha && <span className="muted"> · {fmtDateTime(fecha)}</span>}
    </span>
  );
}
