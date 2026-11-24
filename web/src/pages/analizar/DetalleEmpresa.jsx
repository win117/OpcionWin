// Cabecera de la empresa: precio, cifras del día, acciones (analizar, configurar, actualizar) y avance en una sola línea.
// Se dibuja igual antes y después de tener datos, para que nada se mueva al llegar.
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Termino } from '../../components/Termino';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import { giroEs } from '../../utils/sic';
import { fmtCompact, fmtDateTime, fmtMoney, fmtPct, isNum } from '../../utils/format';
import { Pasos, resumenPasos } from './Progreso';

const SPREAD_MAX = 0.02; // por encima, la cotización no es un precio fiable
const minuscula = t => t.charAt(0).toLowerCase() + t.slice(1);
const CONSOLIDADOS = ['sip', 'delayed_sip'];

/** Bid y ask solo orientan con el mercado abierto y poca diferencia entre ambos. */
function BidAsk({ cotizacion, abierto }) {
  const { bid, ask } = cotizacion || {};
  if (!(bid > 0) || !(ask > 0)) return '—';
  if (abierto === false) return <span className="muted stats__nota">Mercado cerrado</span>;
  const spread = (ask - bid) / ((ask + bid) / 2);
  return <>{fmtMoney(bid)} / {fmtMoney(ask)}{spread > SPREAD_MAX && <span className="stats__nota stats__nota--aviso">Diferencia de {fmtPct(spread, 1)}: poco fiable</span>}</>;
}

/** Una línea siempre presente: avance, errores o fecha del dato. */
function Estado({ proceso, corriendo, fecha, abierto, onAlternar }) {
  const r = resumenPasos(proceso?.pasos);
  let contenido = <span className="muted small">{fecha ? 'Datos al ' + fmtDateTime(fecha) : ''}</span>;
  if (corriendo && proceso) {
    contenido = <span className="muted small" role="status">{proceso.titulo}{r.actual ? ': ' + minuscula(r.actual.label) : ''} ({r.hechos} de {r.total})</span>;
  } else if (proceso && r.fallidos.length) {
    contenido = <span className="small detalle__error" role="status">No se pudo completar: {r.fallidos.map(p => minuscula(p.label)).join(', ')}</span>;
  } else if (proceso?.tipo === 'analisis' && r.hechos === r.total) {
    contenido = <span className="muted small" role="status">{proceso.titulo}: listo</span>;
  }
  return (
    <div className="detalle__estado">
      {contenido}
      {proceso && <button type="button" className="enlace" aria-expanded={abierto} aria-controls="detalle-pasos" onClick={onAlternar}>{abierto ? 'Ocultar pasos' : 'Ver pasos'}</button>}
      {corriendo && proceso && <span className="detalle__barra" role="progressbar" aria-label={proceso.titulo} aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.hechos}><span style={{ width: 100 * r.hechos / Math.max(1, r.total) + '%' }} /></span>}
    </div>
  );
}

/** `velas` = velas diarias ya cargadas; `ficha` = datos en vivo del universo (null si la empresa no está en él). */
export function DetalleEmpresa({ empresa, simbolo, velas, ficha, version, proceso, corriendo, acciones }) {
  const [verPasos, setVerPasos] = useState(false);
  const cot = useAsync(async () => (await mercado.cotizaciones(simbolo, { limit: 1 }).catch(() => ({ items: [] }))).items?.at(-1), [simbolo, version], { enabled: Boolean(empresa) });
  const { mercado: sesion } = useOutletContext() || {};
  const cotizacion = cot.data;
  const last = velas.at(-1), prev = velas.at(-2);
  const precio = ficha?.precio ?? cotizacion?.ultimo ?? last?.close;
  const cambio = isNum(ficha?.cambioPct) ? ficha.cambioPct : last && prev ? (last.close - prev.close) / prev.close : null;
  const ult52 = velas.slice(-252);
  const min52 = isNum(ficha?.minimo52) ? Math.min(ficha.minimo52, precio) : ult52.length ? Math.min(...ult52.map(v => v.low)) : null;
  const max52 = isNum(ficha?.maximo52) ? Math.max(ficha.maximo52, precio) : ult52.length ? Math.max(...ult52.map(v => v.high)) : null;
  // Con ficha, precio y volumen salen de la misma fuente que el mapa. Sin ella, lo guardado suele ser de una sola bolsa y se dice.
  const unaBolsa = !ficha && last && !CONSOLIDADOS.includes(last.row?.fuente?.feed);
  const volumen = ficha ? ficha.volumen : last?.volume;
  const fecha = ficha?.actualizadoEn || cotizacion?.fuente?.fechaDato || last?.row?.fuente?.fechaDato;
  const sub = [empresa?.mercado, ficha?.sector, giroEs(ficha?.industria)].filter(Boolean).join(', ');
  const hueco = <span className="skel detalle__skel" />;
  const cargando = !precio;
  return (
    <section className="card detalle" aria-label={'Datos de ' + simbolo}>
      <div className="detalle__cab">
        <div className="detalle__nombre">
          <h1 className="ticker">{simbolo} <span className="muted ticker__name">{empresa?.nombre || ficha?.nombre || ''}</span></h1>
          <p className="muted small">{sub || ' '}</p>
        </div>
        <div className="price">
          <span className="price__value">{cargando ? hueco : fmtMoney(precio)}</span>
          <span className={'price__chg' + (isNum(cambio) ? (cambio >= 0 ? ' up' : ' down') : '')}>{isNum(cambio) ? `${cambio >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(cambio), 2)}` : ' '}{unaBolsa && <span className="muted small"> bolsa IEX</span>}</span>
        </div>
        <dl className="detalle__datos">
          <div><dt>Rango de 52 semanas</dt><dd>{isNum(min52) ? `${fmtMoney(min52)} a ${fmtMoney(max52)}` : cargando ? hueco : '—'}</dd></div>
          <div><dt>{unaBolsa ? 'Volumen (bolsa IEX)' : 'Volumen'}</dt><dd>{isNum(volumen) ? fmtCompact(volumen) : cargando ? hueco : '—'}</dd></div>
          <div><dt><Termino id="spread">Compra / venta</Termino></dt><dd>{cargando && !cotizacion ? hueco : <BidAsk cotizacion={cotizacion} abierto={sesion?.data?.abierto} />}</dd></div>
        </dl>
      </div>
      <div className="detalle__pie">
        <div className="detalle__acciones">{acciones}</div>
        <Estado proceso={proceso} corriendo={corriendo} fecha={fecha} abierto={verPasos} onAlternar={() => setVerPasos(v => !v)} />
      </div>
      {proceso && verPasos && <div id="detalle-pasos"><Pasos pasos={proceso.pasos} /></div>}
    </section>
  );
}

export default DetalleEmpresa;
