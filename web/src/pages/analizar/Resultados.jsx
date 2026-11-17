// Pestaña «Último análisis»: recomendación por estrategia + tarjetas de cada core.
import { DirectionalGauge, ScoreBar, direccion } from '../../components/Gauge';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { estrategias, evaluaciones, selecciones } from '../../api/resources';
import { CORES, CORE_LABELS, CORE_DESCRIPCION, ESTRATEGIA_LABELS } from '../../utils/constants';
import { fmtDateTime, fmtNum, fmtPct, isNum } from '../../utils/format';
import { metrica } from '../../utils/objects';

function Recomendacion({ seleccion, estrategiasById }) {
  if (!seleccion) return <Empty title="Sin selección">Configura y pulsa «Analizar con esta configuración».</Empty>;
  const rows = [...(seleccion.resultados || [])].sort((a, b) => b.puntaje - a.puntaje);
  const top = rows[0];
  const codigo = r => estrategiasById.get(r.estrategiaId)?.codigo;
  return (
    <div className="stack">
      {top && (
        <div className="reco">
          <span className="muted small">Estrategia más compatible</span>
          <strong className="reco__name">{ESTRATEGIA_LABELS[codigo(top)] || codigo(top) || '—'}</strong>
          <span className="muted small">Compatibilidad {fmtNum(top.puntaje, 0)}/100 · cobertura {fmtPct(top.cobertura)}</span>
        </div>
      )}
      <ul className="ranking">
        {rows.map((r, i) => (
          <li key={r._id || i}>
            <div className="ranking__head"><span><strong>#{i + 1}</strong> {ESTRATEGIA_LABELS[codigo(r)] || codigo(r)}</span></div>
            <ScoreBar value={r.puntaje} />
            {r.motivos?.length > 0 && <details className="details"><summary>Motivos</summary><ul className="list list--compact">{r.motivos.map((m, j) => <li key={j}>{m}</li>)}</ul></details>}
          </li>
        ))}
      </ul>
      <p className="muted small">Calculada {fmtDateTime(seleccion.createdAt)} con: {(seleccion.coresSeleccionados || []).map(c => CORE_LABELS[c]).join(', ')}.</p>
    </div>
  );
}

function CoreCard({ core, evaluacion: e }) {
  const confianza = metrica(e?.metricas, 'confianza');
  const dir = direccion(e?.puntaje);
  return (
    <article className="card core-card">
      <div className="card__header">
        <div><h3>{CORE_LABELS[core]}</h3><p className="muted small">{CORE_DESCRIPCION[core]}</p></div>
        {e && <span className={'dir dir--' + dir.tono}>{dir.texto}</span>}
      </div>
      {!e ? <p className="muted">Sin evaluación todavía.</p> : (
        <>
          <DirectionalGauge puntaje={e.puntaje} size={180} />
          <dl className="stats">
            <div><dt>Confianza</dt><dd>{isNum(confianza) ? fmtPct(confianza) : '—'}</dd></div>
            <div><dt>Cobertura</dt><dd>{fmtPct(e.cobertura)}</dd></div>
          </dl>
          {e.motivos?.length > 0 && <ul className="list list--compact">{e.motivos.slice(0, 4).map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {e.datosFaltantes?.length > 0 && <p className="small muted">Faltan: {e.datosFaltantes.join(', ')}</p>}
          <p className="small muted">{fmtDateTime(e.finalizadaEn || e.createdAt)} · <code>{e.versionAlgoritmo}</code></p>
        </>
      )}
    </article>
  );
}

export default function Resultados({ empresa, version }) {
  const state = useAsync(async () => {
    const [evals, sel, est] = await Promise.all([
      Promise.all(CORES.map(core => evaluaciones.list({ empresaId: empresa._id, core, estado: 'completada', limit: 1 }).then(r => [core, r.items[0]]))),
      selecciones.list({ empresaId: empresa._id, modo: 'empresa', estado: 'completada', limit: 1 }),
      estrategias.list({ limit: 100 }),
    ]);
    return { evaluaciones: Object.fromEntries(evals), seleccion: sel.items[0], estrategiasById: new Map(est.items.map(e => [e._id, e])) };
  }, [empresa._id, version]);
  const d = state.data;
  if (state.loading && !d) return <Loading text="Cargando último análisis…" />;
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (!d) return null;
  return (
    <div className="stack">
      <section className="card"><h3>Recomendación</h3><Recomendacion seleccion={d.seleccion} estrategiasById={d.estrategiasById} /></section>
      <div className="grid grid--cores">{CORES.map(core => <CoreCard key={core} core={core} evaluacion={d.evaluaciones[core]} />)}</div>
    </div>
  );
}
