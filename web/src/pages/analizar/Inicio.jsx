// Panel de inicio de «Buscar y analizar»: mercado, empresas registradas, exploración y actividad.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import CarteraPaper from './CarteraPaper';
import Sparkline from '../../components/Sparkline';
import { Badge } from '../../components/Badge';
import { ErrorMessage } from '../../components/States';
import { ScoreBar, direccion } from '../../components/Gauge';
import { useAsync } from '../../hooks/useAsync';
import { empresas, estrategias, evaluaciones, mercado, selecciones, sincronizaciones, listLatest } from '../../api/resources';
import { CORES, CORE_LABELS, ESTRATEGIA_LABELS } from '../../utils/constants';
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, isNum } from '../../utils/format';

const INDICES = ['SPY', 'QQQ', 'DIA', 'IWM'];
const NOMBRES = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', DIA: 'Dow Jones', IWM: 'Russell 2000' };
const SUGERENCIAS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'SPY'];
const PASOS = ['Buscar la empresa', 'Ver sus datos', 'Elegir cores y métricas', 'Analizar'];
const MAX_EMPRESAS = 12;

// Limitador de concurrencia para no saturar la API con decenas de peticiones a la vez.
const MAX_CONC = 4;
let activas = 0;
const cola = [];
function limitado(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activas++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { activas--; const n = cola.shift(); if (n) n(); });
    };
    if (activas < MAX_CONC) run(); else cola.push(run);
  });
}

function Cambio({ valor }) {
  if (!isNum(valor)) return <span className="muted">—</span>;
  const up = valor >= 0;
  return <span className={'inicio-change ' + (up ? 'up' : 'down')}>{up ? '▲' : '▼'} {fmtPct(Math.abs(valor), 2)}</span>;
}

function Skeleton({ h = 14, w = '100%' }) {
  return <span className="skel" style={{ height: h, width: w }} aria-hidden="true" />;
}

function Seccion({ titulo, extra, children }) {
  return (
    <section className="inicio-sec" aria-label={titulo}>
      <div className="inicio-sec__head"><h2>{titulo}</h2>{extra}</div>
      {children}
    </section>
  );
}

function Mercado() {
  const st = useAsync(() => mercado.panorama({ simbolos: INDICES.join(',') }), []);
  const items = st.data?.items || [];
  const fecha = items.map(i => i.fechaDato).filter(Boolean).sort().pop();
  return (
    <Seccion titulo="Mercado hoy">
      {st.error && !st.data ? <ErrorMessage error={st.error} onRetry={st.reload} title="No se pudo cargar el mercado" /> : (
        <div className="inicio-grid inicio-grid--idx">
          {st.loading && !st.data
            ? INDICES.map(s => <div key={s} className="inicio-card"><Skeleton w="60%" /><Skeleton h={22} w="50%" /><Skeleton h={36} /></div>)
            : INDICES.map(s => {
              const it = items.find(i => i.simbolo === s) || { simbolo: s };
              const sinDatos = it.error || !isNum(it.ultimo);
              return (
                <Link key={s} to={'/analizar/' + s} className="inicio-card">
                  <span className="inicio-card__top"><strong>{it.nombre || NOMBRES[s]}</strong><span className="muted small">{s}</span></span>
                  {sinDatos ? <span className="muted inicio-nodata">Sin datos</span> : (
                    <>
                      <span className="inicio-price">{fmtMoney(it.ultimo)}</span>
                      <Cambio valor={it.cambioPct} />
                      <Sparkline values={(it.cierres || []).map(c => c.cierre)} label={NOMBRES[s]} />
                    </>
                  )}
                </Link>
              );
            })}
        </div>
      )}
      {st.data && <p className="muted small inicio-foot">Alpaca · feed {st.data.fuente?.feed || 'IEX'}{fecha ? ' · actualizado ' + fmtDate(fecha) : ''}</p>}
    </Seccion>
  );
}

function ultimoCambio(velas) {
  const c = velas.map(v => v.cierre).filter(isNum);
  if (!c.length) return { cierres: [], ultimo: null, cambio: null };
  const ultimo = c[c.length - 1];
  const prev = c.length > 1 ? c[c.length - 2] : null;
  return { cierres: c, ultimo, cambio: prev ? ultimo / prev - 1 : null };
}

function EmpresaCard({ empresa, estrategiaCodigo }) {
  const st = useAsync(async () => {
    const [h, sel, ...evs] = await Promise.allSettled([
      limitado(() => mercado.historicos(empresa.simbolo, { limit: 60 })),
      limitado(() => selecciones.list({ empresaId: empresa._id, modo: 'empresa', estado: 'completada', limit: 1 })),
      ...CORES.map(core => limitado(() => evaluaciones.list({ empresaId: empresa._id, core, estado: 'completada', limit: 1 }))),
    ]);
    const velas = h.status === 'fulfilled' ? (Array.isArray(h.value) ? h.value : h.value?.items || h.value?.velas || h.value?.data || []) : [];
    return {
      velas,
      sel: sel.status === 'fulfilled' ? sel.value?.items?.[0] : null,
      evs: CORES.map((core, i) => ({ core, ev: evs[i].status === 'fulfilled' ? evs[i].value?.items?.[0] : null })),
    };
  }, [empresa._id]);
  const d = st.data;
  const { cierres, ultimo, cambio } = ultimoCambio(d?.velas || []);
  const top = d?.sel?.resultados?.length ? [...d.sel.resultados].sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0))[0] : null;
  const cod = top ? estrategiaCodigo(top.estrategiaId) : null;
  return (
    <Link to={'/analizar/' + empresa.simbolo} className="inicio-card">
      <span className="inicio-card__top"><strong className="ticker">{empresa.simbolo}</strong><span className="muted small inicio-trunc">{empresa.nombre}</span></span>
      {st.loading && !d ? <><Skeleton h={22} w="50%" /><Skeleton h={36} /><Skeleton w="70%" /></> : (
        <>
          <span className="inicio-row">
            <span className="inicio-price">{isNum(ultimo) ? fmtMoney(ultimo) : '—'}</span>
            <Cambio valor={cambio} />
          </span>
          <Sparkline values={cierres} label={empresa.simbolo} />
          {top ? (
            <span className="inicio-rec">
              <span className="small"><strong>{ESTRATEGIA_LABELS[cod] || cod || 'Estrategia'}</strong> <span className="muted">· {fmtDateTime(d.sel.createdAt)}</span></span>
              <ScoreBar value={top.puntaje} />
            </span>
          ) : <span className="muted small">Sin análisis — haz clic para analizar</span>}
          <span className="chips inicio-dirs">
            {d.evs.filter(e => e.ev).map(({ core, ev }) => {
              const dir = direccion(ev.puntaje);
              return <span key={core} className="inicio-dir" title={`${CORE_LABELS[core]}: ${dir.texto}`}>{CORE_LABELS[core]} <span className={'dir dir--' + dir.tono}>{dir.texto}</span></span>;
            })}
          </span>
        </>
      )}
    </Link>
  );
}

