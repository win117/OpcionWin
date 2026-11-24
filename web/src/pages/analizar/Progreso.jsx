import { Badge } from '../../components/Badge';
import { fmtFixed } from '../../utils/format';

/** Pasos de un trabajo. Al terminar se reduce a una línea; el detalle sigue a un clic. */
export default function Progreso({ pasos, titulo = 'Progreso' }) {
  const hechos = pasos.filter(p => ['completada', 'fallida', 'omitida'].includes(p.estado)).length;
  const fallidos = pasos.filter(p => p.estado === 'fallida').length;
  const listo = hechos === pasos.length;
  const ms = Math.max(0, ...pasos.map(p => p.ms || 0));
  return (
    <details key={String(listo)} className="card card--tight progreso" open={!listo}>
      <summary>
        <span className="progreso__titulo" role="status">{listo ? (fallidos ? `Terminó con ${fallidos} ${fallidos === 1 ? 'error' : 'errores'}` : `${titulo}: listo`) : titulo}</span>
        <span className="muted small">{hechos} de {pasos.length} pasos{listo && ms ? `, el más lento ${fmtFixed(ms / 1000, 1)} s` : ''}</span>
      </summary>
      {!listo && (
        <div className="progress" role="progressbar" aria-label={titulo} aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={hechos}>
          <div className="progress__fill" style={{ width: (100 * hechos / Math.max(1, pasos.length)) + '%' }} />
        </div>
      )}
      <ol className="pipeline">
        {pasos.map(p => (
          <li key={p.id} className={'pipeline__step is-' + p.estado}>
            <span className="pipeline__dot" aria-hidden="true" />
            <span className="pipeline__label"><small className="muted">{p.grupo}</small> {p.label}</span>
            <span className="pipeline__meta muted">{[p.detalle, p.ms != null ? fmtFixed(p.ms / 1000, 1) + ' s' : ''].filter(Boolean).join(', ')}</span>
            {p.estado === 'omitida' ? <Badge tone="neutral">omitido</Badge> : <Badge value={p.estado} />}
            {p.error && <span className="pipeline__error">{p.error}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
