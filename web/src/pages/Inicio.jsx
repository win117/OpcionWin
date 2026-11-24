// Inicio: estado del mercado, buscador de empresas y screener (Top 5 por estrategia) sobre el universo precargado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ScoreBar } from '../components/Gauge';
import { Empty, ErrorMessage, Notice } from '../components/States';
import Buscador from './analizar/Buscador';
import { MercadoEstado } from '../components/MercadoEstado';
import { useAsync } from '../hooks/useAsync';
import { screener } from '../api/resources';
import { esNoDisponible } from '../api/client';
import { ESTRATEGIAS, ESTRATEGIA_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtInt, fmtMoney, fmtNum, fmtPct, isNum } from '../utils/format';

const NOMBRES_INDICE = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', IWM: 'Russell 2000', DIA: 'Dow Jones' };
const CLAVE_JOB = 'opciones.universo.job';
const SONDEO_MS = 2000;
const DESCRIPCION = {
  LONG_CALL: 'Compra de call: sesgo alcista y volatilidad razonable.',
  LONG_PUT: 'Compra de put: sesgo bajista y volatilidad razonable.',
  IRON_CONDOR: 'Rango lateral con volatilidad implícita elevada.',
};

function Cambio({ valor }) {
  if (!isNum(valor)) return <span className="muted">—</span>;
  const up = valor >= 0;
  return <span className={'inicio-change ' + (up ? 'up' : 'down')}>{up ? '▲' : '▼'} {fmtPct(Math.abs(valor), 2)}</span>;
}

/* ---------- Índices ---------- */
function Indices({ mercado }) {
  const { data, loading, error, reload } = mercado;
  const indices = data?.indices || [];
  return (
    <section className="inicio-sec" aria-label="Mercado hoy">
      <div className="inicio-sec__head">
        <h2>Mercado hoy</h2>
        <MercadoEstado estado={mercado} />
      </div>
      {error && !data ? <ErrorMessage error={error} onRetry={reload} title="No se pudo cargar el mercado" />
        : loading && !data ? <div className="inicio-grid inicio-grid--idx">{[0, 1, 2, 3].map(i => <div key={i} className="inicio-card"><span className="skel" style={{ height: 14, width: '60%' }} /><span className="skel" style={{ height: 22, width: '50%' }} /></div>)}</div>
        : indices.length === 0 ? <Empty title="Sin datos de índices">El servidor no devolvió cotizaciones de SPY, QQQ, IWM o DIA.</Empty> : (
          <div className="inicio-grid inicio-grid--idx">
            {indices.map(i => (
              <Link key={i.simbolo} to={'/analisis/' + i.simbolo} className="inicio-card">
                <span className="inicio-card__top"><strong>{i.nombre || NOMBRES_INDICE[i.simbolo] || i.simbolo}</strong><span className="muted small">{i.simbolo}</span></span>
                <span className="inicio-price">{isNum(i.precio) ? fmtMoney(i.precio) : '—'}</span>
                <Cambio valor={i.cambioPct} />
              </Link>
            ))}
          </div>
        )}
      {data?.fuente && <p className="muted small inicio-foot">Fuente: {typeof data.fuente === 'string' ? data.fuente : data.fuente.proveedor || 'Alpaca'}</p>}
    </section>
  );
}

/* ---------- Sincronización del universo ---------- */
function leerJob() { try { return sessionStorage.getItem(CLAVE_JOB) || null; } catch { return null; } }
function guardarJob(id) { try { if (id) sessionStorage.setItem(CLAVE_JOB, id); else sessionStorage.removeItem(CLAVE_JOB); } catch { /* sin almacenamiento */ } }

/** Lanza y sondea la sincronización del universo; retoma una en curso al volver a la página. */
function useSincronizacionUniverso(onTerminada) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [lanzando, setLanzando] = useState(false);
  const vivo = useRef(true);
  const timer = useRef(null);
  const cb = useRef(onTerminada);
  cb.current = onTerminada;

  const sondear = useCallback(async id => {
    try {
      const j = await screener.sincronizacion(id);
      if (!vivo.current) return;
      setJob(j);
      if (['completada', 'fallida'].includes(j?.estado)) { guardarJob(null); cb.current?.(j); return; }
      timer.current = setTimeout(() => sondear(id), SONDEO_MS);
    } catch (e) {
      if (!vivo.current) return;
      guardarJob(null); setError(e);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    const id = leerJob();
    if (id) sondear(id);
    return () => { vivo.current = false; clearTimeout(timer.current); };
  }, [sondear]);

  const iniciar = async () => {
    setError(null); setLanzando(true);
    try {
      const j = await screener.sincronizarUniverso({ limite: 500 });
      setJob(j);
      if (j?._id) { guardarJob(j._id); sondear(j._id); }
    } catch (e) { setError(e); } finally { setLanzando(false); }
  };
  const activa = lanzando || (job && !['completada', 'fallida'].includes(job.estado));
  return { job, error, activa, iniciar };
}

function ProgresoUniverso({ job }) {
  const total = job?.total || 0, hechos = job?.procesados || 0;
  const pct = total ? Math.min(100, Math.round((100 * hechos) / total)) : 0;
  return (
    <div aria-live="polite">
      <div className="progress" role="progressbar" aria-label="Sincronización del universo" aria-valuemin={0} aria-valuemax={total || 100} aria-valuenow={hechos}>
        <div className="progress__fill" style={{ width: pct + '%' }} />
      </div>
      <p className="muted small">{total ? `${fmtInt(hechos)} de ${fmtInt(total)} empresas procesadas (${pct}%)` : 'Preparando la sincronización…'}{job?.fallidos ? ` · ${fmtInt(job.fallidos)} con error` : ''}</p>
    </div>
  );
}

