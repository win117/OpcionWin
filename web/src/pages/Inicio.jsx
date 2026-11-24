// Inicio: índices, mapa del mercado en vivo, las 5 mejores por estrategia (automático) y buscador de empresas.
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ScoreBar } from '../components/Gauge';
import { Empty, ErrorMessage, Notice } from '../components/States';
import Buscador from './analizar/Buscador';
import { MercadoEstado } from '../components/MercadoEstado';
import MapaMercado from './mercado/MapaMercado';
import { useSondeo } from '../hooks/useSondeo';
import { screener } from '../api/resources';
import { ESTRATEGIAS, ESTRATEGIA_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtInt, fmtMoney, fmtNum, fmtPct, isNum } from '../utils/format';

const NOMBRES_INDICE = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', IWM: 'Russell 2000', DIA: 'Dow Jones' };
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

const FASES = {
  sin_iniciar: 'Preparando el universo…', catalogo: 'Buscando las empresas del mercado…', puntuando: 'Calculando el ranking…',
  volatilidad: 'Afinando con la volatilidad implícita', error: 'Reintentando con el proveedor…',
};
const esperaRanking = d => (!d || !d.universo?.total ? 3000 : d.universo.fase === 'volatilidad' ? 15000 : 60000);

function Screener() {
  const { data: d, error, loading } = useSondeo(() => screener.ranking({ limite: 5 }), esperaRanking);
  const u = d?.universo || {};
  const listo = u.total > 0;
  return (
    <section className="inicio-sec" aria-label="Mejores empresas por estrategia">
      <div className="inicio-sec__head">
        <h2>Las 5 mejores por estrategia</h2>
        <span className="muted small" aria-live="polite">
          {listo ? `De ${fmtInt(u.total)} empresas, ${fmtDateTime(u.actualizadoEn)}${u.fase === 'volatilidad' ? `. ${FASES.volatilidad}: ${fmtInt(u.conIv)} de ${fmtInt(u.total)}` : ''}` : d ? FASES[u.fase] || '' : ''}
        </span>
      </div>
      {error && !d && <ErrorMessage error={error} title="No se pudo cargar el ranking; se reintenta solo" />}
      {u.aviso && <Notice tone="warning">{u.aviso}</Notice>}
      {(loading || (d && !listo)) && <div className="screener-grid">{ESTRATEGIAS.map(c => <div key={c} className="card"><span className="skel" style={{ height: 18, width: '50%' }} /><span className="skel" style={{ height: 120 }} /></div>)}</div>}
      {listo && <div className="screener-grid">{ESTRATEGIAS.map(c => <Tarjeta key={c} codigo={c} items={d.estrategias?.[c] || []} />)}</div>}
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
      <MapaMercado />
      <Screener />
      <section className="inicio-sec" aria-label="Buscar empresa">
        <Buscador seleccionado="" version={0} onSelect={s => navigate('/analisis/' + encodeURIComponent(s))} />
      </section>
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
