// Panel del veredicto: qué estrategia encaja, por qué, cuánto cuesta y cuánto se puede perder, y los contratos para operarla.
import { useRef } from 'react';
import { Badge } from '../../components/Badge';
import { ScoreBar } from '../../components/Gauge';
import { PayoffChart } from '../../components/PayoffChart';
import { Empty, ErrorMessage, Notice } from '../../components/States';
import { Select } from '../../components/Field';
import { Termino } from '../../components/Termino';
import BotonOperar from '../../components/BotonOperar';
import SinPrecios, { etiquetaVencimiento } from '../../components/SinPrecios';
import { participacion, encaje, razones, titular } from '../../utils/analisis';
import { NOTA_PUNTAJE, CORE_LABELS, ESTRATEGIA_LABELS } from '../../utils/constants';
import { candidatosStrike, diasHasta, mid, sinPrecios, SPREAD_AVISO, spreadPct, textoPuntaje, vencimientosVigentes } from '../../utils/estrategiasOrden';
import { fmtDate, fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';

const DIA_MS = 24 * 3600000;
const nombre = codigo => ESTRATEGIA_LABELS[codigo] || codigo;
const dinero = v => (v == null ? 'Ilimitada' : fmtMoney(v));
const pctCuenta = v => fmtPct(v, v < 0.1 ? 1 : 0);

function Razon({ tipo, children }) {
  return <li className={'veredicto__razon is-' + tipo}><span aria-hidden="true">{tipo === 'favor' ? '+' : '−'}</span><span><span className="sr-only">{tipo === 'favor' ? 'A favor: ' : 'En contra: '}</span>{children}</span></li>;
}

const Frase = ({ r }) => <><strong>{r.titulo}.</strong>{r.detalle && <> {r.detalle}</>}</>;

/** Operar con los strikes elegidos. Si la estrategia no encaja (menos de 60), el botón no es el principal. */
function Operar({ empresa, datos, pos }) {
  const { activa, op, chain, esRecomendada } = pos;
  if (!op?.patas) return <button type="button" className="btn" disabled>Operar</button>;
  return (
    <BotonOperar empresa={empresa} estrategiaCodigo={activa.codigo} datos={datos} chain={chain}
      className={'btn' + (encaje(activa.puntaje).tono === 'success' ? ' btn--primary' : '')}
      legs={op.patas.map(({ accion, intencion, contratoId }) => ({ accion, intencion, contratoId }))}
      label={`Operar ${nombre(activa.codigo)}${esRecomendada ? '' : ' con tus strikes'}`} />
  );
}

function Veredicto({ empresa, datos, pos, onContratos }) {
  const { activa, mejor, filas, detalle, op, chain, pctEfectivo } = pos;
  const e = encaje(activa.puntaje);
  const cores = datos.seleccion?.coresSeleccionados || [];
  const r = razones(activa.codigo, { cores, evaluaciones: detalle?.evaluaciones || datos.evaluaciones, pesos: detalle?.conf.ponderaciones, puntaje: activa.puntaje, motivos: activa.motivos });
  const creado = datos.seleccion?.createdAt;
  const voto = participacion(cores, detalle?.evaluaciones || datos.evaluaciones);
  const riesgo = op?.riesgo;
  const nulo = !op && pos.cargando ? <span className="skel veredicto__skel" /> : '—';
  return (
    <section className="card veredicto" aria-labelledby="veredicto-titulo">
      <div className="veredicto__estrategias" role="group" aria-label="Estrategia">
        {filas.map(f => (
          <button key={f.codigo} type="button" aria-pressed={f.codigo === activa.codigo} onClick={() => pos.elegirEstrategia(f.codigo)}>
            <span>{nombre(f.codigo)}</span><strong>{textoPuntaje(f.puntaje)}</strong>
          </button>
        ))}
      </div>
      <div className={'veredicto__cab is-' + e.tono}>
        <h2 id="veredicto-titulo" tabIndex={-1}>{titular(activa.codigo, activa.puntaje)}</h2>
        <ScoreBar value={activa.puntaje} label={'Compatibilidad de ' + nombre(activa.codigo)} />
        <p className="small nota-puntaje"><Termino id="compatibilidad">Puntaje</Termino>: {NOTA_PUNTAJE[0].toLowerCase() + NOTA_PUNTAJE.slice(1)}</p>
        <p>{e.detalle}</p>
        {voto.completo
          ? <p className="small muted">Decisión de los {voto.total} factores.</p>
          : <p className="small veredicto__parcial"><strong>Parcial: opinan {voto.opinan} de {voto.total} factores.</strong> Falta {voto.faltan.map(f => `${CORE_LABELS[f.core]} (${f.motivo})`).join(', ')}.</p>}
        {activa !== mejor && <p className="small">La mejor clasificada es {nombre(mejor.codigo)}. <button type="button" className="enlace" onClick={pos.irAMejor}>Ver {nombre(mejor.codigo)}</button></p>}
        {activa === mejor && e.tono !== 'success' && <p className="small">Ninguna estrategia encaja bien por ahora. No operar también es una opción.</p>}
      </div>
      <ul className="veredicto__razones">
        {r.favor.map(x => <Razon key={x.titulo} tipo="favor"><Frase r={x} /></Razon>)}
        {!r.favor.length && <Razon tipo="favor">Ningún factor la apoya con claridad.</Razon>}
        {r.contra ? <Razon tipo="contra"><Frase r={r.contra} /></Razon> : <Razon tipo="contra">Ningún factor va claramente en contra.</Razon>}
      </ul>
      {r.contradiccion && <p className="veredicto__choque"><strong>Los factores se contradicen:</strong> {r.contradiccion}. Por eso la <Termino id="confianza">confianza</Termino> baja.</p>}
      <dl className="veredicto__cifras">
        <div><dt><Termino id="confianza">Confianza</Termino></dt><dd>{detalle?.est ? fmtPct(detalle.est.confianza) : '—'}</dd></div>
        <div><dt><Termino id="vencimiento">Vencimiento</Termino></dt><dd>{chain?.vencimiento ? <>{fmtDate(chain.vencimiento)}<small>{diasHasta(chain.vencimiento)} días</small></> : nulo}</dd></div>
        <div><dt>{op?.credito ? <Termino id="credito">Cobras al abrir</Termino> : <Termino id="debito">Cuesta</Termino>}</dt><dd>{isNum(op?.precioNeto) ? <>{fmtMoney(op.precioNeto * 100)}<small>1 contrato</small></> : nulo}</dd></div>
        <div><dt>Pérdida máxima</dt><dd>{riesgo ? <><span className="down">{dinero(riesgo.maxPerdida)}</span><small>{isNum(pctEfectivo) ? `${pctCuenta(pctEfectivo)} de tu efectivo simulado` : 'por contrato'}</small></> : nulo}</dd></div>
      </dl>
      <div className="veredicto__acciones">
        <Operar empresa={empresa} datos={datos} pos={pos} />
        <button type="button" className="btn" onClick={onContratos}>Ver contratos</button>
      </div>
      {creado && Date.now() - Date.parse(creado) > DIA_MS && <Notice tone="warning">Este análisis tiene más de 24 horas. Vuelve a analizar para actualizarlo.</Notice>}
      <p className="muted small veredicto__nota">Lectura educativa del {fmtDateTime(creado)}, con datos guardados. No es una recomendación: tú decides.</p>
    </section>
  );
}

/** Una pata: strike y lo que hay que mirar de ese contrato. */
function Pata({ rol, pos }) {
  const { chain, sel, elegir } = pos;
  const cands = candidatosStrike(rol, chain.items, chain.precioSubyacente, sel);
  const it = sel[rol.clave];
  const c = cands.find(x => x.item.contratoId === it?.contratoId);
  const sp = spreadPct(it);
  const opcion = x => ({ value: x.item.contratoId, label: `${fmtFixed(x.item.strike, 2)}, prima ${isNum(mid(x.item)) ? fmtFixed(mid(x.item), 2) : 'sin precio'}` });
  const grupo = (titulo, lista) => lista.length > 0 && <optgroup label={titulo}>{lista.map(x => { const o = opcion(x); return <option key={o.value} value={o.value}>{o.label}</option>; })}</optgroup>;
  const buenos = cands.filter(x => x.recomendable).slice(0, 3);
  const resto = cands.filter(x => !buenos.includes(x)).sort((a, b) => a.item.strike - b.item.strike);
  const etiqueta = rol.etiqueta.replace(/^(Comprar|Vender) /, '');
  return (
    <fieldset className="pata">
      <legend><Badge tone={rol.accion === 'sell' ? 'warning' : 'info'}>{rol.accion === 'sell' ? 'Vender' : 'Comprar'}</Badge> {etiqueta}</legend>
      {cands.length ? (
        <select value={it?.contratoId || ''} onChange={e => elegir(rol.clave, cands.find(x => x.item.contratoId === e.target.value).item)} aria-label={`Strike: ${rol.etiqueta}`}>
          {!it && <option value="">Elige…</option>}
          {grupo('Recomendado', buenos.slice(0, 1))}
          {grupo('También adecuados', buenos.slice(1))}
          {grupo('Otros strikes', resto)}
        </select>
      ) : <p className="small aviso-texto">No hay strikes válidos para esta pata en este vencimiento.</p>}
      {it && (
        <dl className="pata__datos">
          <div><dt><Termino id="prima">Prima</Termino></dt><dd>{isNum(mid(it)) ? fmtFixed(mid(it), 2) : '—'}</dd></div>
          <div><dt><Termino id="delta">Delta</Termino></dt><dd>{isNum(it.griegas?.delta) ? fmtFixed(it.griegas.delta, 2) : '—'}</dd></div>
          <div><dt><Termino id="iv">IV</Termino></dt><dd>{isNum(it.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 0) : '—'}</dd></div>
          <div><dt><Termino id="spread">Spread</Termino></dt><dd className={sp > SPREAD_AVISO ? 'aviso-texto' : undefined}>{isNum(sp) ? fmtPct(sp, 0) : '—'}</dd></div>
        </dl>
      )}
      {c && <p className="muted small">Idoneidad {c.idoneidad} de 100. {c.motivo}.</p>}
    </fieldset>
  );
}

function Contratos({ empresa, datos, pos, config, onComparar }) {
  const { chain, op, roles, error, cargando } = pos;
  const vencs = vencimientosVigentes(chain?.vencimientos);
  const dias = chain?.vencimiento ? diasHasta(chain.vencimiento) : null;
  const fueraRango = isNum(dias) && (dias < config.diasMin || dias > config.diasMax);
  return (
    <section className="card contratos" aria-labelledby="contratos-titulo">
      <div className="section-head">
        <h3 id="contratos-titulo" tabIndex={-1}>Contratos</h3>
        {chain && roles.length > 0 && <button type="button" className="btn btn--sm" onClick={onComparar}>Comparar strikes</button>}
      </div>
      {!chain && cargando && <span className="skel contratos__skel" role="status" aria-label="Buscando contratos" />}
      {error && (error.status === 404
        ? <Notice tone="warning" title="Sin contratos de opciones.">Activa «Traer contratos de opciones» en la configuración y vuelve a analizar.</Notice>
        : <ErrorMessage error={error} onRetry={pos.recargar} title="No se pudieron cargar los contratos" />)}
      {chain && (
        <>
          {vencs.length > 0 && (
            <label className="field"><span className="field__label">Vencimiento</span>
              <Select value={chain.vencimiento || ''} onChange={pos.cambiarVencimiento} options={vencs.map(v => ({ value: v, label: etiquetaVencimiento(v, chain.detalleVencimientos) }))} />
            </label>
          )}
          <SinPrecios chain={chain} onCambiar={pos.cambiarVencimiento} />
          {fueraRango && <Notice tone="warning">Vence en {dias} días, fuera de tu rango ({config.diasMin}–{config.diasMax}). Amplía el rango y vuelve a analizar.</Notice>}
          {pos.aviso && <Notice>{pos.aviso}</Notice>}
          {op?.error && <Notice tone="warning" title="No se pudo armar la estrategia.">{op.error} Activa «Traer contratos de opciones» y vuelve a analizar.</Notice>}
          {!op?.error && <div className="patas">{roles.map(r => <Pata key={r.clave} rol={r} pos={pos} />)}</div>}
          {!op?.error && !pos.esRecomendada && <button type="button" className="btn btn--sm" onClick={pos.restablecer}>Volver a los recomendados</button>}
          {op?.invalidos && <Notice tone="warning" title="Revisa los strikes.">{op.invalidos.join(' ')}</Notice>}
          {op?.patas && (
            <>
              {op.riesgo && op.riesgo.maxPerdida == null && <Notice tone="danger" title="Pérdida ilimitada.">Esta combinación no tiene tope de pérdida.</Notice>}
              {op.liq.sinCotizacion > 0 && !sinPrecios(chain.items) && <Notice tone="warning">{op.liq.sinCotizacion} {op.liq.sinCotizacion === 1 ? 'pata no tiene' : 'patas no tienen'} cotización válida{op.payoff ? '; se usa el último precio operado, que puede estar desfasado' : ': no se calculan ganancia, pérdida ni gráfica'}.</Notice>}
              {op.liq.fueraDeHorario && <Notice tone="warning">Cotización tomada fuera de horario, con mucha distancia entre compra y venta: se usa el último precio operado. Se actualiza con el mercado abierto.</Notice>}
              {op.liq.avisar && !op.liq.fueraDeHorario && <Notice tone="warning">Spread de hasta {fmtPct(op.liq.peorSpread, 0)} del precio{op.liq.insuficiente ? ': sin liquidez suficiente' : ''}.</Notice>}
              <dl className="veredicto__cifras">
                <div><dt>Ganancia máxima</dt><dd>{op.riesgo ? dinero(op.riesgo.maxGanancia) : '—'}</dd></div>
                <div><dt><Termino id="breakeven">{op.riesgo?.breakevens.length > 1 ? 'Puntos de equilibrio' : 'Punto de equilibrio'}</Termino></dt><dd>{op.riesgo?.breakevens.map(b => fmtMoney(b)).join(' / ') || '—'}</dd></div>
              </dl>
              {op.payoff && <PayoffChart analysis={op.payoff} spot={chain.precioSubyacente} movimiento={op.movimiento} />}
              <Operar empresa={empresa} datos={datos} pos={pos} />
              <p className="muted small">Prima: punto medio entre compra y venta{op.edad ? `, ${op.edad.texto}` : ', sin fecha'}. El precio real puede variar.{isNum(op.costo) ? ` Cruzar el spread costaría ${fmtMoney(op.costo)} al entrar.` : ''}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default function PanelEstrategias({ empresa, datos, cargando, error, onReload, pos, config, trabajo, onComparar }) {
  const contratos = useRef(null);
  const verContratos = () => {
    const h = contratos.current?.querySelector('#contratos-titulo');
    const panel = h?.closest('.panel');
    // En dos columnas el panel tiene su propio desplazamiento: la página no se mueve.
    if (panel && panel.scrollHeight > panel.clientHeight + 1) panel.scrollTop += h.closest('section').getBoundingClientRect().top - panel.getBoundingClientRect().top;
    else h?.scrollIntoView({ block: 'start' });
    h?.focus({ preventScroll: true });
  };
  if (error && !datos) return <ErrorMessage error={error} onRetry={onReload} title="No se pudo cargar el análisis" />;
  if (cargando && !datos) return <section className="card veredicto veredicto--carga" aria-busy="true" aria-label="Cargando el veredicto"><span className="skel" /><span className="skel" /><span className="skel" /></section>;
  if (!pos.activa) {
    return (
      <section className="card veredicto" aria-labelledby="veredicto-titulo">
        <h2 id="veredicto-titulo" tabIndex={-1}>{trabajo === 'analisis' ? 'Analizando' : 'Todavía sin veredicto'}</h2>
        <Empty title={trabajo === 'analisis' ? 'Esto tarda unos segundos' : trabajo ? 'Están llegando los datos' : 'Pulsa «Analizar»'}>Aquí verás qué estrategia encaja mejor, por qué, cuánto cuesta y cuánto podrías perder.</Empty>
      </section>
    );
  }
  return (
    <div ref={contratos} className="panel__cuerpo">
      <Veredicto empresa={empresa} datos={datos} pos={pos} onContratos={verContratos} />
      <Contratos empresa={empresa} datos={datos} pos={pos} config={config} onComparar={onComparar} />
    </div>
  );
}
