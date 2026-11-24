import { Loading, Empty, ErrorMessage } from './States';

/*
 * emptyAction: botón o enlace que se ofrece cuando no hay filas.
 * columns: [{ key, label, render?(row), align?: 'right', className? }]
 * selectable + selected (Set) + onSelectionChange(Set) habilitan casillas por fila.
 */
export function Table({
  columns, rows = [], loading, error, onRetry, emptyTitle = 'Sin registros', emptyText, emptyAction,
  selectable, selected = new Set(), onSelectionChange, caption, rowKey = r => r._id, dense,
}) {
  const allSelected = rows.length > 0 && rows.every(r => selected.has(rowKey(r)));
  const toggleAll = on => {
    const next = new Set(selected);
    rows.forEach(r => (on ? next.add(rowKey(r)) : next.delete(rowKey(r))));
    onSelectionChange(next);
  };
  const toggle = (key, on) => {
    const next = new Set(selected);
    if (on) next.add(key); else next.delete(key);
    onSelectionChange(next);
  };

  if (error && !rows.length) return <ErrorMessage error={error} onRetry={onRetry} />;

  return (
    <div className="table-wrap" aria-busy={loading ? 'true' : 'false'}>
      {error && <ErrorMessage error={error} onRetry={onRetry} />}
      <table className={'table' + (dense ? ' table--dense' : '')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="col-check">
                <input type="checkbox" aria-label="Seleccionar todos" checked={allSelected} onChange={e => toggleAll(e.target.checked)} disabled={!rows.length} />
              </th>
            )}
            {columns.map(col => (
              <th key={col.key} scope="col" className={(col.align === 'right' ? 'num ' : '') + (col.className || '')}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const key = rowKey(row);
            return (
              <tr key={key} className={selected.has(key) ? 'is-selected' : undefined}>
                {selectable && (
                  <td className="col-check">
                    <input type="checkbox" aria-label="Seleccionar fila" checked={selected.has(key)} onChange={e => toggle(key, e.target.checked)} />
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} className={(col.align === 'right' ? 'num ' : '') + (col.className || '')} data-label={typeof col.label === 'string' ? col.label : undefined}>
                    {col.render ? col.render(row) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && !rows.length && <Loading />}
      {!loading && !error && !rows.length && <Empty title={emptyTitle} accion={emptyAction}>{emptyText}</Empty>}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (!total) return null;
  return (
    <nav className="pagination" aria-label="Paginación">
      <button type="button" className="btn btn--sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Anterior</button>
      <span className="muted">Página {page} de {pages} · {total} registros</span>
      <button type="button" className="btn btn--sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>Siguiente</button>
    </nav>
  );
}
