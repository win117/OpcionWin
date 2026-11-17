// Flujo de un clic: sincroniza datos reales → ejecuta los cores → selección de estrategia → resumen visual.
// Reutiliza los endpoints de acción (202 + sondeo); no agrega lógica de negocio en el navegador.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { CandleChart } from '../components/CandleChart';
import { DirectionalGauge, ScoreBar, direccion } from '../components/Gauge';
import { Badge } from '../components/Badge';
import { Empty, ErrorMessage, Loading } from '../components/States';
import { useAsync } from '../hooks/useAsync';
import { api } from '../api/client';
import { acciones, empresas, estrategias, evaluaciones, jobPaths, listLatest, mercado, noticias, selecciones } from '../api/resources';
import { toCandles } from './mercado/GraficoTab';
import { CORES, CORE_LABELS, CORE_DESCRIPCION, ESTRATEGIA_LABELS, RECURSO_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtCompact, fmtDateTime, fmtMoney, fmtNum, fmtPct, isNum } from '../utils/format';
import { metrica } from '../utils/objects';

const RECURSOS = ['historicos', 'cotizaciones', 'noticias', 'fundamentales', 'contratos'];
const ESPERA_MS = 1500;
const pausa = ms => new Promise(r => setTimeout(r, ms));

async function esperar(path, cancelado) {
  for (;;) {
    const d = await api.get(path);
    if (['completada', 'fallida'].includes(d?.estado)) return d;
    if (cancelado()) throw new Error('Cancelado');
    await pausa(ESPERA_MS);
  }
}

/** Ejecuta la canalización completa y reporta cada paso con setPasos. */
async function ejecutarFlujo(simbolo, { institucional }, setPasos, cancelado) {
  const set = (id, cambios) => setPasos(p => p.map(x => (x.id === id ? { ...x, ...cambios } : x)));
  const paso = async (id, lanzar, ruta) => {
    set(id, { estado: 'procesando' });
    const t0 = Date.now();
    try {
      const r = await lanzar();
      const fin = await esperar(ruta(r), cancelado);
      const detalle = fin.procesados != null ? fmtNum(fin.procesados, 0) + ' registros' : isNum(fin.puntaje) ? 'puntaje ' + fmtNum(fin.puntaje, 0) : '';
      set(id, { estado: fin.estado, detalle, error: fin.error, ms: Date.now() - t0 });
      return fin;
    } catch (error) {
      set(id, { estado: 'fallida', error: error.message, ms: Date.now() - t0 });
      return null;
    }
  };
  const sync = recurso => paso('sync:' + recurso, () => acciones.sincronizar({ recurso, simbolos: [simbolo] }), r => jobPaths.sincronizacion(r._id));

  const emp = await sync('empresas');
  if (emp?.estado !== 'completada') throw new Error(emp?.error || 'No se pudo registrar el símbolo (¿existe en Alpaca?).');
  const recursos = [...RECURSOS, ...(institucional ? ['institucional'] : [])];
  const syncs = await Promise.all(recursos.map(sync));

  const empresa = (await empresas.list({ simbolo, limit: 1 })).items[0];
  if (!empresa) throw new Error('Empresa no encontrada tras sincronizar.');
  // Core institucional solo si hay reportes 13F (sincronizados ahora o antes); si no, reduciría la cobertura sin aportar.
  const hay13F = syncs.at(-1)?.procesados > 0 && institucional
    || (await mercado.institucional(simbolo, { limit: 1 }).catch(() => null))?.total > 0;
  const cores = CORES.filter(c => c !== 'institucional' || hay13F);
  setPasos(p => p.map(x => (x.id === 'core:institucional' && !hay13F ? { ...x, estado: 'omitida', detalle: 'sin datos 13F' } : x)));
  await Promise.all(cores.map(core => paso('core:' + core, () => acciones.evaluarCore(core, { empresaId: empresa._id }), r => jobPaths.evaluacionCore(core, r._id))));

  await paso('seleccion', () => acciones.seleccionar({ modo: 'empresa', empresaId: empresa._id, coresSeleccionados: cores }), r => jobPaths.seleccion(r._id));
}

