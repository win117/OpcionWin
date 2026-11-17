import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Tabs } from '../components/Tabs';
import { Field, Select, CheckboxGroup } from '../components/Field';
import { LookupSelect, empresaOptions, estrategiaOptions, perfilOptions } from '../components/Pickers';
import { JobStatus } from '../components/JobStatus';
import { Table } from '../components/Table';
import { Badge } from '../components/Badge';
import { ScoreBar } from '../components/Gauge';
import { Notice } from '../components/States';
import { Modal } from '../components/Modal';
import { useLookup } from '../hooks/useLookup';
import { useAsync } from '../hooks/useAsync';
import { useLaunchJob } from '../hooks/useJob';
import { empresas, estrategias, perfiles, evaluaciones, selecciones, confluencias, acciones, jobPaths, listLatest } from '../api/resources';
import { CORES, CORE_LABELS, ESTRATEGIA_LABELS, ESTRATEGIA_OPTIONS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtNum, fmtPct } from '../utils/format';
import { empresaLabel } from '../utils/objects';

const CORE_OPTS = CORES.map(c => ({ value: c, label: CORE_LABELS[c] }));
const MODOS = [
  { value: 'empresa', label: 'Empresa → mejores estrategias' },
  { value: 'estrategia', label: 'Estrategia → mejores empresas' },
  { value: 'empresa_estrategia', label: 'Empresa + estrategia (compatibilidad)' },
];

