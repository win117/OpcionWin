import { Badge } from '../../components/Badge';
import { fmtFixed } from '../../utils/format';

const FIN = ['completada', 'fallida', 'omitida'];

/** { total, hechos, fallidos, actual } de los pasos de un trabajo. */
export function resumenPasos(pasos = []) {
  return {
    total: pasos.length,
    hechos: pasos.filter(p => FIN.includes(p.estado)).length,
    fallidos: pasos.filter(p => p.estado === 'fallida'),
    actual: pasos.find(p => p.estado === 'procesando'),
  };
}

/** Detalle de los pasos de un trabajo. */
export function Pasos({ pasos }) {
  return (
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
  );
}