function pasosIniciales(institucional) {
  return [
    { id: 'sync:empresas', grupo: 'Datos', label: 'Empresa (Alpaca + SEC)' },
    ...[...RECURSOS, ...(institucional ? ['institucional'] : [])].map(r => ({ id: 'sync:' + r, grupo: 'Datos', label: RECURSO_LABELS[r] })),
    ...CORES.map(c => ({ id: 'core:' + c, grupo: 'Cores', label: CORE_LABELS[c] })),
    { id: 'seleccion', grupo: 'Selección', label: 'Compatibilidad por estrategia' },
  ].map(p => ({ ...p, estado: 'pendiente' }));
}

function Progreso({ pasos }) {
  const hechos = pasos.filter(p => ['completada', 'fallida', 'omitida'].includes(p.estado)).length;
  return (
    <section className="card">
      <div className="card__header">
        <h2>Progreso</h2>
        <span className="muted">{hechos}/{pasos.length} pasos</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={hechos}>
        <div className="progress__fill" style={{ width: (100 * hechos / pasos.length) + '%' }} />
      </div>
      <ol className="pipeline">
        {pasos.map(p => (
          <li key={p.id} className={'pipeline__step is-' + p.estado}>
            <span className="pipeline__dot" aria-hidden="true" />
            <span className="pipeline__label"><small className="muted">{p.grupo}</small> {p.label}</span>
            <span className="pipeline__meta muted">
              {p.detalle}{p.ms != null ? ' · ' + (p.ms / 1000).toFixed(1) + ' s' : ''}
            </span>
            <Badge value={p.estado === 'omitida' ? undefined : p.estado} tone={p.estado === 'omitida' ? 'neutral' : undefined}>{p.estado === 'omitida' ? 'omitido' : undefined}</Badge>
            {p.error && <span className="pipeline__error">{p.error}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Encabezado({ empresa, velas, cotizacion }) {
  const last = velas.at(-1), prev = velas.at(-2);
  const precio = cotizacion?.ultimo ?? last?.close;
  const cambio = last && prev ? (last.close - prev.close) / prev.close : null;
  const ult52 = velas.slice(-252);
  return (
    <section className="card">
      <div className="card__header">
        <div>
          <h2 className="ticker">{empresa.simbolo} <span className="muted ticker__name">{empresa.nombre}</span></h2>
          <p className="muted small">{empresa.mercado}{empresa.cik ? ' · CIK ' + empresa.cik : ''}</p>
        </div>
        <div className="price">
          <span className="price__value">{fmtMoney(precio)}</span>
          {isNum(cambio) && <span className={'price__chg ' + (cambio >= 0 ? 'up' : 'down')}>{cambio >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(cambio), 2)}</span>}
        </div>
      </div>
      {velas.length > 0 && (
        <dl className="stats stats--row">
          <div><dt>Rango 52 semanas</dt><dd>{fmtMoney(Math.min(...ult52.map(v => v.low)))} – {fmtMoney(Math.max(...ult52.map(v => v.high)))}</dd></div>
          <div><dt>Volumen último</dt><dd>{fmtCompact(last.volume)}</dd></div>
          <div><dt>Bid / Ask</dt><dd>{cotizacion?.bid != null ? fmtMoney(cotizacion.bid) + ' / ' + fmtMoney(cotizacion.ask) : '—'}</dd></div>
          <div><dt>Datos al</dt><dd>{fmtDateTime(cotizacion?.fuente?.fechaDato || last.row.fuente?.fechaDato)}</dd></div>
        </dl>
      )}
    </section>
  );
}

function Recomendacion({ seleccion, estrategiasById }) {
  if (!seleccion) return <Empty title="Sin selección">Pulsa «Analizar» para calcular la compatibilidad por estrategia.</Empty>;
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
            <div className="ranking__head">
              <span><strong>#{i + 1}</strong> {ESTRATEGIA_LABELS[codigo(r)] || codigo(r)}</span>
            </div>
            <ScoreBar value={r.puntaje} />
            {r.motivos?.length > 0 && (
              <details className="details"><summary>Motivos</summary><ul className="list list--compact">{r.motivos.map((m, j) => <li key={j}>{m}</li>)}</ul></details>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Calculada {fmtDateTime(seleccion.createdAt)} con: {(seleccion.coresSeleccionados || []).map(c => CORE_LABELS[c]).join(', ')}.</p>
    </div>
  );
}

function CoreCard({ core, evaluacion }) {
  const e = evaluacion;
  const confianza = metrica(e?.metricas, 'confianza');
  const dir = direccion(e?.puntaje);
  return (
    <article className="card core-card">
      <div className="card__header">
        <div>
          <h3>{CORE_LABELS[core]}</h3>
          <p className="muted small">{CORE_DESCRIPCION[core]}</p>
        </div>
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

function Noticias({ items }) {
  if (!items.length) return <p className="muted">Sin noticias recientes almacenadas.</p>;
  return (
    <ul className="news">
      {items.map(n => (
        <li key={n._id}>
          <a href={n.url} target="_blank" rel="noopener noreferrer">{n.titulo}</a>
          <span className="muted small"> · {n.proveedor} · {fmtDateTime(n.publicadaEn)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Resumen guardado del símbolo (no consulta proveedores; solo la base de la sesión). */
function useResumen(simbolo, version) {
  return useAsync(async () => {
    const empresa = (await empresas.list({ simbolo, limit: 1 })).items[0];
    if (!empresa) return { empresa: null };
    const [hist, cot, evals, sel, est, news] = await Promise.all([
      mercado.historicos(simbolo, { limit: 300 }).catch(() => ({ items: [] })),
      mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] })),
      Promise.all(CORES.map(core => evaluaciones.list({ empresaId: empresa._id, core, estado: 'completada', limit: 1 }).then(r => [core, r.items[0]]))),
      selecciones.list({ empresaId: empresa._id, modo: 'empresa', estado: 'completada', limit: 1 }),
      estrategias.list({ limit: 100 }),
      listLatest(noticias, {}, { dateOf: n => n.publicadaEn, maxPages: 5 }).catch(() => ({ items: [] })),
    ]);
    return {
      empresa,
      velas: toCandles(hist.items || []),
      cotizacion: cot.items?.at(-1),
      evaluaciones: Object.fromEntries(evals),
      seleccion: sel.items[0],
      estrategiasById: new Map(est.items.map(e => [e._id, e])),
      noticias: news.items.filter(n => n.simbolos?.includes(simbolo)).slice(0, 6),
    };
  }, [simbolo, version]);
}

function Resumen({ simbolo, version }) {
  const state = useResumen(simbolo, version);
  const d = state.data;
  if (state.loading && !d) return <Loading text={'Cargando ' + simbolo + '…'} />;
  if (state.error) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (!d?.empresa) return <Empty title={simbolo + ' aún no está analizado'}>Pulsa «Analizar» para traer sus datos reales y evaluarlo.</Empty>;
  return (
    <div className="stack">
      <Encabezado empresa={d.empresa} velas={d.velas} cotizacion={d.cotizacion} />
      <div className="grid grid--main">
        <section className="card">
          <div className="card__header">
            <h2>Precio diario</h2>
            <Link to={'/mercado/' + simbolo} className="btn btn--sm btn--ghost">Ver mercado completo →</Link>
          </div>
          {d.velas.length ? <CandleChart velas={d.velas} /> : <p className="muted">Sin velas almacenadas.</p>}
          <p className="muted small">Alpaca · feed IEX · {d.velas.length} sesiones</p>
        </section>
        <section className="card">
          <h2>Recomendación</h2>
          <Recomendacion seleccion={d.seleccion} estrategiasById={d.estrategiasById} />
        </section>
      </div>
      <h2 className="section-title">Cores de análisis</h2>
      <div className="grid grid--cores">
        {CORES.map(core => <CoreCard key={core} core={core} evaluacion={d.evaluaciones[core]} />)}
      </div>
      <section className="card">
        <div className="card__header">
          <h2>Noticias recientes</h2>
          <Link to={'/mercado/' + simbolo} className="btn btn--sm btn--ghost">Fundamentales, 13F y opciones →</Link>
        </div>
        <Noticias items={d.noticias} />
      </section>
    </div>
  );
}

export default function Analizar() {
  const { simbolo: param } = useParams();
  const simbolo = (param || '').toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const [texto, setTexto] = useState(simbolo);
  const [institucional, setInstitucional] = useState(false);
  const [pasos, setPasos] = useState(null);
  const [error, setError] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [version, setVersion] = useState(0);
  const cancel = useRef(false);
  const lista = useAsync(() => empresas.list({ limit: 100 }), [version]);

  useEffect(() => { setTexto(simbolo); setPasos(null); setError(null); }, [simbolo]);
  useEffect(() => () => { cancel.current = true; }, []);

  const analizar = useCallback(async (sym, conInst) => {
    cancel.current = false;
    setError(null); setCorriendo(true);
    setPasos(pasosIniciales(conInst));
    try { await ejecutarFlujo(sym, { institucional: conInst }, setPasos, () => cancel.current); }
    catch (e) { if (!cancel.current) setError(e); }
    finally { if (!cancel.current) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);

  // Llegada desde el Panel con «Analizar»: se ejecuta de inmediato.
  useEffect(() => {
    if (simbolo && location.state?.ejecutar) {
      const conInst = Boolean(location.state.institucional);
      setInstitucional(conInst);
      navigate(location.pathname, { replace: true, state: null });
      analizar(simbolo, conInst);
    }
  }, [simbolo]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = event => {
    event.preventDefault();
    const sym = texto.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) { setError(new Error('Símbolo inválido. Ejemplo: AAPL, MSFT, SPY.')); return; }
    if (sym === simbolo) analizar(sym, institucional);
    else navigate('/analizar/' + sym, { state: { ejecutar: true, institucional } });
  };

  const empresasGuardadas = useMemo(() => lista.data?.items || [], [lista.data]);

  return (
    <>
      <PageHeader title={simbolo ? 'Análisis · ' + simbolo : 'Analizar símbolo'} subtitle="Datos reales (Alpaca y SEC) → 5 cores → estrategia más compatible" />
      <section className="card">
        <form className="search" onSubmit={submit}>
          <label className="sr-only" htmlFor="simbolo">Símbolo</label>
          <input id="simbolo" className="search__input" value={texto} onChange={e => setTexto(e.target.value.toUpperCase())} placeholder="Símbolo (AAPL, MSFT, NVDA…)" autoComplete="off" disabled={corriendo} />
          <button type="submit" className="btn btn--primary" disabled={corriendo || !texto.trim()}>{corriendo ? 'Analizando…' : 'Analizar'}</button>
          <label className="check">
            <input type="checkbox" checked={institucional} onChange={e => setInstitucional(e.target.checked)} disabled={corriendo} />
            <span>Incluir 13F institucional <small className="muted">(lento: 1–3 min)</small></span>
          </label>
        </form>
        {empresasGuardadas.length > 0 && (
          <div className="chips" aria-label="Empresas analizadas">
            {empresasGuardadas.map(e => (
              <Link key={e._id} to={'/analizar/' + e.simbolo} className={'chip' + (e.simbolo === simbolo ? ' is-active' : '')}>{e.simbolo}</Link>
            ))}
          </div>
        )}
      </section>
      {error && <ErrorMessage error={error} title="El análisis no pudo completarse" />}
      {pasos && <Progreso pasos={pasos} />}
      {simbolo
        ? <Resumen simbolo={simbolo} version={version} />
        : <Empty title="Escribe un símbolo y pulsa «Analizar»">Se traerán velas, cotización, noticias, fundamentales SEC y contratos de opciones; se evaluarán los 5 cores y se ordenarán Long Call, Long Put e Iron Condor por compatibilidad.</Empty>}
      <p className="disclaimer">{DISCLAIMER}</p>
    </>
  );
}