function Resultados({ seleccion, empresasById, estrategiasById }) {
  const rows = [...(seleccion?.resultados || [])].sort((a, b) => b.puntaje - a.puntaje).map((r, i) => ({ ...r, rank: i + 1 }));
  return (
    <Table
      rows={rows}
      rowKey={r => r._id || `${r.empresaId}-${r.estrategiaId}`}
      emptyTitle="Sin resultados"
      emptyText="La selección no produjo candidatos (revisa datos faltantes y filtros)."
      columns={[
        { key: 'rank', label: '#', align: 'right' },
        { key: 'empresa', label: 'Empresa', render: r => empresaLabel(empresasById.get(r.empresaId)) || r.empresaId },
        { key: 'estrategia', label: 'Estrategia', render: r => { const e = estrategiasById.get(r.estrategiaId); return e ? `${ESTRATEGIA_LABELS[e.codigo] || e.codigo}` : r.estrategiaId; } },
        { key: 'puntaje', label: 'Compatibilidad', render: r => <ScoreBar value={r.puntaje} /> },
        { key: 'cobertura', label: 'Cobertura', align: 'right', render: r => fmtPct(r.cobertura) },
        { key: 'motivos', label: 'Motivos', className: 'col-wrap', render: r => r.motivos?.length ? <ul className="list list--compact">{r.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul> : '—' },
      ]}
    />
  );
}

function SeleccionForm({ lookups, onLaunched }) {
  const { empresasL, estrategiasL, perfilesL } = lookups;
  const [form, setForm] = useState({
    modo: 'empresa', empresaId: '', estrategiaId: '', empresasCandidatas: [], estrategiasCandidatas: [...ESTRATEGIA_OPTIONS.map(o => o.value)],
    coresSeleccionados: [...CORES], perfilId: '', periodos: '', intervalo: '', diasVencimientoMin: '', diasVencimientoMax: '',
  });
  const set = key => value => setForm(f => ({ ...f, [key]: value }));
  const job = useLaunchJob(body => acciones.seleccionar(body), r => jobPaths.seleccion(r._id));
  const needsEmpresa = form.modo !== 'estrategia';
  const needsEstrategia = form.modo !== 'empresa';

  useEffect(() => { if (job.done) onLaunched?.(); }, [job.done]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = event => {
    event.preventDefault();
    const filtros = {};
    if (form.periodos) filtros.periodos = Number(form.periodos);
    if (form.intervalo) filtros.intervalo = form.intervalo;
    if (form.diasVencimientoMin !== '') filtros.diasVencimientoMin = Number(form.diasVencimientoMin);
    if (form.diasVencimientoMax !== '') filtros.diasVencimientoMax = Number(form.diasVencimientoMax);
    const body = { modo: form.modo, coresSeleccionados: form.coresSeleccionados, filtros };
    if (needsEmpresa) body.empresaId = form.empresaId;
    if (needsEstrategia) body.estrategiaId = form.estrategiaId;
    if (form.modo === 'estrategia') body.empresasCandidatas = form.empresasCandidatas;
    if (form.modo === 'empresa') body.estrategiasCandidatas = form.estrategiasCandidatas;
    if (form.perfilId) body.perfilId = form.perfilId;
    job.launch(body);
  };

  const invalid = !form.coresSeleccionados.length || (needsEmpresa && !form.empresaId) || (needsEstrategia && !form.estrategiaId)
    || (form.modo === 'estrategia' && !form.empresasCandidatas.length) || (form.modo === 'empresa' && !form.estrategiasCandidatas.length);

  return (
    <>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Modo" required>
          <Select value={form.modo} onChange={set('modo')} options={MODOS} />
        </Field>
        <LookupSelect label="Perfil de análisis (opcional)" lookup={perfilesL} toOptions={perfilOptions} value={form.perfilId} onChange={set('perfilId')} placeholder="Sin perfil" />
        {needsEmpresa && <LookupSelect label="Empresa" required lookup={empresasL} toOptions={empresaOptions} value={form.empresaId} onChange={set('empresaId')} />}
        {needsEstrategia && <LookupSelect label="Estrategia" required lookup={estrategiasL} toOptions={estrategiaOptions} value={form.estrategiaId} onChange={set('estrategiaId')} />}
        {form.modo === 'estrategia' && (
          <div className="span-2">
            <CheckboxGroup legend="Empresas candidatas" required columns options={empresaOptions(empresasL.items)} value={form.empresasCandidatas} onChange={set('empresasCandidatas')} />
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => set('empresasCandidatas')(empresasL.items.filter(e => e.activo !== false).map(e => e._id))}>Seleccionar activas</button>
          </div>
        )}
        {form.modo === 'empresa' && (
          <div className="span-2">
            <CheckboxGroup legend="Estrategias candidatas" required options={ESTRATEGIA_OPTIONS} value={form.estrategiasCandidatas} onChange={set('estrategiasCandidatas')} />
          </div>
        )}
        <div className="span-2">
          <CheckboxGroup legend="Cores" required columns options={CORE_OPTS} value={form.coresSeleccionados} onChange={set('coresSeleccionados')} help="Un core no seleccionado no cuenta como evaluación negativa; reduce la cobertura." />
        </div>
        <fieldset className="span-2 fieldset">
          <legend className="field__label">Filtros (opcionales)</legend>
          <div className="form-grid form-grid--4">
            <Field label="Periodos"><input type="number" min="1" step="1" value={form.periodos} onChange={e => set('periodos')(e.target.value)} placeholder="120" /></Field>
            <Field label="Intervalo"><input type="text" value={form.intervalo} onChange={e => set('intervalo')(e.target.value)} placeholder="1Day" /></Field>
            <Field label="Días a vencimiento mín."><input type="number" min="0" step="1" value={form.diasVencimientoMin} onChange={e => set('diasVencimientoMin')(e.target.value)} placeholder="0" /></Field>
            <Field label="Días a vencimiento máx."><input type="number" min="0" step="1" value={form.diasVencimientoMax} onChange={e => set('diasVencimientoMax')(e.target.value)} placeholder="60" /></Field>
          </div>
        </fieldset>
        <div className="span-2 form-actions">
          <button type="submit" className="btn btn--primary" disabled={invalid || job.busy}>{job.busy ? 'Ejecutando…' : 'Ejecutar selección'}</button>
        </div>
      </form>
      <JobStatus job={job} label="Selección" />
      {job.done && job.data?.estado === 'completada' && (
        <Resultados seleccion={job.data} empresasById={empresasL.byId} estrategiasById={estrategiasL.byId} />
      )}
    </>
  );
}

function ConfluenciaForm({ lookups }) {
  const { empresasL, estrategiasL } = lookups;
  const [empresaId, setEmpresaId] = useState('');
  const [estrategiaId, setEstrategiaId] = useState('');
  const [cores, setCores] = useState([...CORES]);
  const [elegidas, setElegidas] = useState({}); // core → evaluacionId
  const [pesos, setPesos] = useState(Object.fromEntries(CORES.map(c => [c, '1'])));
  const disponibles = useAsync(
    () => listLatest(evaluaciones, { empresaId, estado: 'completada' }, { maxPages: 10 }),
    [empresaId],
    { enabled: Boolean(empresaId) },
  );
  const porCore = useMemo(() => {
    const map = {};
    for (const e of disponibles.data?.items || []) (map[e.core] ||= []).push(e);
    return map;
  }, [disponibles.data]);

  useEffect(() => {
    const next = {};
    for (const c of CORES) if (porCore[c]?.length) next[c] = porCore[c][0]._id;
    setElegidas(next);
  }, [porCore]);

  const job = useLaunchJob(body => acciones.confluir(body), r => jobPaths.confluencia(r._id));
  const evaluacionesIds = cores.map(c => elegidas[c]).filter(Boolean);

  const submit = event => {
    event.preventDefault();
    job.launch({
      empresaId, estrategiaId, evaluacionesIds, coresSeleccionados: cores,
      ponderaciones: cores.map(core => ({ core, peso: Number(pesos[core] || 0) })),
    });
  };

  const r = job.data;
  return (
    <>
      <form className="form-grid" onSubmit={submit}>
        <LookupSelect label="Empresa" required lookup={empresasL} toOptions={empresaOptions} value={empresaId} onChange={setEmpresaId} />
        <LookupSelect label="Estrategia" required lookup={estrategiasL} toOptions={estrategiaOptions} value={estrategiaId} onChange={setEstrategiaId} />
        <div className="span-2">
          <CheckboxGroup legend="Cores" required columns options={CORE_OPTS} value={cores} onChange={setCores} />
        </div>
        {empresaId && (
          <div className="span-2 table-wrap">
            <table className="table table--dense">
              <caption className="sr-only">Evaluación y peso por core</caption>
              <thead><tr><th scope="col">Core</th><th scope="col">Evaluación (completada)</th><th scope="col">Peso</th></tr></thead>
              <tbody>
                {cores.map(core => (
                  <tr key={core}>
                    <th scope="row">{CORE_LABELS[core]}</th>
                    <td>
                      {porCore[core]?.length ? (
                        <Select
                          aria-label={`Evaluación de ${CORE_LABELS[core]}`}
                          value={elegidas[core] || ''}
                          onChange={v => setElegidas(e => ({ ...e, [core]: v }))}
                          placeholder="No usar"
                          options={porCore[core].map(e => ({ value: e._id, label: `${fmtDateTime(e.createdAt)} · puntaje ${fmtNum(e.puntaje, 0)} · ${e.versionAlgoritmo}` }))}
                        />
                      ) : <span className="muted">{disponibles.loading ? 'Cargando…' : 'Sin evaluaciones completadas (evalúa en Análisis)'}</span>}
                    </td>
                    <td>
                      <input type="number" min="0" step="any" className="input--narrow" aria-label={`Peso de ${CORE_LABELS[core]}`} value={pesos[core]} onChange={e => setPesos(p => ({ ...p, [core]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {disponibles.error && <div className="span-2 alert alert--danger">{disponibles.error.message}</div>}
        <div className="span-2 form-actions">
          <button type="submit" className="btn btn--primary" disabled={!empresaId || !estrategiaId || !cores.length || !evaluacionesIds.length || job.busy}>
            {job.busy ? 'Ejecutando…' : 'Calcular confluencia'}
          </button>
        </div>
      </form>
      <JobStatus job={job} label="Confluencia" />
      {job.done && r?.estado === 'completada' && (
        <div className="result-card">
          <div>
            <h3>Compatibilidad con {ESTRATEGIA_LABELS[estrategiasL.byId.get(r.estrategiaId)?.codigo] || 'la estrategia'}</h3>
            <ScoreBar value={r.puntaje} />
            <p className="muted">Cobertura {fmtPct(r.cobertura)} · versión <code>{r.versionAlgoritmo}</code></p>
          </div>
          {r.motivos?.length > 0 && <ul className="list">{r.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      )}
    </>
  );
}

function HistorialSelecciones({ lookups, signal }) {
  const state = useAsync(() => listLatest(selecciones, {}, { limit: 10, maxPages: 10 }), [signal]);
  const [ver, setVer] = useState(null);
  return (
    <section className="card">
      <header className="card__header">
        <h2>Selecciones recientes</h2>
        <button type="button" className="btn btn--sm" onClick={state.reload}>Actualizar</button>
      </header>
      <Table
        dense
        loading={state.loading}
        error={state.error}
        onRetry={state.reload}
        rows={state.data?.items || []}
        emptyText="Aún no hay selecciones."
        columns={[
          { key: 'fecha', label: 'Fecha', render: r => fmtDateTime(r.createdAt) },
          { key: 'modo', label: 'Modo', render: r => MODOS.find(m => m.value === r.modo)?.label || r.modo },
          { key: 'cores', label: 'Cores', render: r => r.coresSeleccionados?.map(c => CORE_LABELS[c]).join(', ') },
          { key: 'resultados', label: 'Resultados', align: 'right', render: r => r.resultados?.length ?? 0 },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
          { key: 'ver', label: '', render: r => <button type="button" className="btn btn--sm" onClick={() => setVer(r)}>Ver</button> },
        ]}
      />
      <Modal open={Boolean(ver)} title="Resultados de la selección" onClose={() => setVer(null)} size="lg">
        {ver && (
          <>
            {ver.error && <div className="alert alert--danger">{ver.error}</div>}
            <Resultados seleccion={ver} empresasById={lookups.empresasL.byId} estrategiasById={lookups.estrategiasL.byId} />
            <p className="disclaimer">{DISCLAIMER}</p>
          </>
        )}
      </Modal>
    </section>
  );
}

function ConfluenciasRecientes({ lookups, signal }) {
  const state = useAsync(() => listLatest(confluencias, {}, { limit: 10, maxPages: 10 }), [signal]);
  return (
    <section className="card">
      <header className="card__header">
        <h2>Confluencias recientes</h2>
        <button type="button" className="btn btn--sm" onClick={state.reload}>Actualizar</button>
      </header>
      <Table
        dense
        loading={state.loading}
        error={state.error}
        onRetry={state.reload}
        rows={state.data?.items || []}
        emptyText="Aún no hay confluencias."
        columns={[
          { key: 'fecha', label: 'Fecha', render: r => fmtDateTime(r.createdAt) },
          { key: 'empresa', label: 'Empresa', render: r => lookups.empresasL.byId.get(r.empresaId)?.simbolo || '—' },
          { key: 'estrategia', label: 'Estrategia', render: r => ESTRATEGIA_LABELS[lookups.estrategiasL.byId.get(r.estrategiaId)?.codigo] || '—' },
          { key: 'puntaje', label: 'Compatibilidad', render: r => <ScoreBar value={r.puntaje} /> },
          { key: 'cobertura', label: 'Cobertura', align: 'right', render: r => fmtPct(r.cobertura) },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
        ]}
      />
    </section>
  );
}

export default function Seleccion() {
  const [tab, setTab] = useState('seleccion');
  const [signal, setSignal] = useState(0);
  const lookups = {
    empresasL: useLookup(empresas),
    estrategiasL: useLookup(estrategias),
    perfilesL: useLookup(perfiles),
  };
  return (
    <>
      <PageHeader title="Confluencia y selección" subtitle="Combina los cores y ordena la compatibilidad por estrategia (0–100)" />
      <Notice tone="warning" title="Aviso:">{DISCLAIMER} La compatibilidad mide qué tan alineadas están las señales con la estrategia, no una probabilidad de ganancia.</Notice>
      <section className="card">
        <Tabs tabs={[{ value: 'seleccion', label: 'Selección' }, { value: 'confluencia', label: 'Confluencia' }]} value={tab} onChange={setTab} label="Tipo de ejecución" />
        <div role="tabpanel" className="tabpanel">
          {tab === 'seleccion'
            ? <SeleccionForm lookups={lookups} onLaunched={() => setSignal(s => s + 1)} />
            : <ConfluenciaForm lookups={lookups} />}
        </div>
      </section>
      {tab === 'seleccion' ? <HistorialSelecciones lookups={lookups} signal={signal} /> : <ConfluenciasRecientes lookups={lookups} signal={signal} />}
    </>
  );
}
