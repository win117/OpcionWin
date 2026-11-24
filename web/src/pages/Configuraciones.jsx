import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { SubdocEditor } from '../components/SubdocEditor';
import { Badge } from '../components/Badge';
import { Field } from '../components/Field';
import { JobStatus } from '../components/JobStatus';
import { PayoffChart, analyzePayoff } from '../components/PayoffChart';
import { Empty, ErrorMessage, Loading, Notice } from '../components/States';
import { SourceLine } from '../components/Source';
import { useAsync } from '../hooks/useAsync';
import { useLookup } from '../hooks/useLookup';
import { useLaunchJob } from '../hooks/useJob';
import { configuraciones, empresas, estrategias, contratos, evaluaciones, mercado, acciones, jobPaths, listLatest } from '../api/resources';
import { empresaOptions, estrategiaOptions } from '../components/Pickers';
import { PARAM_FIELDS } from './Perfiles';
import { ESTRATEGIA_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtMoney, fmtNum, fmtMetric, isNum } from '../utils/format';
import { contratoLabel, empresaLabel } from '../utils/objects';
import { EXPLICACIONES } from './Estrategias';

const ESTADOS = [{ value: 'borrador', label: 'Borrador' }, { value: 'validada', label: 'Validada' }, { value: 'archivada', label: 'Archivada' }];

