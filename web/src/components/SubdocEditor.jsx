import { useState } from 'react';
import { Table } from './Table';
import { Modal, ConfirmDialog } from './Modal';
import { SchemaForm } from './SchemaForm';
import { useAsync } from '../hooks/useAsync';

/** Editor de subdocumentos arreglo: /recurso/:id/campo (GET, POST, PUT /:childId, DELETE /:childId). */
export function SubdocEditor({ title, api: childApi, fields, columns, readOnlyReason, onChanged, createLabel = 'Agregar', transform, extraValidate }) {
  const list = useAsync(() => childApi.list(), [childApi]);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteState, setDeleteState] = useState({ busy: false, error: null });
  const rows = Array.isArray(list.data) ? list.data : [];
  const locked = Boolean(readOnlyReason);

  const refresh = () => { list.reload(); onChanged?.(); };

  const save = async payload => {
    const body = transform ? transform(payload) : payload;
    if (editing.record) await childApi.update(editing.record._id, body);
    else await childApi.create(body);
    setEditing(null);
    refresh();
  };

  const remove = async () => {
    setDeleteState({ busy: true, error: null });
    try {
      await childApi.remove(deleting._id);
      setDeleting(null);
      setDeleteState({ busy: false, error: null });
      refresh();
    } catch (error) {
      setDeleteState({ busy: false, error });
    }
  };

  const actions = locked ? [] : [{
    key: '__acciones', label: 'Acciones', className: 'col-actions',
    render: row => (
      <div className="row-actions">
        <button type="button" className="btn btn--sm" onClick={() => setEditing({ record: row })}>Editar</button>
        <button type="button" className="btn btn--sm btn--danger-ghost" onClick={() => setDeleting(row)}>Eliminar</button>
      </div>
    ),
  }];

  return (
    <section className="card">
      <header className="card__header">
        <h2>{title}</h2>
        <div className="row-actions">
          <button type="button" className="btn btn--sm" onClick={list.reload}>Actualizar</button>
          {!locked && <button type="button" className="btn btn--sm btn--primary" onClick={() => setEditing({})}>{createLabel}</button>}
        </div>
      </header>
      {locked && <div className="alert alert--info" role="note">{readOnlyReason}</div>}
      <Table columns={[...columns, ...actions]} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload} emptyTitle="Sin elementos" />
      <Modal open={Boolean(editing)} title={(editing?.record ? 'Editar · ' : 'Agregar · ') + title} onClose={() => setEditing(null)}>
        {editing && (
          <SchemaForm key={editing.record?._id || 'nuevo'} fields={fields} record={editing.record} onSubmit={save} onCancel={() => setEditing(null)} extraValidate={extraValidate} />
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Eliminar elemento"
        message="¿Eliminar este elemento? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        busy={deleteState.busy}
        error={deleteState.error}
        onConfirm={remove}
        onClose={() => { setDeleting(null); setDeleteState({ busy: false, error: null }); }}
      />
    </section>
  );
}
