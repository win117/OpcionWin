import { Badge } from '../../components/Badge';

export default function Progreso({ pasos, titulo = 'Progreso' }) {
  const hechos = pasos.filter(p => ['completada', 'fallida', 'omitida'].includes(p.estado)).length;
  return (
    <section className="card" aria-live="polite">
      <div className="card__header">
        <h2>{titulo}</h2>
        <span className="muted">{hechos}/{pasos.length} pasos</span>
      </div>
      <div className="progress" role="progressbar" aria-label={titulo} aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={hechos}>
        <div className="progress__fill" style={{ width: (100 * hechos / Math.max(1, pasos.length)) + '%' }} />
      </div>
      <ol className="pipeline">
        {pasos.map(p => (
          <li key={p.id} className={'pipeline__step is-' + p.estado}>
            <span className="pipeline__dot" aria-hidden="true" />
            <span className="pipeline__label"><small className="muted">{p.grupo}</small> {p.label}</span>
            <span className="pipeline__meta muted">{p.detalle}{p.ms != null ? ' · ' + (p.ms / 1000).toFixed(1) + ' s' : ''}</span>
            {p.estado === 'omitida' ? <Badge tone="neutral">omitido</Badge> : <Badge value={p.estado} />}
            {p.error && <span className="pipeline__error">{p.error}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
