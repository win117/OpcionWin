import { DirectionalGauge } from './Gauge';
import { Badge } from './Badge';
import { SourceLine } from './Source';
import { CORE_LABELS } from '../utils/constants';
import { fmtPct, fmtMetric, fmtDateTime, fmtNum, isNum } from '../utils/format';
import { metrica } from '../utils/objects';

/** Detalle de una Evaluacion de core: indicador, confianza, cobertura, métricas, motivos y faltantes. */
export function EvaluationDetail({ evaluacion, empresa }) {
  if (!evaluacion) return null;
  const e = evaluacion;
  const confianza = metrica(e.metricas, 'confianza');
  const sesgo = metrica(e.metricas, 'sesgo');
  const completada = e.estado === 'completada';
  return (
    <div className="evaluation">
      <div className="evaluation__head">
        <div>
          <h3>{CORE_LABELS[e.core] || e.core}{empresa ? ' · ' + empresa.simbolo : ''}</h3>
          <p className="muted">Versión del algoritmo: <code>{e.versionAlgoritmo || '—'}</code> · {fmtDateTime(e.finalizadaEn || e.createdAt)}</p>
        </div>
        <Badge value={e.estado} />
      </div>
      {e.estado === 'fallida' && <div className="alert alert--danger" role="alert">{e.error || 'La evaluación falló.'}</div>}
      {completada && (
        <div className="evaluation__summary">
          <DirectionalGauge puntaje={e.puntaje} />
          <dl className="stats">
            <div><dt>Confianza</dt><dd>{isNum(confianza) ? fmtPct(confianza) : '—'}</dd></div>
            <div><dt>Cobertura</dt><dd>{fmtPct(e.cobertura)}</dd></div>
            <div><dt>Sesgo</dt><dd>{isNum(sesgo) ? fmtNum(sesgo, 2) : '—'}</dd></div>
            <div><dt>Reglas aplicadas</dt><dd>{e.reglasAplicadas?.length ?? 0}</dd></div>
          </dl>
        </div>
      )}
      {completada && e.puntaje == null && (
        <div className="alert alert--warning">Sin datos suficientes para un puntaje direccional. Revisa los datos faltantes y sincroniza.</div>
      )}
      {e.datosFaltantes?.length > 0 && (
        <div className="alert alert--warning">
          <div><strong>Datos faltantes:</strong> {e.datosFaltantes.join(', ')}</div>
        </div>
      )}
      {e.motivos?.length > 0 && (
        <div>
          <h4>Motivos</h4>
          <ul className="list">{e.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {e.metricas?.length > 0 && (
        <details className="details" open={e.metricas.length <= 12}>
          <summary>Métricas ({e.metricas.length})</summary>
          <div className="table-wrap">
            <table className="table table--dense">
              <thead><tr><th scope="col">Métrica</th><th scope="col" className="num">Valor</th><th scope="col">Periodo</th></tr></thead>
              <tbody>
                {e.metricas.map((m, i) => (
                  <tr key={m._id || i}><td><code>{m.nombre}</code></td><td className="num">{fmtMetric(m.valor, m.unidad)}</td><td>{m.periodo || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {e.fuentes?.length > 0 && (
        <details className="details">
          <summary>Fuentes ({e.fuentes.length})</summary>
          {e.fuentes.map((f, i) => <SourceLine key={i} fuente={f} />)}
        </details>
      )}
    </div>
  );
}