function TusEmpresas() {
  const emp = useAsync(() => empresas.list({ limit: 100 }), []);
  const est = useAsync(() => estrategias.list({ limit: 100 }), []);
  const mapa = useMemo(() => new Map((est.data?.items || []).map(e => [e._id, e.codigo])), [est.data]);
  const lista = emp.data?.items || [];
  const total = emp.data?.total ?? lista.length;
  return (
    <Seccion titulo="Tus empresas" extra={total > MAX_EMPRESAS ? <Link to="/empresas" className="small">Ver todas ({total})</Link> : null}>
      {emp.error && !emp.data ? <ErrorMessage error={emp.error} onRetry={emp.reload} title="No se pudieron cargar tus empresas" />
        : emp.loading && !emp.data ? <div className="inicio-grid inicio-grid--emp">{[0, 1, 2].map(i => <div key={i} className="inicio-card"><Skeleton w="40%" /><Skeleton h={22} w="50%" /><Skeleton h={36} /></div>)}</div>
        : lista.length === 0 ? (
          <div className="inicio-card inicio-vacio">
            <strong>Aún no tienes empresas registradas</strong>
            <span className="muted small">Busca un símbolo a la izquierda o prueba con una sugerencia: se registrará y sincronizará automáticamente.</span>
            <span className="chips">{SUGERENCIAS.slice(0, 5).map(s => <Link key={s} to={'/analizar/' + s} className="chip">{s}</Link>)}</span>
          </div>
        ) : (
          <div className="inicio-grid inicio-grid--emp">
            {lista.slice(0, MAX_EMPRESAS).map(e => <EmpresaCard key={e._id} empresa={e} estrategiaCodigo={id => mapa.get(id)} />)}
          </div>
        )}
    </Seccion>
  );
}

function Explora() {
  return (
    <Seccion titulo="Explora">
      <div className="inicio-card">
        <div className="chips">{SUGERENCIAS.map(s => <Link key={s} to={'/analizar/' + s} className="chip">{s}</Link>)}</div>
        <ol className="inicio-pasos" aria-label="Cómo funciona">
          {PASOS.map((p, i) => <li key={p}><span className="inicio-pasos__n">{i + 1}</span>{p}</li>)}
        </ol>
      </div>
    </Seccion>
  );
}

function Actividad() {
  const st = useAsync(async () => {
    const [ev, sy, em] = await Promise.all([
      listLatest(evaluaciones, {}, { limit: 6, maxPages: 3 }),
      listLatest(sincronizaciones, {}, { limit: 6, maxPages: 3 }),
      empresas.list({ limit: 100 }).catch(() => ({ items: [] })),
    ]);
    const m = new Map((em.items || []).map(e => [e._id, e.simbolo]));
    return [
      ...ev.items.map(r => ({ id: r._id, tipo: 'eval', estado: r.estado, fecha: r.createdAt, etiqueta: 'Evaluación ' + (CORE_LABELS[r.core] || r.core), simbolo: m.get(r.empresaId) || '' })),
      ...sy.items.map(r => ({ id: r._id, tipo: 'sync', estado: r.estado, fecha: r.createdAt, etiqueta: 'Sincronización ' + (r.recurso || ''), simbolo: (r.simbolos || []).join(', ') })),
    ].sort((a, b) => (Date.parse(b.fecha) || 0) - (Date.parse(a.fecha) || 0)).slice(0, 6);
  }, []);
  return (
    <Seccion titulo="Actividad reciente">
      {st.error && !st.data ? <ErrorMessage error={st.error} onRetry={st.reload} title="No se pudo cargar la actividad" />
        : st.loading && !st.data ? <div className="inicio-card"><Skeleton /><Skeleton w="80%" /><Skeleton w="90%" /></div>
        : !st.data?.length ? <div className="inicio-card muted small">Aún no hay actividad.</div> : (
          <ul className="inicio-act inicio-card">
            {st.data.map(a => (
              <li key={a.tipo + a.id}>
                <Badge value={a.estado} />
                <span className="inicio-act__txt">{a.etiqueta}{a.simbolo && <> · <strong>{a.simbolo}</strong></>}</span>
                <span className="muted small">{fmtDateTime(a.fecha)}</span>
              </li>
            ))}
          </ul>
        )}
    </Seccion>
  );
}

export default function Inicio() {
  return (
    <div className="inicio">
      <CarteraPaper />
      <Mercado />
      <TusEmpresas />
      <Explora />
      <Actividad />
    </div>
  );
}
