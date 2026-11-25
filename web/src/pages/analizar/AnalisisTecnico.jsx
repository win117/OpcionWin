// Análisis técnico: gráfica con S/R y señales, bloque de confluencia e indicadores con sus valores.
import { useMemo } from 'react';
import GraficoPanel from './GraficoPanel';
import { Empty } from '../../components/States';
import { Termino } from '../../components/Termino';
import { CORE_LABELS } from '../../utils/constants';
import { resumenIndicadores } from '../../utils/indicadores';
import { confluencia, estadoSenales, eventosSenales, soportesResistencias, etiquetaEvento } from '../../utils/senales';
import { fmtDate, fmtFixed, fmtNum, fmtPct, isNum } from '../../utils/format';
import { metrica } from '../../utils/objects';

const DIR = { alcista: { texto: 'Alcista', clase: 'up', icono: '▲' }, bajista: { texto: 'Bajista', clase: 'down', icono: '▼' }, neutral: { texto: 'Neutral', clase: 'flat', icono: '■' }, informativo: { texto: 'Informativo', clase: 'flat', icono: 'ⓘ' } };
const LADO = { compra: { texto: '▲ COMPRA', clase: 'up' }, venta: { texto: '▼ VENTA', clase: 'down' }, info: { texto: 'ⓘ Informativo', clase: 'muted' } };

function Chip({ dir }) {
  const d = DIR[dir] || DIR.neutral;
  return <span className={'dir dir--' + d.clase}>{d.icono} {d.texto}</span>;
}

