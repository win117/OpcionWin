import { SyncButton } from '../../components/SyncButton';
import { SourceLine } from '../../components/Source';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { listLatest, mercado } from '../../api/resources';
import { fmtDate, fmtMetric } from '../../utils/format';

const PERIODOS = 6;
const ETIQUETAS = {
  ingresos: 'Ingresos', utilidad_neta: 'Utilidad neta', activos: 'Activos', pasivos: 'Pasivos', capital: 'Capital',
  activo_circulante: 'Activo circulante', pasivo_circulante: 'Pasivo circulante', flujo_operativo: 'Flujo operativo', eps_diluido: 'EPS diluido',
};

export default function FundamentalesTab({ empresa, simbolo }) {
  const state = useAsync(() => listLatest(p => mercado.fundamentales(simbolo, p), {}, { dateOf: r => r.periodoFin }), [simbolo]);
  const periodos = (state.data?.items || []).slice(0, PERIODOS);
  const nombres = [...new Set(periodos.flatMap(p => (p.metricas || []).map(m => m.nombre)))];

  return (
    <div className="stack">
      <div className="toolbar">
        <SyncButton recurso="fundamentales" simbolos={[simbolo]} onDone={state.reload} label="Sincronizar fundamentales" disabled={!empresa.cik} />
        {!empresa.cik && <span className="muted small">Registra el CIK de la empresa para sincronizar desde SEC.</span>}
      </div>
      {state.loading && !state.data && <Loading />}
      <ErrorMessage error={state.error} onRetry={state.reload} />
      {state.data && !periodos.length && <Empty title="Sin fundamentales almacenados">Sincroniza para obtener los reportes de SEC EDGAR.</Empty>}
      {periodos.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table table--dense">
              <caption className="sr-only">Métricas fundamentales por periodo</caption>
              <thead>
                <tr>
                  <th scope="col">Métrica</th>
                  {periodos.map(p => <th key={p._id} scope="col" className="num">{fmtDate(p.periodoFin)}</th>)}
                </tr>
              </thead>
              <tbody>
                {nombres.map(nombre => (
                  <tr key={nombre}>
                    <th scope="row">{ETIQUETAS[nombre] || nombre}</th>
                    {periodos.map(p => {
                      const m = (p.metricas || []).find(x => x.nombre === nombre);
                      return <td key={p._id} className="num">{m ? fmtMetric(m.valor, m.unidad) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            {periodos.map(p => (
              <SourceLine key={p._id} fuente={p.fuente} extra={`periodo ${fmtDate(p.periodoInicio)} – ${fmtDate(p.periodoFin)}`} />
            ))}
          </div>
          <Notice>«—» indica que el reporte no incluye esa métrica; no se estima.</Notice>
        </>
      )}
    </div>
  );
}
