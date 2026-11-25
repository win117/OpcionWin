// Próximos eventos que cambian el riesgo de una opción: reporte de resultados (estimado), dividendo anunciado y división de acciones.
import { Termino } from './Termino';
import { useAsync } from '../hooks/useAsync';
import { mercado } from '../api/resources';
import { fmtDate, fmtFixed, isNum } from '../utils/format';

export default function EventosEmpresa({ simbolo }) {
  const { data: d, error, loading } = useAsync(() => mercado.eventos(simbolo), [simbolo], { enabled: Boolean(simbolo) });
  if (error) return <p className="muted small eventos">Próximos eventos: no disponibles ({error.message})</p>;
  const r = d?.reportes?.proximo, div = d?.dividendos?.proximos?.[0], anual = d?.dividendos?.anualPorAccion, division = d?.divisiones?.[0];
  const hueco = loading || !d ? <span className="skel detalle__skel" /> : null;
  return (
    <dl className="eventos small" aria-label="Próximos eventos">
      <div><dt><Termino id="resultados">Próximo reporte</Termino></dt><dd>{hueco || (r ? <>{fmtDate(r.fecha)} <span className="muted">estimado, ±{r.margen} días</span></> : d.reportes ? 'Sin historial suficiente' : 'No disponible')}</dd></div>
      <div><dt><Termino id="dividendo">Próximo dividendo</Termino></dt><dd>{hueco || (div ? <>{fmtDate(div.exFecha)} <span className="muted">{fmtFixed(div.monto, 2)} por acción</span></> : d.dividendos ? <>Ninguno anunciado {isNum(anual) && anual > 0 && <span className="muted">(pagó {fmtFixed(anual, 2)} en un año)</span>}</> : 'No disponible')}</dd></div>
      {division && <div><dt>División de acciones</dt><dd>{fmtDate(division.exFecha)}</dd></div>}
    </dl>
  );
}
