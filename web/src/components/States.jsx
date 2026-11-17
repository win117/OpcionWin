export function Spinner({ small = false }) {
  return <span className={'spinner' + (small ? ' spinner--sm' : '')} aria-hidden="true" />;
}

export function Loading({ text = 'Cargando…' }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <Spinner /> <span>{text}</span>
    </div>
  );
}

export function Empty({ title = 'Sin datos', children }) {
  return (
    <div className="state state--empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorMessage({ error, onRetry, title = 'No se pudo completar la operación' }) {
  if (!error) return null;
  const text = typeof error === 'string' ? error : error.message || String(error);
  return (
    <div className="alert alert--danger" role="alert">
      <div>
        <strong>{title}.</strong> {text}
      </div>
      {onRetry && <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }) {
  return (
    <div className={'alert alert--' + tone} role={tone === 'danger' ? 'alert' : 'note'}>
      <div>{title && <strong>{title} </strong>}{children}</div>
    </div>
  );
}