export default function Configuraciones() {
  const empresasL = useLookup(empresas);
  const estrategiasL = useLookup(estrategias);
  const fields = [
    { name: 'nombre', label: 'Nombre', required: true },
    { name: 'estado', label: 'Estado', type: 'select', options: ESTADOS, required: true, default: 'borrador', help: 'Solo los borradores permiten editar componentes.' },
    { name: 'empresaId', label: 'Empresa', type: 'select', options: () => empresaOptions(empresasL.items), required: true },
    { name: 'estrategiaId', label: 'Estrategia', type: 'select', options: () => estrategiaOptions(estrategiasL.items), required: true },
    ...PARAM_FIELDS,
  ];
  return (
    <>
      <PageHeader title="Configuraciones" subtitle="Estrategias concretas: empresa, patas (contratos) y parámetros" />
      <ResourceManager
        api={configuraciones}
        fields={fields}
        createLabel="Nueva configuración"
        filters={[{ name: 'estado', label: 'Estado', options: ESTADOS }]}
        columns={[
          { key: 'nombre', label: 'Nombre', render: r => <Link to={`/configuracion/configuraciones/${r._id}`}><strong>{r.nombre}</strong></Link> },
          { key: 'empresa', label: 'Empresa', render: r => empresasL.byId.get(r.empresaId)?.simbolo || '—' },
          { key: 'estrategia', label: 'Estrategia', render: r => ESTRATEGIA_LABELS[estrategiasL.byId.get(r.estrategiaId)?.codigo] || '—' },
          { key: 'componentes', label: 'Patas', align: 'right', render: r => r.componentes?.length ?? 0 },
          { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
          { key: 'updatedAt', label: 'Actualizada', render: r => fmtDateTime(r.updatedAt) },
        ]}
        rowActions={row => <Link className="btn btn--sm" to={`/configuracion/configuraciones/${row._id}`}>Abrir</Link>}
      />
    </>
  );
}

/* ---------- Detalle ---------- */

function MetricasConfiguracion({ evaluacion }) {
  const m = evaluacion.metricas || [];
  const get = n => m.find(x => x.nombre === n);
  const breakevens = m.filter(x => x.nombre.startsWith('breakeven'));
  const principales = ['prima_neta', 'perdida_maxima', 'ganancia_maxima', 'delta_neta'];
  const otras = m.filter(x => !principales.includes(x.nombre) && !x.nombre.startsWith('breakeven'));
  const val = n => { const x = get(n); return x ? fmtMetric(x.valor, x.unidad) : null; };
  return (
    <div className="stack">
      <dl className="stats stats--row">
        <div><dt>Prima neta</dt><dd>{val('prima_neta') ?? '—'}</dd></div>
        <div><dt>Pérdida máxima</dt><dd>{val('perdida_maxima') ?? '—'}</dd></div>
        <div><dt>Ganancia máxima</dt><dd>{val('ganancia_maxima') ?? (evaluacion.estado === 'completada' ? 'Ilimitada / no reportada' : '—')}</dd></div>
        <div><dt>Breakevens</dt><dd>{breakevens.length ? breakevens.map(b => fmtMetric(b.valor, b.unidad)).join(' · ') : '—'}</dd></div>
        {get('delta_neta') && <div><dt>Delta neta</dt><dd>{val('delta_neta')}</dd></div>}
      </dl>
      {otras.length > 0 && (
        <details className="details"><summary>Otras métricas ({otras.length})</summary>
          <ul className="list">{otras.map((x, i) => <li key={i}><code>{x.nombre}</code>: {fmtMetric(x.valor, x.unidad)}</li>)}</ul>
        </details>
      )}
      {evaluacion.motivos?.length > 0 && <ul className="list">{evaluacion.motivos.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      {evaluacion.datosFaltantes?.length > 0 && <div className="alert alert--warning">Datos faltantes: {evaluacion.datosFaltantes.join(', ')}</div>}
      <p className="muted small">Versión del algoritmo: <code>{evaluacion.versionAlgoritmo || '—'}</code> · {fmtDateTime(evaluacion.finalizadaEn || evaluacion.createdAt)}</p>
    </div>
  );
}

function EvaluarConfiguracion({ configuracion, onSpotChange }) {
  const [precio, setPrecio] = useState('');
  const job = useLaunchJob(body => acciones.evaluarConfiguracion(configuracion._id, body), r => jobPaths.evaluacion(r._id));
  const previas = useAsync(() => listLatest(evaluaciones, { configuracionId: configuracion._id }, { limit: 5 }), [configuracion._id, job.done]);
  const submit = event => {
    event.preventDefault();
    job.launch(precio !== '' ? { precioSubyacente: Number(precio) } : {});
  };
  const shown = job.done ? job.data : previas.data?.items?.find(e => e.estado === 'completada');
  return (
    <section className="card">
      <header className="card__header"><h2>Evaluar configuración</h2></header>
      <form className="toolbar" onSubmit={submit}>
        <Field label="Precio del subyacente (opcional)" className="field--inline" help="Si se omite, el servidor usa el último dato almacenado si existe.">
          <input type="number" min="0" step="any" value={precio} onChange={e => { setPrecio(e.target.value); onSpotChange?.(e.target.value); }} />
        </Field>
        <button type="submit" className="btn btn--primary btn--sm" disabled={job.busy || !configuracion.componentes?.length}>{job.busy ? 'Evaluando…' : 'Evaluar configuración'}</button>
      </form>
      {!configuracion.componentes?.length && <Notice>Agrega al menos una pata para evaluar.</Notice>}
      <JobStatus job={job} label="Evaluación" />
      {job.done && job.data?.estado === 'fallida' && <div className="alert alert--danger">{job.data.error}</div>}
      {shown && shown.estado === 'completada' && (
        <>
          {!job.done && <p className="muted small">Última evaluación guardada:</p>}
          <MetricasConfiguracion evaluacion={shown} />
        </>
      )}
      {!shown && !job.started && !previas.loading && <Empty title="Sin evaluaciones">Evalúa para obtener prima neta, pérdida/ganancia máxima y breakevens calculados por el servidor.</Empty>}
    </section>
  );
}

function Payoff({ configuracion, contratosById, spot }) {
  const [primas, setPrimas] = useState({});
  const [snap, setSnap] = useState({ busy: false, error: null, fuentes: {} });
  const legs = (configuracion.componentes || []).map(c => {
    const k = contratosById.get(c.contratoId);
    return k ? { id: c._id, contrato: k, tipo: k.tipo, strike: k.strike, accion: c.accion, cantidad: c.cantidad * (c.proporcion || 1), multiplicador: k.multiplicador || 100, prima: Number(primas[c._id]) || 0 } : null;
  });
  const missing = legs.some(l => !l);
  const valid = legs.filter(Boolean);
  const analysis = useMemo(() => analyzePayoff(valid), [JSON.stringify(valid)]); // eslint-disable-line react-hooks/exhaustive-deps
  const sinPrimas = valid.every(l => !l.prima);

  const cargarSnapshots = async () => {
    setSnap({ busy: true, error: null, fuentes: {} });
    const next = { ...primas };
    const fuentes = {};
    try {
      for (const leg of valid) {
        const res = await listLatest(p => mercado.snapshot(leg.contrato._id, p), {}, { dateOf: r => r.fuente?.fechaDato, limit: 1, maxPages: 5 });
        const s = res.items[0];
        if (!s) continue;
        const mid = isNum(s.bid) && isNum(s.ask) ? (s.bid + s.ask) / 2 : s.ultimo;
        if (isNum(mid)) { next[leg.id] = String(Math.round(mid * 100) / 100); fuentes[leg.id] = s.fuente; }
      }
      setPrimas(next);
      setSnap({ busy: false, error: null, fuentes });
    } catch (error) {
      setSnap({ busy: false, error, fuentes });
    }
  };

  if (!configuracion.componentes?.length) return null;
  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>Pago al vencimiento</h2>
          <p className="muted">Calculado en el navegador a partir de las patas. Las primas son las que indiques (por acción).</p>
        </div>
        <button type="button" className="btn btn--sm" onClick={cargarSnapshots} disabled={snap.busy || !valid.length}>{snap.busy ? 'Cargando…' : 'Usar primas de snapshots almacenados'}</button>
      </header>
      {missing && <Notice tone="warning">Alguna pata referencia un contrato que no se pudo cargar.</Notice>}
      <ErrorMessage error={snap.error} />
      <div className="table-wrap">
        <table className="table table--dense">
          <caption className="sr-only">Patas y primas</caption>
          <thead><tr><th scope="col">Pata</th><th scope="col">Acción</th><th scope="col" className="num">Cantidad</th><th scope="col">Prima por acción (USD)</th><th scope="col">Fuente de prima</th></tr></thead>
          <tbody>
            {valid.map(l => (
              <tr key={l.id}>
                <td>{contratoLabel(l.contrato)}</td>
                <td><Badge value={l.accion} tone={l.accion === 'buy' ? 'success' : 'danger'}>{l.accion === 'buy' ? 'Compra' : 'Venta'}</Badge></td>
                <td className="num">{fmtNum(l.cantidad, 0)} × {l.multiplicador}</td>
                <td><input type="number" min="0" step="0.01" className="input--narrow" aria-label={`Prima de ${contratoLabel(l.contrato)}`} value={primas[l.id] ?? ''} placeholder="0" onChange={e => setPrimas(p => ({ ...p, [l.id]: e.target.value }))} /></td>
                <td>{snap.fuentes[l.id] ? <SourceLine fuente={snap.fuentes[l.id]} extra="punto medio bid/ask" /> : <span className="muted">manual</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sinPrimas && <Notice tone="warning">Sin primas, la curva muestra solo el valor intrínseco (no la ganancia/pérdida real).</Notice>}
      {analysis && (
        <>
          <PayoffChart analysis={analysis} spot={Number(spot) || undefined} />
          <dl className="stats stats--row">
            <div><dt>Ganancia máx. (rango)</dt><dd>{analysis.gainUnbounded ? 'Ilimitada' : fmtMoney(analysis.maxGain)}</dd></div>
            <div><dt>Pérdida máx. (rango)</dt><dd>{analysis.lossUnbounded ? 'Ilimitada' : fmtMoney(analysis.maxLoss)}</dd></div>
            <div><dt>Breakevens</dt><dd>{analysis.breakevens.length ? analysis.breakevens.map(b => fmtMoney(b)).join(' · ') : '—'}</dd></div>
          </dl>
        </>
      )}
      <p className="disclaimer">{DISCLAIMER}</p>
    </section>
  );
}

export function ConfiguracionDetalle() {
  const { id } = useParams();
  const config = useAsync(() => configuraciones.get(id), [id]);
  const c = config.data;
  const empresasL = useLookup(empresas);
  const estrategiasL = useLookup(estrategias);
  const contratosL = useLookup(contratos, { empresaId: c?.empresaId }, { enabled: Boolean(c?.empresaId) });
  const componentesApi = useMemo(() => configuraciones.child(id, 'componentes'), [id]);
  const [spot, setSpot] = useState('');
  const empresa = empresasL.byId.get(c?.empresaId);
  const estrategia = estrategiasL.byId.get(c?.estrategiaId);

  const contratoOptions = contratosL.items
    .filter(k => k.activo !== false)
    .sort((a, b) => String(a.vencimiento).localeCompare(String(b.vencimiento)) || a.tipo.localeCompare(b.tipo) || a.strike - b.strike)
    .map(k => ({ value: k._id, label: contratoLabel(k) }));

  const fields = [
    { name: 'contratoId', label: 'Contrato', type: 'select', options: contratoOptions, required: true, wide: true, help: contratoOptions.length ? null : 'No hay contratos almacenados para esta empresa: sincroniza «contratos» en Mercado → Cadena de opciones.' },
    { name: 'accion', label: 'Acción', type: 'select', options: [{ value: 'buy', label: 'Compra (buy)' }, { value: 'sell', label: 'Venta (sell)' }], required: true },
    { name: 'cantidad', label: 'Cantidad', type: 'number', min: 1, step: 1, required: true, default: '1' },
    { name: 'proporcion', label: 'Proporción', type: 'number', min: 1, step: 1, required: true, default: '1', help: 'Relación de la pata dentro de la orden (normalmente 1).' },
  ];

  return (
    <>
      <PageHeader
        title={c ? c.nombre : 'Configuración'}
        subtitle={c ? `${empresaLabel(empresa) || '—'} · ${ESTRATEGIA_LABELS[estrategia?.codigo] || '—'}` : null}
        actions={<Link className="btn btn--sm" to="/configuracion/configuraciones">Volver</Link>}
      />
      {config.loading && !c && <Loading />}
      <ErrorMessage error={config.error} onRetry={config.reload} />
      {c && (
        <>
          <section className="card">
            <div className="row-actions"><Badge value={c.estado} /> <span className="muted">Actualizada {fmtDateTime(c.updatedAt)}</span></div>
            {estrategia && EXPLICACIONES[estrategia.codigo] && (
              <p className="muted">Estructura esperada: {EXPLICACIONES[estrategia.codigo].patas}</p>
            )}
          </section>
          <SubdocEditor
            title="Componentes (patas)"
            api={componentesApi}
            fields={fields}
            onChanged={config.reload}
            createLabel="Agregar pata"
            readOnlyReason={c.estado !== 'borrador' ? `La configuración está «${c.estado}». Cámbiala a borrador (Editar en la lista) para modificar sus patas.` : null}
            columns={[
              { key: 'contrato', label: 'Contrato', render: r => contratoLabel(contratosL.byId.get(r.contratoId)) || <span className="muted">{r.contratoId}</span> },
              { key: 'accion', label: 'Acción', render: r => <Badge value={r.accion} tone={r.accion === 'buy' ? 'success' : 'danger'}>{r.accion === 'buy' ? 'Compra' : 'Venta'}</Badge> },
              { key: 'cantidad', label: 'Cantidad', align: 'right' },
              { key: 'proporcion', label: 'Proporción', align: 'right', render: r => r.proporcion ?? 1 },
            ]}
          />
          <EvaluarConfiguracion configuracion={c} onSpotChange={setSpot} />
          <Payoff configuracion={c} contratosById={contratosL.byId} spot={spot} />
          {contratosL.error && <ErrorMessage error={contratosL.error} onRetry={contratosL.reload} title="No se pudieron cargar los contratos" />}
        </>
      )}
    </>
  );
}

