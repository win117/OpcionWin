import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { Badge } from '../components/Badge';
import { Field, Select } from '../components/Field';
import { SyncButton } from '../components/SyncButton';
import { useLookup } from '../hooks/useLookup';
import { sincronizaciones, conexiones } from '../api/resources';
import { ESTADOS_TRABAJO, RECURSOS_SYNC, RECURSO_LABELS } from '../utils/constants';
import { fmtDateTime } from '../utils/format';

const RECURSO_OPTS = RECURSOS_SYNC.map(r => ({ value: r, label: RECURSO_LABELS[r] }));
const toIso = d => (d ? new Date(d + 'T00:00:00.000Z').toISOString() : undefined);

function Lanzador({ onDone }) {
  const conexionesL = useLookup(conexiones);
  const [form, setForm] = useState({ recurso: 'historicos', simbolos: '', desde: '', hasta: '', conexionId: '' });
  const set = k => v => setForm(f => ({ ...f, [k]: v }));
  const simbolos = form.simbolos.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const broker = ['ordenes', 'posiciones'].includes(form.recurso);
  const invalidRange = form.desde && form.hasta && form.desde > form.hasta;
  return (
    <section className="card">
      <h2>Nueva sincronización</h2>
      <div className="form-grid form-grid--4">
        <Field label="Recurso" required><Select value={form.recurso} onChange={set('recurso')} options={RECURSO_OPTS} /></Field>
        <Field label="Símbolos" help="Separados por coma. Deben estar registrados.">
          <input type="text" value={form.simbolos} onChange={e => set('simbolos')(e.target.value)} placeholder="AAPL, MSFT" />
        </Field>
        <Field label="Desde"><input type="date" value={form.desde} onChange={e => set('desde')(e.target.value)} /></Field>
        <Field label="Hasta" error={invalidRange ? 'Debe ser posterior a «Desde».' : null}><input type="date" value={form.hasta} onChange={e => set('hasta')(e.target.value)} /></Field>
        {broker && (
          <Field label="Conexión" required>
            <Select value={form.conexionId} onChange={set('conexionId')} options={conexionesL.items.map(c => ({ value: c._id, label: c.alias }))} />
          </Field>
        )}
      </div>
      <SyncButton
        recurso={form.recurso}
        simbolos={simbolos}
        conexionId={broker ? form.conexionId : undefined}
        desde={toIso(form.desde)}
        hasta={toIso(form.hasta)}
        disabled={invalidRange || (broker && !form.conexionId)}
        onDone={onDone}
        label="Ejecutar sincronización"
      />
    </section>
  );
}

export default function Sincronizaciones() {
  const [signal, setSignal] = useState(0);
  return (
    <>
      <PageHeader title="Sincronizaciones" subtitle="Trabajos de importación desde proveedores (Alpaca, SEC)" />
      <Lanzador onDone={() => setSignal(s => s + 1)} />
      <ResourceManager
        title="Historial"
        api={sincronizaciones}
        sortDesc="createdAt"
        searchable={false}
        creatable={false}
        editable={false}
        reloadSignal={signal}
        nameOf={r => `la sincronización de ${r.recurso}`}
        canDelete={r => ['completada', 'fallida'].includes(r.estado)}
        filters={[
          { name: 'estado', label: 'Estado', options: ESTADOS_TRABAJO.map(e => ({ value: e, label: e })) },
          { name: 'recurso', label: 'Recurso', options: RECURSO_OPTS },
        ]}
        columns={[
          { key: 'fecha', label: 'Creada', render: r => fmtDateTime(r.createdAt) },
          { key: 'recurso', label: 'Recurso', render: r => RECURSO_LABELS[r.recurso] || r.recurso },
          { key: 'proveedor', label: 'Proveedor' },
          { key: 'simbolos', label: 'Símbolos', className: 'col-wrap', render: r => r.simbolos?.join(', ') || '—' },
          { key: 'conteo', label: 'Proc. / fallidos', align: 'right', render: r => `${r.procesados ?? 0} / ${r.fallidos ?? 0}` },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
          { key: 'fin', label: 'Finalizada', render: r => fmtDateTime(r.finalizadaEn) },
          { key: 'error', label: 'Error', className: 'col-wrap', render: r => r.error ? <span className="field__error">{r.error}</span> : '—' },
        ]}
      />
    </>
  );
}
