// Inicio: franja de índices, mapa del mercado en vivo, movimientos del día y las 5 mejores por estrategia (automático).
import { Link, useOutletContext } from 'react-router-dom';
import { ScoreBar } from '../components/Gauge';
import { Empty, ErrorMessage, Notice } from '../components/States';
import { Termino } from '../components/Termino';
import Movimientos from '../components/Movimientos';
import MapaMercado from './mercado/MapaMercado';
import { useSondeo } from '../hooks/useSondeo';
import { screener } from '../api/resources';
import { CORE_LABELS, ESTRATEGIAS, ESTRATEGIA_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtInt, fmtMoney, fmtNum, fmtPct, isNum } from '../utils/format';

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

/* ---------- Índices: son fondos (ETF) que los siguen; el nombre llega del proveedor ---------- */
function Indices({ mercado }) {
  const { data, loading, error, reload } = mercado;
  const indices = data?.indices || [];
  if (error && !data) return <div className="indices"><ErrorMessage error={error} onRetry={reload} title="No se pudo cargar el mercado" /></div>;
  if (!loading && !indices.length) return <div className="indices"><Empty title="Sin datos de índices" accion={<button type="button" className="btn btn--sm" onClick={reload}>Reintentar</button>} /></div>;
  return (
    <ul className="indices" aria-label="Fondos que siguen a los índices del mercado">
      {(indices.length ? indices : [0, 1, 2, 3]).map(i => (
        <li key={i.simbolo || i}>
          {i.simbolo ? (
            <Link to={'/analisis/' + encodeURIComponent(i.simbolo)} className="indice">
              <span className="indice__sym">{i.simbolo}</span>
              <span className="indice__px">{fmtMoney(i.precio)}</span>
              <span className="indice__nom">{i.nombre && i.nombre !== i.simbolo ? i.nombre : 'Fondo que sigue un índice'}</span>
              <Cambio valor={i.cambioPct} />
            </Link>
          ) : <span className="indice"><span className="skel" /><span className="skel" /></span>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Mejores por estrategia ---------- */
const ESTADO_CORE = { ok: 'opinó', sin_datos: 'sin datos', pendiente: 'pendiente' };
/** Los cinco factores de una empresa: lleno = opinó, hueco = sin datos, punteado = aún no se evalúa. */
function Factores({ cores }) {
  const opinan = cores.filter(c => c.estado === 'ok').length, pendientes = cores.filter(c => c.estado === 'pendiente').length;
  return (
    <span className="factores small" title={cores.map(c => `${CORE_LABELS[c.core]}: ${c.estado === 'ok' ? fmtNum(c.puntaje, 0) + ' de 100' : ESTADO_CORE[c.estado]}`).join('\n')}>
      <span className="factores__puntos" aria-hidden="true">{cores.map(c => <i key={c.core} className={'is-' + c.estado} />)}</span>
      <span className="muted">Opinan {opinan} de {cores.length} factores{pendientes ? ', preliminar' : ''}</span>
    </span>
  );
}

function Tarjeta({ codigo, items }) {
  return (
    <article className="card screener-card" aria-label={'Las 5 mejores para ' + ESTRATEGIA_LABELS[codigo]}>
      <h3><Termino id={codigo.toLowerCase()}>{ESTRATEGIA_LABELS[codigo]}</Termino></h3>
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
                    <strong>{it.simbolo}</strong>
                    <span className="muted small inicio-trunc">{it.nombre}</span>
                    <span className="screener-item__px"><span>{fmtMoney(it.precio)}</span><Cambio valor={it.cambioPct} /></span>
                  </span>
                  <ScoreBar value={it.puntaje} label={'Puntaje de ' + it.simbolo} />
                  {it.resumen && <span className="muted small screener-item__sum">{it.resumen}</span>}
                  {it.cores && <Factores cores={it.cores} />}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

const FASES = {
  sin_iniciar: 'Preparando el universo…', catalogo: 'Buscando las empresas del mercado…', puntuando: 'Calculando el ranking…',
  error: 'Reintentando con el proveedor…',
};
const esperaRanking = d => (!d || !d.universo?.total ? 3000 : d.universo.fase === 'completando' ? 15000 : 60000);

function Screener() {
  const { data: d, error, loading } = useSondeo(() => screener.ranking({ limite: 5 }), esperaRanking);
  const u = d?.universo || {};
  const listo = u.total > 0;
  return (
    <section className="inicio-sec" aria-label="Mejores empresas por estrategia">
      <div className="inicio-sec__head">
        <h2>Las 5 mejores por estrategia</h2>
        <span className="muted small" aria-live="polite">
          {listo ? `De ${fmtInt(u.total)} empresas, ${fmtDateTime(u.actualizadoEn)}` : d ? FASES[u.fase] || '' : ''}
        </span>
      </div>
      {error && !d && <ErrorMessage error={error} title="No se pudo cargar el ranking; se reintenta solo" />}
      {u.aviso && <Notice tone="warning">{u.aviso}</Notice>}
      {listo && u.porCore && (u.completas < u.total
        ? <Notice><strong>Ranking preliminar.</strong> {fmtInt(u.completas)} de {fmtInt(u.total)} empresas ya tienen los cinco factores. Se completa solo: {Object.entries(u.porCore).filter(([, n]) => n < u.total).map(([c, n]) => `${CORE_LABELS[c]} ${fmtInt(n)}`).join(', ')}.</Notice>
        : <p className="muted small">Ranking con los cinco factores: {Object.keys(u.porCore).map(c => CORE_LABELS[c]).join(', ')}.</p>)}
      {(loading || (d && !listo)) && (
        <div className="screener-grid" aria-hidden="true">
          {ESTRATEGIAS.map(c => (
            <div key={c} className="card screener-card">
              <h3>{ESTRATEGIA_LABELS[c]}</h3>
              <p className="muted small">{DESCRIPCION[c]}</p>
              <div className="screener-list">{[0, 1, 2, 3, 4].map(i => <span key={i} className="skel screener-skel" />)}</div>
            </div>
          ))}
        </div>
      )}
      {listo && <div className="screener-grid">{ESTRATEGIAS.map(c => <Tarjeta key={c} codigo={c} items={d.estrategias?.[c] || []} />)}</div>}
      <p className="muted small">Ranking informativo y educativo, calculado con datos del proveedor; no es una recomendación de inversión.</p>
    </section>
  );
}

export default function Inicio() {
  const { mercado } = useOutletContext();
  return (
    <div className="inicio">
      <h1 className="sr-only">Inicio</h1>
      <Indices mercado={mercado} />
      <MapaMercado />
      <Movimientos />
      <Screener />
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
