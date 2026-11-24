import { useEffect, useMemo, useState } from 'react';
import { Table, Pagination } from './Table';
import { Modal, ConfirmDialog } from './Modal';
import { SchemaForm } from './SchemaForm';
import { Select } from './Field';
import { useAsync } from '../hooks/useAsync';
import { listLatest } from '../api/resources';

/*
 * CRUD genérico sobre un recurso REST (lista paginada, búsqueda, filtros, alta/edición en modal,
 * eliminación individual y en lote).
 * - sortDesc: si se indica, descarga todo y ordena por esa fecha desc en el cliente
 *   (los repositorios ordenan por _id aleatorio).
 */
export function ResourceManager({
  title, description, api: res, columns, fields = [], baseQuery = {}, filters = [],
  searchable = true, searchPlaceholder = 'Buscar…', selectable = false,
  creatable = true, editable = true, deletable = true, canEdit = () => true, canDelete = () => true,
  transform, rowActions, toolbar, emptyText, pageSize = 20, sortDesc, nameOf = r => r.nombre || r._id,
  createLabel = 'Nuevo', reloadSignal, extraValidate, onChanged, modalSize = 'md', formTitle,
}) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null); // null | { record? }
  const [deleting, setDeleting] = useState(null); // null | { ids, label }
  const [deleteState, setDeleteState] = useState({ busy: false, error: null });
  const [batchResult, setBatchResult] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useMemo(() => {
    const q = { ...baseQuery, ...filterValues };
    if (search) q.search = search;
    for (const k of Object.keys(q)) if (q[k] === '' || q[k] == null) delete q[k];
    return q;
  }, [JSON.stringify(baseQuery), filterValues, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useAsync(async () => {
    if (sortDesc) {
      const all = await listLatest(res, query, { dateOf: r => r[sortDesc] });
      const start = (page - 1) * pageSize;
      return { items: all.items.slice(start, start + pageSize), page, limit: pageSize, total: all.items.length, truncated: all.truncated };
    }
    return res.list({ ...query, page, limit: pageSize });
  }, [res, query, page, pageSize, sortDesc, reloadSignal]);

  const rows = list.data?.items || [];
  const reload = () => { list.reload(); onChanged?.(); };

  const save = async payload => {
    const record = editing?.record;
    const body = transform ? await transform(payload, record) : payload;
    if (record) await res.update(record._id, body, record._revision);
    else await res.create(body);
    setEditing(null);
    reload();
  };

  const confirmDelete = async () => {
    setDeleteState({ busy: true, error: null });
    try {
      if (deleting.ids.length === 1) {
        await res.remove(deleting.ids[0]);
      } else {
        const result = await res.removeMany(deleting.ids);
        setBatchResult(result);
      }
      setSelected(new Set());
      setDeleting(null);
      setDeleteState({ busy: false, error: null });
      reload();
    } catch (error) {
      setDeleteState({ busy: false, error });
    }
  };

  const actionColumn = (editable || deletable || rowActions) ? [{
    key: '__acciones', label: 'Acciones', className: 'col-actions',
    render: row => (
      <div className="row-actions">
        {rowActions?.(row, reload)}
        {editable && canEdit(row) && <button type="button" className="btn btn--sm" onClick={() => setEditing({ record: row })}>Editar</button>}
        {deletable && canDelete(row) && (
          <button type="button" className="btn btn--sm btn--danger-ghost" onClick={() => setDeleting({ ids: [row._id], label: nameOf(row) })}>Eliminar</button>
        )}
      </div>
    ),
  }] : [];

  return (
    <section className="card">
      {(title || description) && (
        <header className="card__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
        </header>
      )}
      <div className="toolbar">
        {searchable && (
          <input
            type="search"
            className="toolbar__search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        )}
        {filters.map(f => (
          <label key={f.name} className="toolbar__filter">
            <span className="sr-only">{f.label}</span>
            <Select
              value={filterValues[f.name] || ''}
              onChange={v => { setFilterValues(fv => ({ ...fv, [f.name]: v })); setPage(1); }}
              options={f.options}
              placeholder={f.label + ': todos'}
              aria-label={f.label}
            />
          </label>
        ))}
        <div className="toolbar__spacer" />
        {toolbar?.(reload)}
        <button type="button" className="btn btn--sm" onClick={reload} disabled={list.loading}>Actualizar</button>
        {selectable && deletable && selected.size > 0 && (
          <button type="button" className="btn btn--sm btn--danger" onClick={() => setDeleting({ ids: [...selected], label: `${selected.size} registros` })}>
            Eliminar seleccionados ({selected.size})
          </button>
        )}
        {creatable && <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}>{createLabel}</button>}
      </div>

      {batchResult && (
        <div className={'alert ' + (batchResult.fallidos ? 'alert--warning' : 'alert--success')} role="status">
          <div>
            Lote: {batchResult.exitosos} eliminados, {batchResult.fallidos} con error.
            {batchResult.results?.filter(r => !r.success).map(r => (
              <div key={r.index} className="muted">Elemento {r.index + 1}: {r.message}</div>
            ))}
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setBatchResult(null)}>Cerrar</button>
        </div>
      )}
      {list.data?.truncated && <div className="alert alert--warning">Se muestran los primeros registros descargados; afina los filtros.</div>}

      <Table
        columns={[...columns, ...actionColumn]}
        rows={rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyText={emptyText || (search || Object.values(filterValues).some(Boolean) ? 'Nada coincide con la búsqueda o los filtros.' : undefined)}
        emptyAction={search || Object.values(filterValues).some(Boolean)
          ? <button type="button" className="btn btn--sm" onClick={() => { setSearchInput(''); setFilterValues({}); setPage(1); }}>Quitar filtros</button>
          : creatable && <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}>{createLabel}</button>}
        selectable={selectable && deletable}
        selected={selected}
        onSelectionChange={setSelected}
        caption={title}
      />
      <Pagination page={page} limit={pageSize} total={list.data?.total} onPage={setPage} />

      <Modal open={Boolean(editing)} title={formTitle || ((editing?.record ? 'Editar' : 'Crear') + (title ? ': ' + title : ''))} onClose={() => setEditing(null)} size={modalSize}>
        {editing && (
          <SchemaForm
            key={editing.record?._id || 'nuevo'}
            fields={fields}
            record={editing.record}
            onSubmit={save}
            onCancel={() => setEditing(null)}
            extraValidate={extraValidate}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Eliminar"
        message={deleting ? <>¿Eliminar <strong>{deleting.label}</strong>? Esta acción no se puede deshacer. Si el registro está referenciado, el servidor lo impedirá.</> : null}
        confirmLabel="Eliminar"
        busy={deleteState.busy}
        error={deleteState.error}
        onConfirm={confirmDelete}
        onClose={() => { setDeleting(null); setDeleteState({ busy: false, error: null }); }}
      />
    </section>
  );
}
