// Resultado del análisis: pestañas por estrategia con compatibilidad, panel operativo (contratos sugeridos con
// strike, vencimiento, días, prima y griegas), payoff, desglose por core y veredicto. Solo muestra los cores analizados.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '../../components/Tabs';
import { Badge } from '../../components/Badge';
import { ScoreBar } from '../../components/Gauge';
import { PayoffChart, analyzePayoff } from '../../components/PayoffChart';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { Select } from '../../components/Field';
import BotonOperar, { cargarCadena, cargarConfluencia } from '../../components/BotonOperar';
import { useAsync } from '../../hooks/useAsync';
import { useBroker } from '../../context/BrokerContext';
import { mercado } from '../../api/resources';
import { CORE_LABELS, ESTRATEGIA_LABELS } from '../../utils/constants';
import {
  antiguedadCotizacion, candidatosStrike, costoSpread, desglosePuntaje, diasHasta, direccion, intencionPara, liquidez, mid, netoMid, perfilRiesgo, reconstruirPatas,
  redondearPrecio, rolesEstrategia, seleccionRecomendada, signoNeto, SPREAD_AVISO, spreadPct, textoPuntaje, validarSeleccion, vencimientosVigentes, veredicto,
} from '../../utils/estrategiasOrden';
import { fmtDate, fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';

const pts = (v, signo = false) => (isNum(v) ? (signo && v > 0 ? '+' : '') + textoPuntaje(v) : '—');

/** Puntos por core más los ajustes de la confluencia: la columna «Puntos» suma exactamente el puntaje final. */
function Desglose({ fila, datos, detalle, config }) {
  const cores = datos.seleccion?.coresSeleccionados || [];
  const condor = fila.codigo === 'IRON_CONDOR';
  const d = desglosePuntaje(fila.codigo, cores, detalle?.conf.ponderaciones, detalle?.evaluaciones || datos.evaluaciones, fila.puntaje, fila.motivos);
  const ajuste = (nombre, nota, valor) => (
    <tr className="desglose-ajuste"><th scope="row">{nombre}</th><td colSpan="3" className="muted small">{nota}</td><td className="num">{pts(valor, true)}</td><td /></tr>
  );
  return (
    <div className="table-wrap">
      <table className="table table--dense">
        <caption className="sr-only">Desglose por core</caption>
        <thead><tr><th scope="col">Core</th><th scope="col">Lectura</th><th scope="col" className="num">Calificación</th><th scope="col" className="num">Importancia</th><th scope="col" className="num">Puntos</th><th scope="col"><span className="sr-only">Barra</span></th></tr></thead>
        <tbody>
          {d.filas.map(f => {
            const dir = direccion(f.ev?.puntaje);
            return (
              <tr key={f.core}>
                <th scope="row">{CORE_LABELS[f.core]}</th>
                <td>{f.ev ? <span className={'dir dir--' + dir.tono}>{dir.texto}</span> : <span className="muted">Sin evaluación</span>}</td>
                <td className="num">{textoPuntaje(f.calif)}</td>
                <td className="num">{isNum(f.peso) ? fmtPct(f.peso, 0) : '—'}</td>
                <td className="num">{pts(f.puntos)}</td>
                <td className="desglose-barra"><ScoreBar value={f.calif} label={'Calificación de ' + CORE_LABELS[f.core]} /></td>
              </tr>
            );
          })}
        </tbody>
        {d.subtotal != null && (
          <tfoot>
            <tr><th scope="row" colSpan="4">Suma de los cores</th><td className="num">{pts(d.subtotal)}</td><td /></tr>
            {condor
              ? ajuste('Dispersión', 'No se descuenta: el Iron Condor promedia la neutralidad de cada core.', 0)
              : ajuste('Dispersión', detalle?.est ? `Descuento por desacuerdo entre cores (dispersión ${detalle.est.dispersion.toFixed(2)}): acerca el puntaje a 50.` : 'Descuento por desacuerdo entre cores: acerca el puntaje a 50.', d.dispersion)}
            {ajuste('Ajuste IV/HV', condor ? (d.motivoIv ? `${d.motivoIv}; máximo ±15 puntos, sin pasar de 0–100.` : 'Sin datos de IV/HV.') : 'Solo aplica al Iron Condor.', condor ? d.ajusteIv : 0)}
            <tr className="desglose-total"><th scope="row" colSpan="4">Puntaje final</th><td className="num"><strong>{pts(d.final)}</strong></td><td /></tr>
          </tfoot>
        )}
      </table>
      <p className="muted small">Calificación: qué tan favorable es la lectura del core para esta estrategia. Importancia: peso efectivo (peso × confianza). Puntos: calificación × importancia. Pesos configurados: {cores.map(c => `${CORE_LABELS[c]} ${config.cores[c]?.peso ?? 1}`).join(' · ')}.</p>
    </div>
  );
}

/** Posición del strike respecto al subyacente: ITM / ATM / OTM. */
function dinero(item, precio) {
  if (!isNum(precio) || !isNum(item?.strike)) return null;
  if (Math.abs(item.strike - precio) / precio < 0.01) return { txt: 'ATM', titulo: 'En el dinero' };
  const itm = item.tipo === 'call' ? item.strike < precio : item.strike > precio;
  return itm ? { txt: 'ITM', titulo: 'Dentro del dinero' } : { txt: 'OTM', titulo: 'Fuera del dinero' };
}

const VISIBLES = 5;

/** Tabla de strikes de un rol: recomendado (★), idóneos (top 3) y, a petición, todos los demás. */
function TablaStrikes({ rol, cands, elegido, precio, onElegir, nombreGrupo }) {
  const [todos, setTodos] = useState(false);
  const rango = new Map(cands.map((c, i) => [c.item.contratoId, i]));
  let visibles = todos ? cands : cands.slice(0, VISIBLES);
  if (!todos && elegido && !visibles.some(c => c.item.contratoId === elegido.contratoId)) {
    const c = cands.find(x => x.item.contratoId === elegido.contratoId);
    if (c) visibles = [...visibles, c];
  }
  visibles = [...visibles].sort((a, b) => a.item.strike - b.item.strike);
  const sinLiquidez = cands.length > 0 && !cands[0].recomendable;
  const tituloId = nombreGrupo + '-t';
  return (
    <fieldset className="strikes">
      <legend id={tituloId}><Badge value={rol.accion === 'sell' ? 'Vender' : 'Comprar'} tone={rol.accion === 'sell' ? 'warning' : 'info'} /> {rol.etiqueta.replace(/^(Comprar|Vender) /, '')}</legend>
      <p className="muted small strikes__ayuda">{rol.ayuda}</p>
      {sinLiquidez && <p className="small down">Sin recomendación: sin liquidez suficiente (ningún strike adecuado tiene cotización con spread de 25 % o menos).</p>}
      {!cands.length ? <p className="small down">No hay strikes válidos para esta pata en el vencimiento elegido.</p> : (
        <div className="table-wrap">
          <table className="table table--dense strikes__tabla" aria-labelledby={tituloId}>
            <thead><tr><th scope="col"><span className="sr-only">Elegir</span></th><th scope="col" className="num">Strike</th><th scope="col">Dinero</th><th scope="col" className="num">Δ</th><th scope="col" className="num">Prima</th><th scope="col" className="num">Spread</th><th scope="col" className="num">IV</th><th scope="col">Idoneidad</th></tr></thead>
            <tbody>
              {visibles.map(c => {
                const it = c.item;
                const pos = rango.get(it.contratoId);
                const sel = elegido?.contratoId === it.contratoId;
                const d = dinero(it, precio);
                const sp = spreadPct(it);
                const id = `${nombreGrupo}-${it.contratoId}`;
                return (
                  <tr key={it.contratoId} className={'strikes__fila' + (sel ? ' is-sel' : '') + (pos === 0 && c.recomendable ? ' is-rec' : '')} onClick={() => onElegir(it)}>
                    <td><input type="radio" id={id} name={nombreGrupo} checked={sel} onChange={() => onElegir(it)} aria-label={`Strike ${fmtFixed(it.strike, 2)}${pos === 0 && c.recomendable ? ', recomendado' : ''}`} /></td>
                    <td className="num"><label htmlFor={id}><strong>{fmtFixed(it.strike, 2)}</strong></label></td>
                    <td>{d ? <abbr title={d.titulo}>{d.txt}</abbr> : '—'}</td>
                    <td className="num">{isNum(it.griegas?.delta) ? fmtFixed(it.griegas.delta, 2) : '—'}</td>
                    <td className="num">{isNum(mid(it)) ? fmtFixed(mid(it), 2) : '—'}</td>
                    <td className={'num' + (isNum(sp) && sp > SPREAD_AVISO ? ' down' : '')}>{isNum(sp) ? fmtPct(sp, 0) : '—'}</td>
                    <td className="num">{isNum(it.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 1) : '—'}</td>
                    <td className="strikes__idon" title={c.motivo}>
                      {!c.recomendable ? null : pos === 0 ? <Badge tone="success">★ Recomendado</Badge> : pos < 3 ? <Badge tone="info">Idóneo</Badge> : null}
                      <span className="muted small"> {c.idoneidad}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cands.length > VISIBLES && (
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={todos} onClick={() => setTodos(t => !t)}>
          {todos ? 'Mostrar solo los más idóneos' : `Ver los ${cands.length} strikes disponibles`}
        </button>
      )}
    </fieldset>
  );
}

function Operativo({ empresa, fila, datos, chain, onVencimiento, config, previa, onSel }) {
  const { nombre, entorno } = useBroker();
  const items = chain?.items || [];
  const precio = chain?.precioSubyacente;
  const roles = useMemo(() => rolesEstrategia(fila.codigo), [fila.codigo]);
  const recomendada = useMemo(() => seleccionRecomendada(fila.codigo, items, precio), [fila.codigo, items, precio]);
  // Al cambiar de vencimiento se conservan los strikes elegidos (los más cercanos) y se avisa al usuario.
  const [inicial] = useState(() => {
    if (!previa || previa.codigo !== fila.codigo || previa.vencimiento === chain.vencimiento || !roles.every(r => previa.sel[r.clave])) return { sel: recomendada };
    const r = reconstruirPatas(fila.codigo, roles.map(x => ({ accion: x.accion, item: previa.sel[x.clave] })), items, precio);
    if (r.error) return { sel: recomendada, aviso: r.error };
    return { sel: Object.fromEntries(roles.map((x, i) => [x.clave, items.find(it => it.contratoId === r.legs[i].contratoId)])), aviso: r.aviso };
  });
  const [elegida, setSel] = useState(inicial.sel);
  // Tras actualizar la cadena se usan las cotizaciones nuevas del mismo contrato, no las guardadas al elegir.
  const sel = useMemo(() => Object.fromEntries(Object.entries(elegida).map(([k, it]) => [k, items.find(i => i.contratoId === it?.contratoId)])), [elegida, items]);
  useEffect(() => { onSel({ codigo: fila.codigo, vencimiento: chain.vencimiento, sel }); }, [sel, fila.codigo, chain.vencimiento]); // eslint-disable-line react-hooks/exhaustive-deps
  const esRecomendada = roles.every(r => sel[r.clave]?.contratoId === recomendada[r.clave]?.contratoId);

  // Al cambiar una pata vendida, su ala protectora se reajusta si queda del lado incorrecto.
  const elegir = (clave, item) => setSel(prev => {
    const next = { ...prev, [clave]: item };
    for (const r of roles) {
      if (r.ala?.de !== clave) continue;
      const ala = next[r.clave];
      const valida = ala && (r.ala.dir < 0 ? ala.strike < item.strike : ala.strike > item.strike);
      if (!valida) next[r.clave] = candidatosStrike(r, items, precio, next)[0]?.item;
    }
    return next;
  });

  const op = useMemo(() => {
    if (!chain) return null;
    if (!roles.length) return { error: 'Estrategia sin armado automático: ' + fila.codigo };
    if (!items.some(i => i.contratoId && isNum(i.strike))) return { error: 'La cadena no tiene contratos disponibles.' };
    if (!isNum(precio)) return { error: 'No hay precio del subyacente para armar la estrategia.' };
    const invalidos = validarSeleccion(fila.codigo, sel);
    if (invalidos.length) return { invalidos };
    const patas = roles.map(r => ({ accion: r.accion, intencion: intencionPara(r.accion), contratoId: sel[r.clave].contratoId, item: sel[r.clave] }));
    const neto = netoMid(patas);
    const credito = signoNeto(patas, neto) === 'credito';
    const precioNeto = isNum(neto) ? redondearPrecio(neto) : null;
    const riesgo = isNum(precioNeto) ? perfilRiesgo(patas, precioNeto, credito, 1) : null;
    const payoff = analyzePayoff(patas.map(p => ({ tipo: p.item.tipo, strike: p.item.strike, accion: p.accion, cantidad: 1, multiplicador: 100, prima: mid(p.item) })));
    return { patas, neto, credito, precioNeto, riesgo, payoff, liq: liquidez(patas), costo: costoSpread(patas), edad: antiguedadCotizacion(patas) };
  }, [chain, items, precio, roles, sel, fila.codigo]);

  if (!chain) return null;
  const vencs = vencimientosVigentes(chain.vencimientos);
  const venc = chain.vencimiento;
  const dte = venc ? diasHasta(venc) : null;
  const hoy = new Date();
  const fueraRango = isNum(dte) && (dte < config.diasMin || dte > config.diasMax);

  return (
    <div className="stack">
      <dl className="stats stats--row">
        <div><dt>Empresa</dt><dd>{empresa.simbolo}</dd></div>
        <div><dt>Estrategia</dt><dd>{ESTRATEGIA_LABELS[fila.codigo] || fila.codigo}</dd></div>
        <div><dt>Subyacente</dt><dd>{fmtMoney(chain.precioSubyacente)}</dd></div>
        <div><dt>Contratos</dt><dd>1 (×100 acciones)</dd></div>
        <div><dt>Inicio</dt><dd>{fmtDate(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()))}</dd></div>
        <div><dt>Fin (vencimiento)</dt><dd>{venc ? `${fmtDate(venc)} · ${dte} días` : '—'}</dd></div>
      </dl>
      {vencs.length > 1 && (
        <label className="toolbar__filter"><span className="muted">Vencimiento </span>
          <Select value={venc || ''} onChange={onVencimiento} options={vencs.map(v => ({ value: v, label: `${v} (${diasHasta(v)} d)` }))} aria-label="Vencimiento de los contratos sugeridos" />
        </label>
      )}
      {fueraRango && <Notice tone="warning">El vencimiento disponible ({dte} días) queda fuera del rango configurado ({config.diasMin}–{config.diasMax}). Amplía el rango y sincroniza contratos.</Notice>}
      {inicial.aviso && <Notice>{inicial.aviso}</Notice>}
      {op?.error && <Notice tone="warning" title="No se pudieron sugerir contratos.">{op.error} Activa «Traer contratos de opciones» en la configuración y vuelve a analizar.</Notice>}
      {!op?.error && roles.length > 0 && (
        <section className="stack" aria-labelledby="strikes-titulo">
          <div className="strikes__head">
            <div>
              <h3 id="strikes-titulo">Elige los strikes</h3>
              <p className="muted small">Ordenados por idoneidad (ajuste a la estrategia 70 % + liquidez 30 %). ★ = recomendado; «Idóneo» = alternativas cercanas. Puedes elegir cualquier otro.</p>
            </div>
            {!esRecomendada && <button type="button" className="btn btn--sm" onClick={() => setSel(recomendada)}>Restablecer recomendados</button>}
          </div>
          <div className={'strikes-grid' + (roles.length > 1 ? ' strikes-grid--2' : '')}>
            {roles.map(r => (
              <TablaStrikes key={r.clave} rol={r} nombreGrupo={`strike-${fila.codigo}-${r.clave}`} precio={precio}
                cands={candidatosStrike(r, items, precio, sel)} elegido={sel[r.clave]} onElegir={it => elegir(r.clave, it)} />
            ))}
          </div>
          {op?.invalidos?.length > 0 && <Notice tone="warning" title="Revisa la selección.">{op.invalidos.join(' ')}</Notice>}
        </section>
      )}
      {op && !op.error && !op.invalidos && (
        <>
          <h3>Tu posición</h3>
          <div className="table-wrap">
            <table className="table table--dense">
              <caption className="sr-only">Contratos elegidos</caption>
              <thead><tr><th scope="col">Acción</th><th scope="col">Tipo</th><th scope="col" className="num">Strike</th><th scope="col">Vence</th><th scope="col" className="num">Días</th><th scope="col" className="num">Prima</th><th scope="col" className="num">Delta</th><th scope="col" className="num">Theta</th><th scope="col" className="num">IV</th></tr></thead>
              <tbody>
                {op.patas.map((p, i) => (
                  <tr key={i}>
                    <td><Badge value={p.accion === 'sell' ? 'Vender' : 'Comprar'} tone={p.accion === 'sell' ? 'warning' : 'info'} /></td>
                    <td>{p.item?.tipo === 'put' ? 'Put' : 'Call'}</td>
                    <td className="num">{fmtFixed(p.item?.strike, 2)}</td>
                    <td>{fmtDate(p.item?.vencimiento)}</td>
                    <td className="num">{p.item?.vencimiento ? diasHasta(p.item.vencimiento) : '—'}</td>
                    <td className="num">{isNum(mid(p.item)) ? fmtFixed(mid(p.item), 2) : '—'}</td>
                    <td className="num">{isNum(p.item?.griegas?.delta) ? fmtFixed(p.item.griegas.delta, 3) : '—'}</td>
                    <td className="num">{isNum(p.item?.griegas?.theta) ? fmtFixed(p.item.griegas.theta, 3) : '—'}</td>
                    <td className="num">{isNum(p.item?.volatilidadImplicita) ? fmtPct(p.item.volatilidadImplicita, 1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="stats stats--row">
            <div><dt>{op.credito ? 'Crédito neto' : 'Débito neto'}</dt><dd>{isNum(op.precioNeto) ? fmtMoney(op.precioNeto * 100) : '—'}</dd></div>
            <div><dt>Ganancia máx.</dt><dd>{op.riesgo ? (op.riesgo.maxGanancia == null ? 'Ilimitada' : fmtMoney(op.riesgo.maxGanancia)) : '—'}</dd></div>
            <div><dt>Pérdida máx.</dt><dd className="down">{op.riesgo ? (op.riesgo.maxPerdida == null ? 'Ilimitada' : fmtMoney(op.riesgo.maxPerdida)) : '—'}</dd></div>
            <div><dt>Breakeven</dt><dd>{op.riesgo ? op.riesgo.breakevens.map(b => fmtMoney(b)).join(' / ') || 'Ninguno' : '—'}</dd></div>
          </dl>
          {op.riesgo && op.riesgo.maxPerdida == null && <Notice tone="danger" title="Pérdida ilimitada.">Esta combinación no tiene tope de pérdida.</Notice>}
          {op.liq.sinCotizacion > 0 && <Notice tone="warning">{op.liq.sinCotizacion} {op.liq.sinCotizacion === 1 ? 'pata no tiene' : 'patas no tienen'} cotización bid/ask válida{op.payoff ? '; se usa el último precio operado, que puede estar desfasado' : ': no se calculan ganancia, pérdida ni gráfica'}.</Notice>}
          {op.liq.avisar && <Notice tone="warning">Spread de hasta {fmtPct(op.liq.peorSpread, 0)} del precio{op.liq.insuficiente ? ': sin liquidez suficiente' : ''}.</Notice>}
          {op.payoff && <PayoffChart analysis={op.payoff} spot={chain.precioSubyacente} />}
          <p className="muted small">Prima = punto medio bid/ask del último snapshot almacenado{op.edad ? ` (cotización ${op.edad.texto}, ${fmtDateTime(op.edad.fecha)})` : ' (sin fecha de cotización)'}; los precios reales pueden variar.{isNum(op.costo) ? ` Cruzar el spread costaría ${fmtMoney(op.costo)} al entrar.` : ''}</p>
          <BotonOperar empresa={empresa} estrategiaCodigo={fila.codigo} datos={datos} chain={chain}
            legs={op.patas.map(({ accion, intencion, contratoId }) => ({ accion, intencion, contratoId }))}
            label={`Operar ${ESTRATEGIA_LABELS[fila.codigo]} en ${nombre} · ${entorno}${esRecomendada ? '' : ' (strikes elegidos)'}`} />
        </>
      )}
    </div>
  );
}

export default function PanelEstrategias({ empresa, simbolo, datos, cargando, error, onReload, config, version, estrategiaInicial }) {
  const [tab, setTab] = useState(null);
  const [venc, setVenc] = useState('');
  const previa = useRef(null); // última selección de strikes, para conservarla al cambiar de vencimiento
  const filas = useMemo(() => {
    const est = datos?.estrategiasById;
    return (datos?.seleccion?.resultados || [])
      .map(r => ({ ...r, codigo: est?.get(r.estrategiaId)?.codigo }))
      .filter(r => r.codigo)
      .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
  }, [datos]);
  const activa = filas.find(f => f.codigo === tab) || filas.find(f => f.codigo === estrategiaInicial) || filas[0];

  // La cadena se etiqueta con la estrategia que la pidió: al cambiar de pestaña o empresa no se arma nada con el vencimiento de la anterior.
  const cargada = useAsync(() => (venc ? mercado.opcionesResumen(simbolo, { vencimiento: venc }) : cargarCadena(simbolo, { diasMin: config.diasMin, diasMax: config.diasMax, codigo: activa.codigo })).then(d => ({ codigo: activa.codigo, simbolo, d })),
    [simbolo, version, venc, activa?.codigo, config.diasMin, config.diasMax], { enabled: !!activa });
  const detalle = useAsync(() => cargarConfluencia(activa.confluenciaId, datos.seleccion?.ponderaciones), [activa?.confluenciaId], { enabled: !!activa?.confluenciaId });
  const chain = { ...cargada, data: cargada.data?.codigo === activa?.codigo && cargada.data?.simbolo === simbolo ? cargada.data?.d : undefined };
  const det = detalle.data?.conf._id === activa?.confluenciaId ? detalle.data : null;
  const est = det?.est;
  useEffect(() => { previa.current = null; setVenc(''); }, [simbolo]);

  if (cargando && !datos) return <Loading text="Cargando último análisis…" />;
  if (error && !datos) return <ErrorMessage error={error} onRetry={onReload} />;
  if (!datos) return null;
  if (!filas.length) {
    return <section className="card"><Empty title="Aún no hay análisis de estrategias">Configura los cores y pulsa «Analizar» para obtener la compatibilidad de Long Call, Long Put e Iron Condor.</Empty></section>;
  }
  const v = veredicto(activa.puntaje);
  const antiguo = datos.seleccion?.createdAt && Date.now() - Date.parse(datos.seleccion.createdAt) > 24 * 3600000;
  const tabs = filas.map(f => ({ value: f.codigo, label: `${ESTRATEGIA_LABELS[f.codigo] || f.codigo} · ${veredicto(f.puntaje).texto} · ${textoPuntaje(f.puntaje)}` }));

  return (
    <section className="card" aria-labelledby="estr-titulo">
      <div className="card__header">
        <div><h2 id="estr-titulo">Estrategias sugeridas</h2>
          <p className="muted small">Calculado {fmtDateTime(datos.seleccion?.createdAt)} con: {(datos.seleccion?.coresSeleccionados || []).map(c => CORE_LABELS[c]).join(', ')}.</p></div>
      </div>
      {antiguo && <Notice tone="warning">El análisis tiene más de 24 horas; vuelve a analizar para actualizarlo.</Notice>}
      <Tabs tabs={tabs} value={activa.codigo} onChange={t => { setTab(t); }} label="Estrategias" />
      <div role="tabpanel" className="tabpanel estr-panel">
        <div className="estr-main">
          {chain.loading && !chain.data && <Loading text="Buscando contratos sugeridos…" />}
          {chain.error && !chain.data && (chain.error.status === 404
            ? <Notice tone="warning" title="Sin contratos de opciones.">Sincroniza los contratos (opción «Traer contratos de opciones» y Analizar) para ver strikes, vencimiento y prima.</Notice>
            : <ErrorMessage error={chain.error} onRetry={chain.reload} title="No se pudo cargar la cadena de opciones" />)}
          {chain.data && <Operativo key={activa.codigo + '|' + (chain.data.vencimiento || '')} empresa={empresa} fila={activa} datos={datos} chain={chain.data} onVencimiento={setVenc} config={config}
            previa={previa.current} onSel={x => { previa.current = x; }} />}
          <h3>Desglose por core</h3>
          <Desglose fila={activa} datos={datos} detalle={det} config={config} />
          {activa.motivos?.length > 0 && <details className="details"><summary>Motivos del puntaje</summary><ul className="list list--compact">{activa.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul></details>}
        </div>
        <aside className="estr-side" aria-label="Compatibilidad">
          <h3>Compatibilidad</h3>
          <p className="estr-score"><strong>{textoPuntaje(activa.puntaje)}</strong><span className="muted"> / 100</span></p>
          <Badge tone={v.tono}>{v.texto}</Badge>
          <ScoreBar value={activa.puntaje} />
          <dl className="stats">
            <div><dt>Cobertura de cores</dt><dd>{fmtPct(activa.cobertura)}</dd></div>
            <div><dt>Confianza</dt><dd>{est ? fmtPct(est.confianza) : '—'}</dd></div>
            <div><dt>Dispersión entre cores</dt><dd>{est ? est.dispersion.toFixed(2) : '—'}</dd></div>
          </dl>
          <p className="small">{v.tono === 'success' ? 'Los cores analizados respaldan esta estrategia.' : v.tono === 'warning' ? 'Respaldo parcial: señales mixtas.' : v.tono === 'danger' ? 'Los cores analizados no respaldan esta estrategia.' : ''}</p>
          <p className="muted small">Acierto/error simulado y backtest aún no están disponibles.</p>
        </aside>
      </div>
    </section>
  );
}
