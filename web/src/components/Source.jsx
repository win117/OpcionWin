import { fmtDateTime } from '../utils/format';

/** Fuente y fecha del dato. Nunca se omite: si falta, se indica explícitamente. */
export function SourceLine({ fuente, extra }) {
  if (!fuente) return <p className="source">Fuente no indicada por el servidor.{extra ? ' ' + extra : ''}</p>;
  return (
    <p className="source">
      Fuente: <strong>{fuente.proveedor || 'desconocida'}</strong>
      {fuente.feed && <> (feed {fuente.feed})</>}
      {' · '}Dato al {fmtDateTime(fuente.fechaDato)}
      {fuente.recuperadoEn && <> · recuperado {fmtDateTime(fuente.recuperadoEn)}</>}
      {extra && <> · {extra}</>}
    </p>
  );
}

/** Lista de pares clave-valor para respuestas de forma no fija (p. ej. proveedor). */
export function KeyValue({ data, exclude = [] }) {
  if (!data || typeof data !== 'object') return <p className="muted">Sin datos.</p>;
  const entries = Object.entries(data).filter(([k, v]) => !exclude.includes(k) && v !== undefined && typeof v !== 'function');
  if (!entries.length) return <p className="muted">Sin datos.</p>;
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div key={key} className="kv__row">
          <dt>{key}</dt>
          <dd>{value === null ? '—' : typeof value === 'object' ? <code className="kv__json">{JSON.stringify(value)}</code> : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
