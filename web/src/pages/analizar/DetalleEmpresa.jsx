// Detalle de la empresa seleccionada: encabezado + pestañas de datos.
import { Link } from 'react-router-dom';
import { Tabs } from '../../components/Tabs';
import { ErrorMessage, Loading } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import { toCandles } from '../mercado/GraficoTab';
import FundamentalesTab from '../mercado/FundamentalesTab';
import InstitucionalTab from '../mercado/InstitucionalTab';
import NoticiasTab from '../mercado/NoticiasTab';
import BotonOperar from '../../components/BotonOperar';
import OpcionesGriegas from './OpcionesGriegas';
import Resultados from './Resultados';
import GraficoPanel from './GraficoPanel';
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

function Encabezado({ empresa, velas, cotizacion, onActualizar, corriendo }) {
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
          <button type="button" className="btn btn--sm" onClick={onActualizar} disabled={corriendo}>{corriendo ? 'Actualizando…' : 'Actualizar datos'}</button>{' '}
          <BotonOperar empresa={empresa} label="Operar (paper)" className="btn btn--sm btn--primary" />
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
          <div><dt>Datos al</dt><dd>{fmtDateTime(cotizacion?.fuente?.fechaDato || last?.row?.fuente?.fechaDato)}</dd></div>
        </dl>
      )}
    </section>
  );
}

export default function DetalleEmpresa({ empresa, simbolo, version, tab, onTab, corriendo, pasosDatos, onActualizar }) {
  const state = useAsync(async () => {
    const [hist, cot] = await Promise.all([
      mercado.historicos(simbolo, { limit: 300 }).catch(() => ({ items: [] })),
      mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] })),
    ]);
    return { velas: toCandles(hist.items || []), cotizacion: cot.items?.at(-1) };
  }, [simbolo, version]);
  const d = state.data;

  if (state.loading && !d) return <Loading text={'Cargando ' + simbolo + '…'} />;
  if (state.error && !d) return <ErrorMessage error={state.error} onRetry={state.reload} />;
  if (!d) return null;

  const props = { empresa, simbolo };
  const mostrarPasos = pasosDatos && (corriendo || pasosDatos.some(p => p.estado === 'fallida'));
  return (
    <>
      <Encabezado empresa={empresa} velas={d.velas} cotizacion={d.cotizacion} onActualizar={onActualizar} corriendo={corriendo} />
      {mostrarPasos && <Progreso pasos={pasosDatos} titulo="Actualizando datos" />}
      <section className="card">
        <Tabs tabs={TABS} value={tab} onChange={onTab} label="Detalle de la empresa" />
        <div role="tabpanel" className="tabpanel">
          {tab === 'grafico' && <GraficoPanel simbolo={simbolo} onCambio={state.reload} />}
          {tab === 'opciones' && <OpcionesGriegas simbolo={simbolo} empresa={empresa} />}
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
