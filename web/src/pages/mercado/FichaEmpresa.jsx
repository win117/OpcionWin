// Ficha de una empresa elegida en el mapa: todo en vivo, sin guardar nada hasta que el usuario decida analizarla.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { mercado } from '../../api/resources';
import { useSondeo } from '../../hooks/useSondeo';
import { CandleChart } from '../../components/CandleChart';
import { ScoreBar } from '../../components/Gauge';
import { Termino } from '../../components/Termino';
import { ErrorMessage } from '../../components/States';
import { CORE_LABELS, ESTRATEGIAS, ESTRATEGIA_LABELS } from '../../utils/constants';
import { giroEs } from '../../utils/sic';
import { fmtCompact, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';

const RANGOS = ['1M', '3M', '6M', '1A'];
const signo = v => (isNum(v) ? (v > 0 ? '+' : '') + fmtFixed(v * 100, 2) + '%' : '—');
const tono = v => (!isNum(v) ? 'muted' : v >= 0 ? 'up' : 'down');

/** Posición del precio dentro de un rango mínimo–máximo. */
function Rango({ titulo, minimo, maximo, precio }) {
  if (!isNum(minimo) || !isNum(maximo) || !(maximo > minimo) || !isNum(precio)) return null;
  const pos = Math.max(0, Math.min(1, (precio - minimo) / (maximo - minimo))) * 100;
  return (
    <div className="ficha__rango">
      <div className="ficha__rango-top"><span>{titulo}</span><span className="muted">{fmtMoney(minimo)} a {fmtMoney(maximo)}</span></div>
      <div className="ficha__riel" role="img" aria-label={`${titulo}: el precio está al ${Math.round(pos)} % entre ${fmtMoney(minimo)} y ${fmtMoney(maximo)}`}><i style={{ left: pos + '%' }} /></div>
    </div>
  );
}

export default function FichaEmpresa({ simbolo, vivo, onCerrar }) {
  const { data, error, loading } = useSondeo(() => mercado.ficha(simbolo), d => (!d ? 5000 : d.abierto ? 30000 : 120000), simbolo);
  const [rango, setRango] = useState('3M');
  const velas = useMemo(() => (data?.velas || [])
    .filter(v => [v.apertura, v.maximo, v.minimo, v.cierre].every(isNum))
    .map(v => ({ time: Math.floor(Date.parse(v.fecha) / 1000), open: v.apertura, high: v.maximo, low: v.minimo, close: v.cierre, volume: v.volumen || 0 })), [data?.velas]);
  // El precio del mapa se actualiza más seguido que la ficha: manda el más reciente.
  const d = { ...(data || {}), ...(vivo ? { nombre: vivo.nombre, sector: vivo.sector, industria: vivo.industria, precio: vivo.precio, cambioPct: vivo.cambioPct, volumen: vivo.volumen, capitalizacion: vivo.capitalizacion, puntajes: vivo.puntajes || data?.puntajes } : {}) };
  const mejor = d.puntajes ? ESTRATEGIAS.filter(e => isNum(d.puntajes[e])).sort((a, b) => d.puntajes[b] - d.puntajes[a])[0] : null;
  const volRel = isNum(d.volumen) && d.volumenPromedio > 0 ? d.volumen / d.volumenPromedio : null;

  return (
    <div className="ficha">
      <div className="ficha__cab">
        <div>
          <h3 tabIndex={-1}><span className="ticker">{simbolo}</span> <span className="muted ficha__nombre">{d.nombre}</span></h3>
          <p className="muted small">{[d.sector, giroEs(d.industria)].filter(Boolean).join(', ')}</p>
        </div>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Cerrar ficha" onClick={onCerrar}>×</button>
      </div>
      <p className="ficha__precio"><strong>{fmtMoney(d.precio)}</strong> <span className={tono(d.cambioPct)}>{signo(d.cambioPct)}</span></p>
      <div className="ficha__acciones">
        <Link className="btn btn--primary" to={`/analisis/${encodeURIComponent(simbolo)}${mejor ? '?estrategia=' + mejor : ''}`}>Analizar y operar</Link>
      </div>
      {error && !data && <ErrorMessage error={error} title="No se pudo cargar la ficha" />}
      <div className="mapa__grupo" role="group" aria-label="Periodo de la gráfica">
        {RANGOS.map(r => <button key={r} type="button" className="mapa__op" aria-pressed={r === rango} onClick={() => setRango(r)}>{r}</button>)}
      </div>
      {loading ? <span className="skel" style={{ height: 220 }} /> : velas.length > 1 ? <CandleChart velas={velas} height={220} rango={rango} /> : <p className="muted small">Sin historial de precios.</p>}
      <dl className="ficha__datos">
        <div><dt>1 semana</dt><dd className={tono(d.cambio5d)}>{signo(d.cambio5d)}</dd></div>
        <div><dt>1 mes</dt><dd className={tono(d.cambio21d)}>{signo(d.cambio21d)}</dd></div>
        <div><dt>En el año</dt><dd className={tono(d.cambioAnio)}>{signo(d.cambioAnio)}</dd></div>
        <div><dt>Capitalización (USD)</dt><dd>{fmtCompact(d.capitalizacion)}</dd></div>
        <div><dt>Volumen</dt><dd>{fmtCompact(d.volumen)}{volRel != null && <span className="muted small"> ({fmtFixed(volRel, 1)}× lo normal)</span>}</dd></div>
        <div><dt><Termino id="iv">Volatilidad implícita</Termino></dt><dd>{isNum(d.ivPromedio) ? fmtPct(d.ivPromedio, 1) : '—'}</dd></div>
        <div><dt><Termino id="hv">Volatilidad 20 días</Termino></dt><dd>{isNum(d.hv20) ? fmtPct(d.hv20, 1) : '—'}</dd></div>
        <div><dt>Apertura</dt><dd>{fmtMoney(d.apertura)}</dd></div>
        <div><dt>Cierre anterior</dt><dd>{fmtMoney(d.cierreAnterior)}</dd></div>
      </dl>
      <Rango titulo="Rango del día" minimo={d.minimo} maximo={d.maximo} precio={d.precio} />
      <Rango titulo="Rango de 52 semanas" minimo={isNum(d.minimo52) ? Math.min(d.minimo52, d.precio) : null} maximo={isNum(d.maximo52) ? Math.max(d.maximo52, d.precio) : null} precio={d.precio} />
      <div className="ficha__puntajes">
        <h4>Compatibilidad rápida</h4>
        {d.puntajes ? ESTRATEGIAS.map(e => (
          <Link key={e} className="ficha__estrategia" to={`/analisis/${encodeURIComponent(simbolo)}?estrategia=${e}`}>
            <span className="ficha__estrategia-nombre">{ESTRATEGIA_LABELS[e]}</span>
            <ScoreBar value={d.puntajes[e]} label={ESTRATEGIA_LABELS[e]} />
            {d.resumenes?.[e] && <span className="muted small">{d.resumenes[e]}</span>}
          </Link>
        )) : <p className="muted small">Se está calculando; aparece en unos segundos.</p>}
        {d.cores && (
          <>
            <h4>Qué dice cada factor</h4>
            <ul className="ficha__factores">
              {d.cores.map(c => (
                <li key={c.core}>
                  <span>{CORE_LABELS[c.core]}</span>
                  {c.estado === 'ok' ? <ScoreBar value={c.puntaje} label={`${CORE_LABELS[c.core]} (0 bajista, 100 alcista)`} /> : <span className="muted small">{c.estado === 'pendiente' ? 'Evaluándose' : 'Sin datos, no opina'}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small">{d.cores?.some(c => c.estado === 'pendiente') ? 'Preliminar: aún faltan factores por evaluar.' : 'Combina los cinco factores.'} «Analizar y operar» lo detalla y agrega tus pesos.</p>
      </div>
    </div>
  );
}
