// Detalle de la empresa: cabecera con precio/estadísticas y pestañas de datos de apoyo (opciones, fundamentales, 13F, noticias).
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Termino } from '../../components/Termino';
import { Tabs } from '../../components/Tabs';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import FundamentalesTab from '../mercado/FundamentalesTab';
import InstitucionalTab from '../mercado/InstitucionalTab';
import NoticiasTab from '../mercado/NoticiasTab';
import OpcionesGriegas from './OpcionesGriegas';
import { fmtCompact, fmtDateTime, fmtMoney, fmtPct, isNum } from '../../utils/format';

export const TABS = [
  { value: 'opciones', label: 'Opciones y griegas' },
  { value: 'fundamentales', label: 'Fundamentales' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'noticias', label: 'Noticias' },
];

const SPREAD_MAX = 0.02; // por encima, la cotización no es un precio fiable
const BOLSAS = { iex: 'Volumen (bolsa IEX)', sip: 'Volumen (todas las bolsas)', delayed_sip: 'Volumen (todas las bolsas)' };

/** Bid y ask solo orientan con el mercado abierto y poca diferencia entre ambos. */
function BidAsk({ cotizacion, abierto }) {
  const { bid, ask } = cotizacion || {};
  if (!(bid > 0) || !(ask > 0)) return '—';
  if (abierto === false) return <span className="muted stats__nota">Mercado cerrado: sin precios vigentes</span>;
  const spread = (ask - bid) / ((ask + bid) / 2);
  return <>{fmtMoney(bid)} / {fmtMoney(ask)}{spread > SPREAD_MAX && <span className="stats__nota stats__nota--aviso">Diferencia de {fmtPct(spread, 1)}: poco fiable</span>}</>;
}

/** Una línea siempre presente: avance, error o fecha del dato. Así actualizar no mueve la página. */
function Estado({ corriendo, pasos, fecha }) {
  const hechos = (pasos || []).filter(p => ['completada', 'fallida', 'omitida'].includes(p.estado)).length;
  const fallidos = (pasos || []).filter(p => p.estado === 'fallida');
  if (corriendo && pasos && hechos < pasos.length) {
    const actual = pasos.find(p => p.estado === 'procesando');
    return (
      <>
        <span className="muted small" role="status">Actualizando{actual ? ': ' + actual.label.toLowerCase() : ''} ({hechos} de {pasos.length})</span>
        <span className="detalle__barra" role="progressbar" aria-label="Actualizando datos" aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={hechos}><span style={{ width: 100 * hechos / Math.max(1, pasos.length) + '%' }} /></span>
      </>
    );
  }
  if (fallidos.length) return <span className="small detalle__error" role="status" title={fallidos.map(p => `${p.label}: ${p.error || 'sin detalle'}`).join('\n')}>No se pudo actualizar: {fallidos.map(p => p.label.toLowerCase()).join(', ')}</span>;
  return <span className="muted small">{fecha ? 'Datos al ' + fmtDateTime(fecha) : ''}</span>;
}

/** Cabecera de la empresa. `velas` = velas diarias ya cargadas. */
export function DetalleEmpresa({ empresa, simbolo, velas, version, corriendo, pasosDatos, onActualizar }) {
  const cot = useAsync(async () => (await mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] }))).items?.at(-1), [simbolo, version]);
  const { mercado: sesion } = useOutletContext() || {};
  const cotizacion = cot.data;
  const last = velas.at(-1), prev = velas.at(-2);
  const precio = cotizacion?.ultimo ?? last?.close;
  const cambio = last && prev ? (last.close - prev.close) / prev.close : null;
  const ult52 = velas.slice(-252);
  const fecha = cotizacion?.fuente?.fechaDato || last?.row?.fuente?.fechaDato;
  return (
    <>
      <section className="card detalle">
        <div className="card__header">
          <div>
            <h1 className="ticker">{empresa.simbolo} <span className="muted ticker__name">{empresa.nombre}</span></h1>
            <p className="muted small">{empresa.mercado}{empresa.cik ? ', CIK ' + empresa.cik : ''}</p>
            <div className="detalle__estado">
              <button type="button" className="btn btn--sm" onClick={onActualizar} disabled={corriendo}>Actualizar datos</button>
              <Estado corriendo={corriendo} pasos={pasosDatos} fecha={fecha} />
            </div>
          </div>
          <div className="price">
            <span className="price__value">{fmtMoney(precio)}</span>
            <span className={'price__chg ' + (cambio >= 0 ? 'up' : 'down')}>{isNum(cambio) ? `${cambio >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(cambio), 2)}` : ' '}</span>
          </div>
        </div>
        <dl className="stats stats--row">
          <div><dt>Rango 52 semanas</dt><dd>{last ? `${fmtMoney(Math.min(...ult52.map(v => v.low)))} a ${fmtMoney(Math.max(...ult52.map(v => v.high)))}` : '—'}</dd></div>
          <div><dt>{BOLSAS[last?.row?.fuente?.feed] || 'Volumen'}</dt><dd>{fmtCompact(last?.volume)}</dd></div>
          <div><dt><Termino id="spread">Bid / Ask</Termino></dt><dd><BidAsk cotizacion={cotizacion} abierto={sesion?.data?.abierto} /></dd></div>
        </dl>
      </section>
    </>
  );
}

/** Datos de apoyo (consulta de lo almacenado; no se sincroniza nada al abrirlos). */
export function DatosEmpresa({ empresa, simbolo }) {
  const [tab, setTab] = useState('opciones');
  const props = { empresa, simbolo };
  return (
    <section className="card">
      <h2>Datos de la empresa</h2>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Datos de la empresa" />
      <div role="tabpanel" className="tabpanel">
        {tab === 'opciones' && <OpcionesGriegas simbolo={simbolo} empresa={empresa} />}
        {tab === 'fundamentales' && <FundamentalesTab {...props} />}
        {tab === 'institucional' && <InstitucionalTab {...props} />}
        {tab === 'noticias' && <NoticiasTab {...props} />}
      </div>
    </section>
  );
}

export default DetalleEmpresa;
