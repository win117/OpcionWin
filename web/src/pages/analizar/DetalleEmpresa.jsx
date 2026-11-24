// Detalle de la empresa: cabecera con precio/estadísticas y pestañas de datos de apoyo (opciones, fundamentales, 13F, noticias).
import { useState } from 'react';
import { Tabs } from '../../components/Tabs';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import FundamentalesTab from '../mercado/FundamentalesTab';
import InstitucionalTab from '../mercado/InstitucionalTab';
import NoticiasTab from '../mercado/NoticiasTab';
import OpcionesGriegas from './OpcionesGriegas';
import Progreso from './Progreso';
import { fmtCompact, fmtDateTime, fmtMoney, fmtPct, isNum } from '../../utils/format';

export const TABS = [
  { value: 'opciones', label: 'Opciones y griegas' },
  { value: 'fundamentales', label: 'Fundamentales' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'noticias', label: 'Noticias' },
];

/** Cabecera de la empresa. `velas` = velas diarias ya cargadas. */
export function DetalleEmpresa({ empresa, simbolo, velas, version, corriendo, pasosDatos, onActualizar }) {
  const cot = useAsync(async () => (await mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] }))).items?.at(-1), [simbolo, version]);
  const cotizacion = cot.data;
  const last = velas.at(-1), prev = velas.at(-2);
  const precio = cotizacion?.ultimo ?? last?.close;
  const cambio = last && prev ? (last.close - prev.close) / prev.close : null;
  const ult52 = velas.slice(-252);
  const mostrarPasos = pasosDatos && (corriendo || pasosDatos.some(p => p.estado === 'fallida'));
  return (
    <>
      <section className="card">
        <div className="card__header">
          <div>
            <h1 className="ticker">{empresa.simbolo} <span className="muted ticker__name">{empresa.nombre}</span></h1>
            <p className="muted small">{empresa.mercado}{empresa.cik ? ' · CIK ' + empresa.cik : ''}</p>
            <button type="button" className="btn btn--sm" onClick={onActualizar} disabled={corriendo}>{corriendo ? 'Actualizando…' : 'Actualizar datos'}</button>
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
      {mostrarPasos && <Progreso pasos={pasosDatos} titulo="Actualizando datos" />}
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
