import { useState } from 'react';
import { ResourceManager } from '../../components/ResourceManager';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { ordenes, configuraciones, contratos, acciones } from '../../api/resources';
import { ESTADOS_ORDEN } from '../../utils/constants';
import { fmtDateTime, fmtMoney, shortId } from '../../utils/format';
import { uuid } from '../../utils/objects';

/* ---------- Órdenes ---------- */
async function construirOrden(payload, record) {
  if (record) return payload; // edición: conserva componentes e idempotencyKey existentes
  const config = await configuraciones.get(payload.configuracionId);
  const comps = config.componentes || [];
  if (!comps.length) throw new Error('La configuración no tiene componentes.');
  if (comps.length > 4) throw new Error('Una orden admite de 1 a 4 componentes.');
  const componentes = [];
  for (const c of comps) {
    const contrato = await contratos.get(c.contratoId);
    componentes.push({ contratoId: c.contratoId, simbolo: contrato.simbolo, accion: c.accion, intencion: `${c.accion}_to_open`, proporcion: c.proporcion || 1 });
  }
  return { ...payload, componentes, idempotencyKey: uuid() };
}

export function OrdenesRegistro({ conexionesL, configsL, conexionId }) {
  const [confirm, setConfirm] = useState(null); // { tipo: 'envio'|'cancelacion', orden, reload }
  const [state, setState] = useState({ busy: false, error: null });
  const [eventos, setEventos] = useState(null);

  const ejecutar = async () => {
    setState({ busy: true, error: null });
    try {
      if (confirm.tipo === 'envio') await acciones.enviarOrden(confirm.orden._id, confirm.orden.idempotencyKey);
      else await acciones.cancelarOrden(confirm.orden._id);
      confirm.reload();
      setConfirm(null);
      setState({ busy: false, error: null });
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const pendiente = r => r.estado === 'pendiente';
  return (
    <>
      <ResourceManager
        api={ordenes}
        baseQuery={conexionId ? { conexionId } : {}}
        createLabel="Nueva orden desde configuración"
        sortDesc="createdAt"
        searchable={false}
        nameOf={r => 'la orden ' + shortId(r._id)}
        canEdit={pendiente}
        canDelete={pendiente}
        filters={[{ name: 'estado', label: 'Estado', options: ESTADOS_ORDEN.map(e => ({ value: e, label: e })) }]}
        transform={construirOrden}
        fields={[
          { name: 'configuracionId', label: 'Configuración', type: 'select', required: true, wide: true, disabled: (_v, r) => Boolean(r), options: () => configsL.items.map(c => ({ value: c._id, label: `${c.nombre} (${c.componentes?.length || 0} patas)` })), help: 'Los componentes se copian de la configuración al crear la orden.' },
          { name: 'conexionId', label: 'Conexión (paper)', type: 'select', required: true, disabled: (_v, r) => Boolean(r), options: () => conexionesL.items.filter(c => c.entorno === 'paper').map(c => ({ value: c._id, label: c.alias })) },
          { name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'limit', options: [{ value: 'limit', label: 'Limit' }, { value: 'market', label: 'Market' }] },
          { name: 'precioLimite', label: 'Precio límite (neto por unidad)', type: 'number', step: '0.01', required: true, show: v => v.tipo === 'limit' },
          { name: 'vigencia', label: 'Vigencia', type: 'select', required: true, default: 'day', options: [{ value: 'day', label: 'Día (day)' }, { value: 'gtc', label: 'Hasta cancelar (gtc)' }] },
          { name: 'cantidad', label: 'Cantidad', type: 'number', min: 1, step: 1, required: true, default: '1' },
        ]}
        columns={[
          { key: 'fecha', label: 'Creada', render: r => fmtDateTime(r.createdAt) },
          { key: 'config', label: 'Configuración', render: r => configsL.byId.get(r.configuracionId)?.nombre || '—' },
          { key: 'conexion', label: 'Conexión', render: r => conexionesL.byId.get(r.conexionId)?.alias || '—' },
          { key: 'tipo', label: 'Tipo', render: r => `${r.tipo}${r.tipo === 'limit' ? ' ' + fmtMoney(r.precioLimite) : ''} · ${r.vigencia}` },
          { key: 'cantidad', label: 'Cant.', align: 'right' },
          { key: 'patas', label: 'Patas', align: 'right', render: r => r.componentes?.length ?? 0 },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
          { key: 'externa', label: 'ID broker', render: r => r.ordenExternaId ? <code>{shortId(r.ordenExternaId)}</code> : '—' },
        ]}
        rowActions={(row, reload) => (
          <>
            {pendiente(row) && <button type="button" className="btn btn--sm btn--primary" onClick={() => setConfirm({ tipo: 'envio', orden: row, reload })}>Enviar (paper)</button>}
            {['enviada', 'aceptada', 'parcial'].includes(row.estado) && <button type="button" className="btn btn--sm btn--danger-ghost" onClick={() => setConfirm({ tipo: 'cancelacion', orden: row, reload })}>Cancelar</button>}
            <button type="button" className="btn btn--sm" onClick={() => setEventos(row)}>Detalle</button>
          </>
        )}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.tipo === 'envio' ? 'Enviar orden a Alpaca paper' : 'Cancelar orden'}
        tone={confirm?.tipo === 'envio' ? 'primary' : 'danger'}
        confirmLabel={confirm?.tipo === 'envio' ? 'Enviar (paper)' : 'Cancelar orden'}
        busy={state.busy}
        error={state.error}
        onConfirm={ejecutar}
        onClose={() => { setConfirm(null); setState({ busy: false, error: null }); }}
        message={confirm?.tipo === 'envio'
          ? <>Se enviará la orden a la cuenta <strong>paper</strong> (sin dinero real). Clave de idempotencia: <code>{confirm.orden.idempotencyKey}</code>. Reintentar con la misma clave no duplica la orden.</>
          : <>Se solicitará al broker la cancelación de la orden {shortId(confirm?.orden._id)}.</>}
      />
      <Modal open={Boolean(eventos)} title="Detalle de la orden" onClose={() => setEventos(null)} size="lg">
        {eventos && (
          <div className="stack">
            <h3>Componentes</h3>
            <ul className="list">
              {eventos.componentes?.map(c => <li key={c._id}><code>{c.simbolo}</code> · {c.accion} · {c.intencion} · proporción {c.proporcion}</li>)}
            </ul>
            <h3>Eventos</h3>
            {eventos.eventos?.length ? (
              <ul className="list">{eventos.eventos.map(e => <li key={e._id}>{fmtDateTime(e.fecha)} · <strong>{e.tipo}</strong>{e.mensaje ? ' · ' + e.mensaje : ''}</li>)}</ul>
            ) : <p className="muted">Sin eventos registrados.</p>}
            <p className="muted small">Idempotency-Key: <code>{eventos.idempotencyKey}</code></p>
          </div>
        )}
      </Modal>
    </>
  );
}

