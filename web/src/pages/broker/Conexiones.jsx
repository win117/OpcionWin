import { useState } from 'react';
import { PageHeader } from '../../components/Layout';
import { ResourceManager } from '../../components/ResourceManager';
import { Tabs } from '../../components/Tabs';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { KeyValue } from '../../components/Source';
import { useLookup } from '../../hooks/useLookup';
import { brokers, conexiones, acciones } from '../../api/resources';

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

/** Configuración → Conexiones: catálogo de brokers y sus conexiones paper. */
export default function Conexiones() {
  const [tab, setTab] = useState('conexiones');
  const brokersL = useLookup(brokers);
  return (
    <>
      <PageHeader title="Brokers y conexiones" subtitle="Conexiones paper con Alpaca o Webull. Las claves viven en el servidor." />
      <PaperBanner />
      <section className="card">
        <Tabs tabs={[{ value: 'conexiones', label: 'Conexiones' }, { value: 'brokers', label: 'Brokers' }]} value={tab} onChange={v => { setTab(v); brokersL.reload(); }} label="Brokers y conexiones" />
      </section>
      <div role="tabpanel">
        {tab === 'conexiones' && <ConexionesTab brokersL={brokersL} />}
        {tab === 'brokers' && <BrokersTab />}
      </div>
    </>
  );
}
