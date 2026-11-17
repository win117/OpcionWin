import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import CarteraPaper from './analizar/CarteraPaper';
import { Tabs } from '../components/Tabs';
import { Badge } from '../components/Badge';
import { Modal, ConfirmDialog } from '../components/Modal';
import { KeyValue } from '../components/Source';
import { SyncButton } from '../components/SyncButton';
import { Select } from '../components/Field';
import { useLookup } from '../hooks/useLookup';
import { brokers, conexiones, ordenes, posiciones, configuraciones, contratos, acciones } from '../api/resources';
import { ESTADOS_ORDEN } from '../utils/constants';
import { fmtDateTime, fmtMoney, fmtNum, shortId } from '../utils/format';
import { contratoLabel, uuid } from '../utils/objects';

const PAPER_ONLY = [{ value: 'paper', label: 'paper (simulado)' }, { value: 'live', label: 'live (bloqueado)', disabled: true }];

function PaperBanner() {
  return (
    <div className="banner-paper" role="note">
      <strong>Entorno paper — sin dinero real.</strong> Las órdenes se envían únicamente a Alpaca paper trading; el entorno live está bloqueado.
    </div>
  );
}

/* ---------- Brokers ---------- */
function BrokersTab() {
  return (
    <ResourceManager
      api={brokers}
      createLabel="Nuevo broker"
      fields={[
        { name: 'codigo', label: 'Código', type: 'select', required: true, options: [{ value: 'alpaca', label: 'Alpaca' }, { value: 'webull', label: 'Webull (adaptador pendiente)' }] },
        { name: 'nombre', label: 'Nombre', required: true },
        { name: 'entornos', label: 'Entornos', type: 'checkboxes', options: PAPER_ONLY, default: ['paper'] },
        { name: 'activo', label: 'Activo', type: 'checkbox', default: true },
      ]}
      columns={[
        { key: 'codigo', label: 'Código', render: r => <code>{r.codigo}</code> },
        { key: 'nombre', label: 'Nombre' },
        { key: 'entornos', label: 'Entornos', render: r => r.entornos?.join(', ') || '—' },
        { key: 'activo', label: 'Activo', render: r => <Badge value={Boolean(r.activo)} /> },
      ]}
    />
  );
}

/* ---------- Conexiones ---------- */
function ConexionesTab({ brokersL }) {
  const [verif, setVerif] = useState(null); // { conexion, busy, data, error }
  const verificar = async (row, reload) => {
    setVerif({ conexion: row, busy: true, data: null, error: null });
    try {
      const data = await acciones.verificarConexion(row._id);
      setVerif({ conexion: row, busy: false, data, error: null });
      reload();
    } catch (error) {
      setVerif({ conexion: row, busy: false, data: null, error });
    }
  };
  return (
    <>
      <ResourceManager
        api={conexiones}
        createLabel="Nueva conexión"
        nameOf={r => r.alias}
        fields={[
          { name: 'brokerId', label: 'Broker', type: 'select', required: true, options: () => brokersL.items.map(b => ({ value: b._id, label: `${b.nombre} (${b.codigo})` })) },
          { name: 'alias', label: 'Alias', required: true, placeholder: 'Alpaca paper' },
          { name: 'entorno', label: 'Entorno', type: 'select', required: true, options: PAPER_ONLY, default: 'paper', help: 'Solo paper. Live está bloqueado por diseño (ADR-005).' },
          { name: 'cuentaExternaId', label: 'Cuenta externa (opcional)' },
          { name: 'credencialRef', label: 'Credenciales', type: 'select', required: true, default: 'env:ALPACA', options: [{ value: 'env:ALPACA', label: 'env:ALPACA (variables del servidor)' }], help: 'Las claves viven en el servidor; nunca se envían ni se muestran aquí.' },
        ]}
        transform={payload => ({ ...payload, entorno: 'paper', credencialRef: payload.credencialRef || 'env:ALPACA' })}
        columns={[
          { key: 'alias', label: 'Alias', render: r => <strong>{r.alias}</strong> },
          { key: 'broker', label: 'Broker', render: r => brokersL.byId.get(r.brokerId)?.nombre || '—' },
          { key: 'entorno', label: 'Entorno', render: r => <Badge value={r.entorno} tone={r.entorno === 'paper' ? 'info' : 'danger'} /> },
          { key: 'cuenta', label: 'Cuenta', render: r => r.cuentaExternaId || '—' },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
        ]}
        rowActions={(row, reload) => (
          <button type="button" className="btn btn--sm" onClick={() => verificar(row, reload)}>Verificar</button>
        )}
      />
      <Modal open={Boolean(verif)} title={`Verificación · ${verif?.conexion.alias || ''}`} onClose={() => setVerif(null)}>
        {verif?.busy && <p role="status">Consultando la cuenta paper…</p>}
        {verif?.error && <div className="alert alert--danger" role="alert">{verif.error.message}</div>}
        {verif?.data && <KeyValue data={verif.data} />}
      </Modal>
    </>
  );
}

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

