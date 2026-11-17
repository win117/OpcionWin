// Detalle de la empresa seleccionada: encabezado + pestañas de datos.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CandleChart } from '../../components/CandleChart';
import { SyncButton } from '../../components/SyncButton';
import { Tabs } from '../../components/Tabs';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { empresas, mercado } from '../../api/resources';
import { toCandles } from '../mercado/GraficoTab';
import FundamentalesTab from '../mercado/FundamentalesTab';
import InstitucionalTab from '../mercado/InstitucionalTab';
import NoticiasTab from '../mercado/NoticiasTab';
import OpcionesGriegas from './OpcionesGriegas';
import Resultados from './Resultados';
import Progreso from './Progreso';
import { fmtCompact, fmtDateTime, fmtMoney, fmtPct, isNum } from '../../utils/format';

export const TABS = [
  { value: 'grafico', label: 'Gráfico' },
  { value: 'opciones', label: 'Opciones y griegas' },
  { value: 'fundamentales', label: 'Fundamentales' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'noticias', label: 'Noticias' },
  { value: 'analisis', label: 'Último análisis' },
];

function sma(velas, n) {
  const out = [];
  let suma = 0;
  velas.forEach((v, i) => {
    suma += v.close;
    if (i >= n) suma -= velas[i - n].close;
    if (i >= n - 1) out.push({ time: v.time, value: suma / n });
  });
  return out;
}

function Grafico({ velas, simbolo, recargar }) {
  const overlays = useMemo(() => [
    { id: 'sma20', label: 'SMA 20', color: '--accent', data: sma(velas, 20) },
    { id: 'sma50', label: 'SMA 50', color: '--info-fg', data: sma(velas, 50) },
    { id: 'sma200', label: 'SMA 200', color: '--warning-fg', data: sma(velas, 200) },
  ].filter(o => o.data.length), [velas]);
  if (!velas.length) {
    return (
      <div className="stack">
        <Empty title="Sin velas almacenadas">Sincroniza los históricos para ver el gráfico.</Empty>
        <SyncButton recurso="historicos" simbolos={[simbolo]} onDone={recargar} label="Sincronizar históricos" />
      </div>
    );
  }
  return (
    <div className="stack">
      <CandleChart velas={velas} overlays={overlays} />
      <ul className="chips chips--legend" aria-label="Leyenda">
        {overlays.map(o => <li key={o.id}><i className="swatch" style={{ background: `var(${o.color})` }} /> {o.label}</li>)}
        <li className="muted small">Volumen en la base · {velas.length} sesiones</li>
      </ul>
    </div>
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

export default function DetalleEmpresa({ simbolo, version, tab, onTab, corriendo, pasosDatos, onTraerDatos }) {
  const state = useAsync(async () => {
    const empresa = (await empresas.list({ simbolo, limit: 1 })).items[0];
    if (!empresa) return { empresa: null };
    const [hist, cot] = await Promise.all([
      mercado.historicos(simbolo, { limit: 300 }).catch(() => ({ items: [] })),
      mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] })),
    ]);
    return { empresa, velas: toCandles(hist.items || []), cotizacion: cot.items?.at(-1) };
  }, [simbolo, version]);
  const d = state.data;

  if (state.loading && !d) return <Loading text={'Cargando ' + simbolo + '…'} />;
  if (state.error && !d) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (!d) return null;

  if (!d.empresa) {
    return (
      <>
        <section className="card">
          <div className="card__header"><div><h2 className="ticker">{simbolo}</h2><p className="muted small">Esta empresa aún no está registrada en tu catálogo.</p></div></div>
          <p>Trae sus datos reales (empresa, velas, cotización, noticias, fundamentales y contratos) para poder analizarla.</p>
          <div><button type="button" className="btn btn--primary" onClick={onTraerDatos} disabled={corriendo}>{corriendo ? 'Trayendo datos…' : 'Traer datos'}</button></div>
        </section>
        {pasosDatos && <Progreso pasos={pasosDatos} titulo="Trayendo datos" />}
      </>
    );
  }
  const { empresa } = d;
  const props = { empresa, simbolo };
  return (
    <>
      <Encabezado empresa={empresa} velas={d.velas} cotizacion={d.cotizacion} />
      <section className="card">
        <Tabs tabs={TABS} value={tab} onChange={onTab} label="Detalle de la empresa" />
        <div role="tabpanel" className="tabpanel">
          {tab === 'grafico' && <Grafico velas={d.velas} simbolo={simbolo} recargar={state.reload} />}
          {tab === 'opciones' && <OpcionesGriegas simbolo={simbolo} />}
          {tab === 'fundamentales' && <FundamentalesTab {...props} />}
          {tab === 'institucional' && <InstitucionalTab {...props} />}
          {tab === 'noticias' && <NoticiasTab {...props} />}
          {tab === 'analisis' && <Resultados empresa={empresa} version={version} />}
        </div>
        <p className="muted small"><Link to={'/mercado/' + simbolo}>Ver mercado completo →</Link></p>
      </section>
    </>
  );
}
