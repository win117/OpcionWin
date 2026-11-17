import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { CheckboxGroup } from '../components/Field';
import { LookupSelect, empresaOptions, perfilOptions } from '../components/Pickers';
import { EvaluationDetail } from '../components/EvaluationDetail';
import { JobStatus } from '../components/JobStatus';
import { Tabs } from '../components/Tabs';
import { Table } from '../components/Table';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { useLookup } from '../hooks/useLookup';
import { useAsync } from '../hooks/useAsync';
import { useJob } from '../hooks/useJob';
import { empresas, perfiles, acciones, jobPaths, listLatest } from '../api/resources';
import { CORES, CORE_LABELS, CORE_DESCRIPCION, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtNum, fmtPct } from '../utils/format';

function CoreJobCard({ core, record, error, empresa }) {
  const job = useJob(record ? jobPaths.evaluacionCore(core, record._id) : null, { initial: record });
  return (
    <article className="card job-card">
      <header className="card__header">
        <h3>{CORE_LABELS[core]}</h3>
      </header>
      {error && <div className="alert alert--danger" role="alert">{error.message}</div>}
      {record && !job.done && <JobStatus job={job} label="Evaluación" />}
      {job.done && <EvaluationDetail evaluacion={job.data} empresa={empresa} />}
    </article>
  );
}

function Historial({ empresaId, empresasById, refreshSignal }) {
  const [core, setCore] = useState(CORES[0]);
  const [detalle, setDetalle] = useState(null);
  const state = useAsync(
    () => listLatest(p => acciones.evaluacionesCore(core, p), empresaId ? { empresaId } : {}, { limit: 25, maxPages: 10 }),
    [core, empresaId, refreshSignal],
  );
  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>Historial por core</h2>
          <p className="muted">{empresaId ? 'Filtrado por la empresa seleccionada.' : 'Todas las empresas.'} Más recientes primero.</p>
        </div>
        <button type="button" className="btn btn--sm" onClick={state.reload}>Actualizar</button>
      </header>
      <Tabs tabs={CORES.map(c => ({ value: c, label: CORE_LABELS[c] }))} value={core} onChange={setCore} label="Core" />
      <Table
        dense
        loading={state.loading}
        error={state.error}
        onRetry={state.reload}
        rows={state.data?.items || []}
        emptyText="Aún no hay evaluaciones de este core."
        columns={[
          { key: 'fecha', label: 'Fecha', render: r => fmtDateTime(r.createdAt) },
          { key: 'empresa', label: 'Empresa', render: r => empresasById.get(r.empresaId)?.simbolo || '—' },
          { key: 'puntaje', label: 'Puntaje', align: 'right', render: r => fmtNum(r.puntaje, 0) },
          { key: 'cobertura', label: 'Cobertura', align: 'right', render: r => fmtPct(r.cobertura) },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
          { key: 'version', label: 'Versión', render: r => <code>{r.versionAlgoritmo}</code> },
          { key: 'ver', label: '', render: r => <button type="button" className="btn btn--sm" onClick={() => setDetalle(r)}>Ver</button> },
        ]}
      />
      <Modal open={Boolean(detalle)} title="Detalle de evaluación" onClose={() => setDetalle(null)} size="lg">
        {detalle && <EvaluationDetail evaluacion={detalle} empresa={empresasById.get(detalle.empresaId)} />}
      </Modal>
    </section>
  );
}

export default function Analisis() {
  const empresasLookup = useLookup(empresas);
  const perfilesLookup = useLookup(perfiles);
  const [empresaId, setEmpresaId] = useState('');
  const [perfilId, setPerfilId] = useState('');
  const [cores, setCores] = useState(CORES);
  const [runs, setRuns] = useState([]); // [{ key, core, record?, error? }]
  const [busy, setBusy] = useState(false);
  const [signal, setSignal] = useState(0);

  // Al elegir perfil se proponen sus cores.
  useEffect(() => {
    const perfil = perfilesLookup.byId.get(perfilId);
    if (perfil?.coresSeleccionados?.length) setCores(perfil.coresSeleccionados);
  }, [perfilId, perfilesLookup.byId]);

  const evaluar = async event => {
    event.preventDefault();
    if (!empresaId || !cores.length) return;
    setBusy(true);
    const body = { empresaId, ...(perfilId ? { perfilId } : {}) };
    const stamp = Date.now();
    const results = await Promise.allSettled(cores.map(core => acciones.evaluarCore(core, body)));
    setRuns(cores.map((core, i) => ({
      key: `${stamp}-${core}`,
      core,
      record: results[i].status === 'fulfilled' ? results[i].value : null,
      error: results[i].status === 'rejected' ? results[i].reason : null,
    })));
    setBusy(false);
    setSignal(s => s + 1);
  };

  const empresa = empresasLookup.byId.get(empresaId);

  return (
    <>
      <PageHeader title="Análisis por cores" subtitle="Cada core produce un índice direccional: 0 bajista · 50 neutral · 100 alcista" />
      <form className="card form-grid" onSubmit={evaluar}>
        <LookupSelect label="Empresa" required lookup={empresasLookup} toOptions={empresaOptions} value={empresaId} onChange={setEmpresaId} />
        <LookupSelect label="Perfil de análisis (opcional)" lookup={perfilesLookup} toOptions={perfilOptions} value={perfilId} onChange={setPerfilId} placeholder="Sin perfil (parámetros por defecto)" />
        <div className="span-2">
          <CheckboxGroup
            legend="Cores a evaluar"
            required
            columns
            options={CORES.map(c => ({ value: c, label: CORE_LABELS[c] }))}
            value={cores}
            onChange={setCores}
            help="Requiere datos sincronizados (Mercado → Sincronizar). Si faltan, el core lo reporta en «datos faltantes»."
          />
        </div>
        <details className="details span-2">
          <summary>¿Qué mide cada core?</summary>
          <dl className="defs">
            {CORES.map(c => <div key={c}><dt>{CORE_LABELS[c]}</dt><dd>{CORE_DESCRIPCION[c]}</dd></div>)}
          </dl>
        </details>
        <div className="span-2 form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || !empresaId || !cores.length}>
            {busy ? 'Enviando…' : `Evaluar ${cores.length} core${cores.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>

      {runs.length > 0 && (
        <div className="grid grid--cards">
          {runs.map(run => <CoreJobCard key={run.key} core={run.core} record={run.record} error={run.error} empresa={empresa} />)}
        </div>
      )}
      <p className="disclaimer">{DISCLAIMER}</p>
      <Historial empresaId={empresaId} empresasById={empresasLookup.byId} refreshSignal={signal} />
    </>
  );
}