function OrdenesTab({ conexionesL, configsL }) {
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

/* ---------- Posiciones ---------- */
function PosicionesTab({ conexionesL }) {
  const [conexionId, setConexionId] = useState('');
  const contratosL = useLookup(contratos);
  const [signal, setSignal] = useState(0);
  return (
    <ResourceManager
      api={posiciones}
      searchable={false}
      creatable={false}
      editable={false}
      deletable={false}
      reloadSignal={signal}
      filters={[{ name: 'estado', label: 'Estado', options: [{ value: 'abierta', label: 'Abiertas' }, { value: 'cerrada', label: 'Cerradas' }] }]}
      emptyText="Sincroniza posiciones desde una conexión paper."
      toolbar={() => (
        <div className="sync-inline">
          <Select aria-label="Conexión para sincronizar" value={conexionId} onChange={setConexionId} placeholder="Conexión…" options={conexionesL.items.map(c => ({ value: c._id, label: c.alias }))} />
          <SyncButton recurso="posiciones" conexionId={conexionId} disabled={!conexionId} onDone={() => setSignal(s => s + 1)} label="Sincronizar posiciones" />
          <SyncButton recurso="ordenes" conexionId={conexionId} disabled={!conexionId} label="Sincronizar órdenes" />
        </div>
      )}
      columns={[
        { key: 'contrato', label: 'Contrato', render: r => contratoLabel(contratosL.byId.get(r.contratoId)) || <code>{shortId(r.contratoId)}</code> },
        { key: 'lado', label: 'Lado', render: r => <Badge value={r.lado} tone={r.lado === 'long' ? 'success' : 'danger'} /> },
        { key: 'cantidad', label: 'Cantidad', align: 'right', render: r => fmtNum(r.cantidad, 2) },
        { key: 'precio', label: 'Precio promedio', align: 'right', render: r => fmtMoney(r.precioPromedio) },
        { key: 'conexion', label: 'Conexión', render: r => conexionesL.byId.get(r.conexionId)?.alias || '—' },
        { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
        { key: 'actualizada', label: 'Actualizada', render: r => fmtDateTime(r.actualizadaEn) },
      ]}
    />
  );
}

export default function Broker() {
  const [tab, setTab] = useState('cartera');
  const brokersL = useLookup(brokers);
  const conexionesL = useLookup(conexiones);
  const configsL = useLookup(configuraciones);
  return (
    <>
      <PageHeader title="Broker" subtitle="Conexiones, órdenes y posiciones en Alpaca paper" />
      <PaperBanner />
      <section className="card">
        <Tabs
          tabs={[{ value: 'cartera', label: 'Cartera' }, { value: 'ordenes', label: 'Órdenes' }, { value: 'posiciones', label: 'Posiciones' }, { value: 'conexiones', label: 'Conexiones' }, { value: 'brokers', label: 'Brokers' }]}
          value={tab}
          onChange={v => { setTab(v); brokersL.reload(); conexionesL.reload(); }}
          label="Secciones del broker"
        />
      </section>
      <div role="tabpanel">
        {tab === 'cartera' && <CarteraPaper titulo="Cartera paper" />}
        {tab === 'ordenes' && <OrdenesTab conexionesL={conexionesL} configsL={configsL} />}
        {tab === 'posiciones' && <PosicionesTab conexionesL={conexionesL} />}
        {tab === 'conexiones' && <ConexionesTab brokersL={brokersL} />}
        {tab === 'brokers' && <BrokersTab />}
      </div>
    </>
  );
}