/* ---------- Screener ---------- */
function Tarjeta({ codigo, items }) {
  return (
    <article className="card screener-card" aria-label={'Top 5 ' + ESTRATEGIA_LABELS[codigo]}>
      <h3>Top 5 {ESTRATEGIA_LABELS[codigo]}</h3>
      <p className="muted small">{DESCRIPCION[codigo]}</p>
      {items.length === 0 ? <p className="muted small">Sin empresas con puntaje para esta estrategia.</p> : (
        <ol className="screener-list">
          {items.map((it, i) => (
            <li key={it.simbolo}>
              <Link to={`/analisis/${encodeURIComponent(it.simbolo)}?estrategia=${codigo}`} className="screener-item"
                title={(it.factores || []).map(f => `${f.nombre}: ${isNum(f.valor) ? fmtNum(f.valor, 2) : f.valor} (${fmtNum(f.puntaje, 0)})`).join('\n') || undefined}>
                <span className="screener-item__rank" aria-hidden="true">{i + 1}</span>
                <span className="screener-item__main">
                  <span className="screener-item__top">
                    <strong className="ticker">{it.simbolo}</strong>
                    <span className="muted small inicio-trunc">{it.nombre}</span>
                  </span>
                  <span className="screener-item__px"><span>{fmtMoney(it.precio)}</span><Cambio valor={it.cambioPct} /></span>
                  <ScoreBar value={it.puntaje} label={'Puntaje de ' + it.simbolo} />
                  {it.resumen && <span className="muted small screener-item__sum">{it.resumen}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Screener() {
  const ranking = useAsync(() => screener.ranking({ limite: 5 }), []);
  const sync = useSincronizacionUniverso(() => ranking.reload());
  const d = ranking.data;
  const total = d?.universo?.total ?? 0;
  const actualizado = d?.universo?.actualizadoEn;
  const sinUniverso = d && total === 0;
  const noDisp = ranking.error && esNoDisponible(ranking.error);

  const boton = (
    <button type="button" className="btn btn--primary" onClick={sync.iniciar} disabled={sync.activa}>
      {sync.activa ? 'Actualizando universo…' : sinUniverso ? 'Cargar universo (~500 empresas)' : 'Actualizar universo'}
    </button>
  );

  return (
    <section className="inicio-sec" aria-label="Screener de estrategias">
      <div className="inicio-sec__head">
        <h2>Mejores empresas por estrategia</h2>
        <div className="screener-head">
          <span className="muted small">
            {d ? `Universo: ${fmtInt(total)} empresas · ${actualizado ? 'actualizado ' + fmtDateTime(actualizado) : 'sin fecha de actualización'}` : ''}
          </span>
          {boton}
        </div>
      </div>
      {sync.activa && <div className="card"><ProgresoUniverso job={sync.job} /></div>}
      {sync.job?.estado === 'fallida' && <ErrorMessage error={sync.job.error || 'La sincronización del universo falló.'} title="Sincronización fallida" />}
      {sync.job?.estado === 'completada' && !sync.activa && <Notice tone="success">Universo actualizado: {fmtInt(sync.job.procesados)} empresas procesadas{sync.job.fallidos ? `, ${fmtInt(sync.job.fallidos)} con error` : ''}.</Notice>}
      {sync.error && <ErrorMessage error={sync.error} title="No se pudo sincronizar el universo" />}
      {noDisp && <Notice tone="warning" title="Screener no disponible todavía.">El servidor aún no ofrece el ranking del universo. Cuando esté habilitado aparecerán aquí las 5 mejores empresas por estrategia.</Notice>}
      {ranking.error && !d && !noDisp && <ErrorMessage error={ranking.error} onRetry={ranking.reload} title="No se pudo cargar el ranking" />}
      {ranking.loading && !d && <div className="screener-grid">{ESTRATEGIAS.map(c => <div key={c} className="card"><span className="skel" style={{ height: 18, width: '50%' }} /><span className="skel" style={{ height: 120 }} /></div>)}</div>}
      {sinUniverso && !sync.activa && (
        <Empty title="El universo aún no se ha sincronizado">
          Pulsa «Cargar universo» para descargar y puntuar ~500 empresas. Tarda unos minutos; verás el avance y después el Top 5 de cada estrategia.
        </Empty>
      )}
      {d && !sinUniverso && (
        <div className="screener-grid">
          {ESTRATEGIAS.map(c => <Tarjeta key={c} codigo={c} items={d.estrategias?.[c] || []} />)}
        </div>
      )}
      <p className="muted small">Ranking informativo y educativo, calculado con datos del proveedor; no es una recomendación de inversión.</p>
    </section>
  );
}

export default function Inicio() {
  const { mercado } = useOutletContext();
  const navigate = useNavigate();
  return (
    <div className="inicio">
      <PageHeader title="Inicio" subtitle="Mira el mercado, descubre las mejores empresas por estrategia o busca una para analizarla." />
      <Indices mercado={mercado} />
      <Screener />
      <section className="inicio-sec" aria-label="Buscar empresa">
        <Buscador seleccionado="" version={0} onSelect={s => navigate('/analisis/' + encodeURIComponent(s))} />
      </section>
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