function Confluencia({ conf, eventos, coresActivos }) {
  const sinCores = conf.total === 0;
  const resumen = conf.sesgo === 'neutral'
    ? 'Sin sesgo claro: las señales alcistas y bajistas se compensan.'
    : `Confluencia ${conf.sesgo} ${conf.nivel}: ${conf.coinciden.length} de ${conf.total} señales coinciden.`;
  const recientes = eventos.slice(-6).reverse();
  return (
    <section className="card" aria-labelledby="conf-titulo">
      <div className="card__header"><div><h3 id="conf-titulo">Confluencia de señales</h3><p className="muted small">Cuántas señales de tendencia (medias y MACD) apuntan en la misma dirección. RSI, estocástico y Bollinger no se cuentan. <Termino id="core">Factores</Termino> activos: {coresActivos.map(c => CORE_LABELS[c]).join(', ') || 'ninguno'}.</p></div></div>
      {sinCores ? <Empty title="Sin señales que contar">Activa el factor Técnico o Indicadores en «Configurar» y asegúrate de tener al menos 20 velas.</Empty> : (
        <>
          <div className="conf-resumen" role="group" aria-label="Recuento de señales">
            <div className="conf-count conf-count--up"><strong>{conf.alcistas.length}</strong><span>Alcistas</span></div>
            <div className="conf-count conf-count--flat"><strong>{conf.neutrales.length}</strong><span>Neutrales</span></div>
            <div className="conf-count conf-count--down"><strong>{conf.bajistas.length}</strong><span>Bajistas</span></div>
          </div>
          <div className="conf-bar" role="img" aria-label={`${conf.alcistas.length} alcistas, ${conf.neutrales.length} neutrales, ${conf.bajistas.length} bajistas`}>
            <span className="conf-bar__up" style={{ flex: conf.alcistas.length }} />
            <span className="conf-bar__flat" style={{ flex: conf.neutrales.length }} />
            <span className="conf-bar__down" style={{ flex: conf.bajistas.length }} />
          </div>
          <p><Chip dir={conf.sesgo} /> {resumen}</p>
          {conf.coinciden.length > 0 && conf.sesgo !== 'neutral' && (
            <p className="small"><strong>Coinciden:</strong> {conf.coinciden.map(s => s.nombre).join(' · ')}</p>
          )}
          {conf.excluidas > 0 && <p className="muted small">{conf.excluidas} señales de factores apagados no se cuentan.</p>}
        </>
      )}
      {recientes.length > 0 && (
        <>
          <h4>Señales recientes</h4>
          <ul className="list list--compact senales-rec">
            {recientes.map((e, i) => (
              <li key={i}><span className={LADO[e.lado].clase}>{LADO[e.lado].texto}</span> · {etiquetaEvento(e)} <span className="muted">· {e.texto} · {fmtDate(e.time * 1000)}</span></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Indicadores({ estado, resumen, evalIndicadores }) {
  const iv = metrica(evalIndicadores?.metricas, 'iv_promedio');
  const ivHv = metrica(evalIndicadores?.metricas, 'iv_hv_ratio');
  const por = id => estado.find(s => s.id === id);
  const fila = (clave, nombre, valor, sen, nota) => (
    <li key={clave} className="ind">
      <span className="ind__n">{nombre}</span>
      {sen && <Chip dir={sen.direccion} />}
      <strong className="ind__v">{valor}</strong>
      {(sen?.detalle || nota) && <span className="muted small ind__d">{sen?.detalle || nota}</span>}
    </li>
  );
  const f = (v, d = 2) => (isNum(v) ? fmtFixed(v, d) : '—');
  return (
    <section className="card" aria-labelledby="ind-titulo">
      <div className="card__header"><h3 id="ind-titulo">Indicadores</h3><span className="muted small">Velas diarias almacenadas. «Informativo»: describe sobrecompra o sobreventa, sin dar dirección.</span></div>
      <ul className="ind-grid">
        {fila('rsi', 'RSI (14)', f(resumen.rsi, 1), por('rsi'))}
        {fila('macd', 'MACD (12/26/9)', `${f(resumen.macd, 3)} · señal ${f(resumen.macdSenal, 3)} · hist ${f(resumen.macdHist, 3)}`, por('macd'))}
        {fila('est', 'Estocástico (14,3)', `%K ${f(resumen.estocasticoK, 1)} · %D ${f(resumen.estocasticoD, 1)}`, por('estocastico'))}
        {fila('boll', 'Bollinger (20, 2)', `${f(resumen.bollingerInf)} – ${f(resumen.bollingerSup)} · %B ${f(resumen.bollingerPctB)}`, por('bollinger'))}
        {fila('atr', 'ATR (14)', `${f(resumen.atr)} (${f(resumen.atrPct, 1)} % del precio)`, null, 'Volatilidad diaria típica')}
        {fila('hv', <><Termino id="hv">HV</Termino> 20 / 60 días</>, `${isNum(resumen.hv20) ? fmtPct(resumen.hv20, 1) : '—'} / ${isNum(resumen.hv60) ? fmtPct(resumen.hv60, 1) : '—'}`, null, 'Volatilidad histórica anualizada')}
        {fila('iv', <><Termino id="iv">IV</Termino> promedio</>, isNum(iv) ? fmtPct(iv, 1) : '—', null, isNum(iv) ? (isNum(ivHv) ? `IV/HV20 = ${fmtNum(ivHv, 2)}` : '') : 'Requiere el factor Indicadores y contratos de opciones')}
      </ul>
    </section>
  );
}

export default function AnalisisTecnico({ simbolo, mercado, registrada = true, velas, coresActivos, evalIndicadores, onCambio }) {
  const { diarias } = velas;
  const calc = useMemo(() => ({
    niveles: soportesResistencias(diarias),
    eventos: eventosSenales(diarias),
    estado: estadoSenales(diarias),
    resumen: resumenIndicadores(diarias),
  }), [diarias]);
  const eventosActivos = useMemo(() => calc.eventos.filter(e => coresActivos.includes(e.core)), [calc.eventos, coresActivos]);
  const eventosGrafica = useMemo(() => eventosActivos.filter(e => e.lado !== 'info'), [eventosActivos]); // los marcadores son solo compra/venta
  const conf = useMemo(() => confluencia(calc.estado, coresActivos), [calc.estado, coresActivos]);
  return (
    <div className="stack">
      <section className="card" aria-labelledby="graf-titulo">
        <div className="card__header"><h2 id="graf-titulo">Precio y señales</h2></div>
        <GraficoPanel simbolo={simbolo} mercado={mercado} registrada={registrada} diarias={diarias} loading={velas.loading} error={velas.error} onReload={velas.reload} onCambio={onCambio} niveles={calc.niveles} eventos={eventosGrafica} />
      </section>
      {diarias.length >= 20 && (
        <div className="grid grid--2">
          <Confluencia conf={conf} eventos={eventosActivos} coresActivos={coresActivos} />
          <Indicadores estado={calc.estado} resumen={calc.resumen} evalIndicadores={evalIndicadores} />
        </div>
      )}
    </div>
  );
}
