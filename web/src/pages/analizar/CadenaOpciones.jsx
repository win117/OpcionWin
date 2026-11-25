// Cadena de opciones: todos los vencimientos, desplegables; el que se abre se trae del proveedor y se refresca con el mercado abierto.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TicketOrden from '../../components/TicketOrden';
import GraficaLinea from '../../components/GraficaLinea';
import { diasTxt } from '../../components/SinPrecios';
import { MercadoEstado } from '../../components/MercadoEstado';
import { Modal } from '../../components/Modal';
import { Termino } from '../../components/Termino';
import { Empty, ErrorMessage, Loading, Notice, Spinner } from '../../components/States';
import { Select } from '../../components/Field';
import { useAsync } from '../../hooks/useAsync';
import { useEstadoMercado } from '../../hooks/useEstadoMercado';
import { mercado } from '../../api/resources';
import { cambioPct, cercanas, esMensual, fusionarCotizaciones, porStrike } from '../../utils/cadena';
import { cotizacionFiable, diasHasta, intencionPara, mid, sinPrecios, SPREAD_AVISO, spreadPct, vencimientosVigentes } from '../../utils/estrategiasOrden';
import { fmtDate, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';

const REFRESCO_MS = 10000, MAX_COTIZACIONES = 100;
const px = v => (isNum(v) ? fmtFixed(v, 2) : '—');
const f = (v, d) => (isNum(v) ? fmtFixed(v, d) : '—');
const entero = v => (isNum(v) ? v.toLocaleString('es-MX') : '—');
const signoPct = v => (isNum(v) ? <span className={v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}>{v > 0 ? '+' : ''}{fmtPct(v, 1)}</span> : '—');

// Columnas de cada vista, de fuera hacia el strike; compra (bid) y venta (ask) se muestran siempre.
const VISTAS = {
  precios: [['Medio', null, it => (isNum(mid(it)) ? px(mid(it)) : '—')], ['Cambio', null, it => signoPct(cambioPct(it))], ['Último', 'ultimo', it => <span title={it?.ultimoFecha ? 'Operado el ' + fmtDate(it.ultimoFecha) : undefined}>{px(it?.ultimo)}</span>]],
  griegas: [['Theta', 'theta', it => f(it?.griegas?.theta, 3)], ['Vega', 'vega', it => f(it?.griegas?.vega, 3)], ['Gamma', 'gamma', it => f(it?.griegas?.gamma, 4)], ['IV', 'iv', it => (isNum(it?.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 1) : '—')], ['Delta', 'delta', it => f(it?.griegas?.delta, 2)]],
  liquidez: [['Volumen', null, it => entero(it?.volumen)], ['Interés', 'interes_abierto', it => entero(it?.interesAbierto)], ['Spread', 'spread', it => { const sp = spreadPct(it); return <span className={sp > SPREAD_AVISO ? 'aviso-texto' : ''}>{isNum(sp) ? fmtPct(sp, 0) : '—'}</span>; }]],
};
const OPC_VISTA = [['precios', 'Precios'], ['griegas', 'Griegas'], ['liquidez', 'Liquidez']];
const OPC_LADO = [['ambos', 'Calls y puts'], ['call', 'Calls'], ['put', 'Puts']];

function Segmento({ opciones, valor, onCambio, etiqueta }) {
  return <div className="seg" role="group" aria-label={etiqueta}>{opciones.map(([v, t]) => <button key={v} type="button" className={'seg__btn' + (v === valor ? ' is-active' : '')} aria-pressed={v === valor} onClick={() => onCambio(v)}>{t}</button>)}</div>;
}

function Sonrisa({ filas, precio }) {
  const W = 560, H = 220, M = { l: 44, r: 12, t: 12, b: 28 };
  const pts = tipo => filas.map(r => [r.strike, r[tipo]?.volatilidadImplicita]).filter(([, y]) => isNum(y) && y > 0);
  const calls = pts('call'), puts = pts('put');
  if (calls.length + puts.length < 2) return <p className="muted small">Sin volatilidad implícita suficiente para dibujar la sonrisa.</p>;
  const todos = [...calls, ...puts];
  const xs = todos.map(p => p[0]), ys = todos.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * 0.95, y1 = Math.max(...ys) * 1.05;
  const X = x => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const Y = y => H - M.b - ((y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const path = p => p.map(([x, y], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1)).join(' ');
  const ticksY = [0, 0.5, 1].map(t => y0 + t * (y1 - y0));
  const ticksX = [0, 0.5, 1].map(t => x0 + t * (x1 - x0));
  return (
    <figure className="smile">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sonrisa de volatilidad implícita por strike, calls y puts" preserveAspectRatio="xMidYMid meet">
        {ticksY.map(t => <g key={'y' + t}><line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className="smile__grid" /><text x={M.l - 6} y={Y(t) + 4} textAnchor="end" className="smile__tick">{fmtPct(t, 0)}</text></g>)}
        {ticksX.map(t => <text key={'x' + t} x={X(t)} y={H - 8} textAnchor="middle" className="smile__tick">{fmtFixed(t, 0)}</text>)}
        {isNum(precio) && precio >= x0 && precio <= x1 && <line x1={X(precio)} x2={X(precio)} y1={M.t} y2={H - M.b} className="smile__spot" />}
        <path d={path(calls)} className="smile__line smile__line--call" />
        <path d={path(puts)} className="smile__line smile__line--put" />
        {calls.map(([x, y]) => <circle key={'c' + x} cx={X(x)} cy={Y(y)} r="2.5" className="smile__dot smile__dot--call" />)}
        {puts.map(([x, y]) => <circle key={'p' + x} cx={X(x)} cy={Y(y)} r="2.5" className="smile__dot smile__dot--put" />)}
      </svg>
      <figcaption className="smile__legend">
        <span><i className="swatch swatch--call" /> Calls</span>
        <span><i className="swatch swatch--put" /> Puts</span>
        {isNum(precio) && <span><i className="swatch swatch--spot" /> Subyacente {fmtMoney(precio)}</span>}
      </figcaption>
    </figure>
  );
}

/** Precio diario al que se operó un contrato (no incluye días sin operaciones). */
function Historial({ contrato }) {
  const st = useAsync(() => mercado.velasOpcion(contrato.simbolo), [contrato.simbolo]);
  const puntos = useMemo(() => (st.data?.items || []).map(v => ({ fecha: v.fecha, valor: v.cierre })), [st.data]);
  return (
    <section>
      <h3>{contrato.tipo === 'put' ? 'Put' : 'Call'} {fmtFixed(contrato.strike, 2)}</h3>
      {st.loading ? <Loading text="Cargando historial…" /> : st.error ? <ErrorMessage error={st.error} onRetry={st.reload} /> : puntos.length < 2 ? <p className="muted small">{puntos.length ? 'Solo se ha negociado un día.' : 'Aún no se ha negociado.'}</p> : <GraficaLinea puntos={puntos} height={180} etiqueta={'Precio del contrato ' + contrato.simbolo} />}
    </section>
  );
}

/** Precio que se toca para operar: el ask compra y el bid vende. */
function Precio({ it, accion, onOperar }) {
  const valor = accion === 'buy' ? it?.ask : it?.bid;
  if (!it?.contratoId || !isNum(valor)) return px(valor);
  const etiqueta = `${accion === 'buy' ? 'Comprar' : 'Vender'} ${it.tipo} ${px(it.strike)} a ${px(valor)}`;
  return <button type="button" className={'cad__px cad__px--' + accion + (cotizacionFiable(it) ? '' : ' is-dudoso')} onClick={() => onOperar(it, accion)} aria-label={etiqueta} title={etiqueta}>{px(valor)}</button>;
}

function Tabla({ chain, precio, cambio, vista, lado, n, simbolo, onOperar, onHistorial }) {
  const filas = useMemo(() => cercanas(porStrike(chain.items), precio, n), [chain.items, precio, n]);
  const cols = VISTAS[vista], verCall = lado !== 'put', verPut = lado !== 'call';
  const corte = isNum(precio) ? filas.findIndex(r => r.strike > precio) : -1;
  const total = (verCall ? cols.length + 2 : 0) + 1 + (verPut ? cols.length + 2 : 0);
  const th = ([t, id], k) => <th key={k + t} scope="col" className="num">{id ? <Termino id={id}>{t}</Termino> : t}</th>;
  const linea = <tr className="cad__precio"><td colSpan={total}><strong>{simbolo} {fmtMoney(precio)}</strong> {isNum(cambio) && signoPct(cambio)}</td></tr>;
  const celdas = (it, dentro, k) => cols.map(([t, , ver]) => <td key={k + t} className={'num' + (dentro ? ' itm' : '')}>{ver(it)}</td>);
  return (
    <div className="table-wrap cad__caja">
      <table className="table table--dense cad__tabla">
        <caption className="sr-only">Cadena de {simbolo}, vence {fmtDate(chain.vencimiento)}</caption>
        <thead>
          <tr>{verCall && <th colSpan={cols.length + 2} scope="colgroup" className="chain__grp chain__grp--call">Calls</th>}<th rowSpan="2" scope="col" className="cad__strike"><Termino id="strike">Strike</Termino></th>{verPut && <th colSpan={cols.length + 2} scope="colgroup" className="chain__grp chain__grp--put">Puts</th>}</tr>
          <tr>{verCall && <>{cols.map(c => th(c, 'c'))}<th scope="col" className="num">Ask</th><th scope="col" className="num">Bid</th></>}{verPut && <><th scope="col" className="num">Bid</th><th scope="col" className="num">Ask</th>{[...cols].reverse().map(c => th(c, 'p'))}</>}</tr>
        </thead>
        <tbody>
          {filas.map((r, i) => {
            const ic = isNum(precio) && r.strike < precio, ip = isNum(precio) && r.strike > precio;
            return (
              <Fragment key={r.strike}>
                {i === corte && i > 0 && linea}
                <tr>
                  {verCall && <>{celdas(r.call, ic, 'c')}<td className={'num' + (ic ? ' itm' : '')}><Precio it={r.call} accion="buy" onOperar={onOperar} /></td><td className={'num' + (ic ? ' itm' : '')}><Precio it={r.call} accion="sell" onOperar={onOperar} /></td></>}
                  <th scope="row" className="num cad__strike"><button type="button" className="enlace" onClick={() => onHistorial(r, chain)} title="Ver historial de precios" aria-label={`Historial de precios del strike ${px(r.strike)}`}>{fmtFixed(r.strike, r.strike % 1 ? 2 : 0)}</button></th>
                  {verPut && <><td className={'num' + (ip ? ' itm' : '')}><Precio it={r.put} accion="sell" onOperar={onOperar} /></td><td className={'num' + (ip ? ' itm' : '')}><Precio it={r.put} accion="buy" onOperar={onOperar} /></td>{celdas(r.put, ip, 'p').reverse()}</>}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Un vencimiento: al abrirse trae su cadena y, con el mercado abierto, refresca lo que se ve. */
function Vencimiento({ v, mensual, simbolo, precio, cambio, abierta, onAlternar, abierto, ajustes, onOperar, onHistorial }) {
  const [st, setSt] = useState({ chain: null, error: null, cargando: false, hora: null });
  const pedido = useRef(false);
  const cargar = useCallback(async () => {
    pedido.current = true;
    setSt(x => ({ ...x, cargando: true, error: null }));
    try { const chain = await mercado.traerCadena(simbolo, v); setSt({ chain, error: null, cargando: false, hora: new Date() }); }
    catch (error) { setSt(x => ({ ...x, error, cargando: false })); }
  }, [simbolo, v]);
  useEffect(() => { if (abierta && !pedido.current) cargar(); }, [abierta, cargar]);

  const base = st.chain, pr = precio ?? base?.precioSubyacente;
  const visibles = useMemo(() => (base ? cercanas(porStrike(base.items), pr, ajustes.n) : []).flatMap(r => [r.call, r.put]).filter(Boolean).map(i => i.simbolo).slice(0, MAX_COTIZACIONES), [base, pr, ajustes.n]);
  const clave = visibles.join();
  const refrescar = useCallback(async () => {
    if (!clave) return;
    try {
      const r = await mercado.cotizacionesOpciones(clave.split(','));
      setSt(x => (x.chain ? { ...x, chain: { ...x.chain, items: fusionarCotizaciones(x.chain.items, r.items) }, hora: new Date() } : x));
    } catch { /* se conserva lo último; el siguiente intento lo actualiza */ }
  }, [clave]);
  useEffect(() => {
    if (!abierta || !abierto || !clave) return undefined;
    const t = setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [abierta, abierto, clave, refrescar]);

  const dias = diasHasta(v), id = 'cad-' + v;
  return (
    <section className="cad__venc">
      <h3 className="cad__cab"><button type="button" aria-expanded={abierta} aria-controls={id} onClick={onAlternar}><span className="cad__flecha" aria-hidden="true">›</span><span>{fmtDate(v)}</span><span className="muted">{mensual ? 'Mensual' : 'Semanal'}</span><span className="cad__dias">{diasTxt(dias)}</span></button></h3>
      {abierta && (
        <div id={id} className="cad__cuerpo">
          {st.error && <ErrorMessage error={st.error} onRetry={cargar} title="No se pudo traer este vencimiento" />}
          {!base && st.cargando && <Loading text="Trayendo la cadena…" />}
          {base && (
            <>
              {sinPrecios(base.items) && <Notice tone="warning" title="Todavía no tiene precios.">Suele pasar con los vencimientos recién listados: nadie los ha cotizado ni negociado.</Notice>}
              <Tabla chain={base} precio={pr} cambio={cambio} simbolo={simbolo} {...ajustes} onOperar={(it, accion) => onOperar(it, accion, base)} onHistorial={onHistorial} />
              <p className="muted small cad__pie">
                {abierto ? 'Se actualiza solo cada 10 segundos.' : 'Mercado cerrado: últimos precios disponibles.'} {st.hora && `Consultado a las ${st.hora.toLocaleTimeString('es-MX', { hour12: false })}.`}{' '}
                <button type="button" className="enlace" onClick={cargar} disabled={st.cargando}>{st.cargando ? 'Actualizando…' : 'Actualizar'}</button>
                {st.cargando && <Spinner small />}
              </p>
              {ajustes.vista === 'griegas' && <Sonrisa filas={porStrike(base.items)} precio={pr} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function CadenaOpciones({ simbolo, empresa, vencimiento = '', vivo }) {
  const [ticket, setTicket] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [abiertas, setAbiertas] = useState(() => new Set(vencimiento ? [vencimiento] : []));
  const [vista, setVista] = useState('precios');
  const [lado, setLado] = useState(() => (window.matchMedia('(max-width: 760px)').matches ? 'call' : 'ambos'));
  const [n, setN] = useState('10');
  const lista = useAsync(() => mercado.vencimientos(simbolo), [simbolo]);
  const estado = useEstadoMercado();
  const vencs = vencimientosVigentes(lista.data?.items);
  const operar = (it, accion, chain) => setTicket({ abridor: document.activeElement, legs: [{ accion, intencion: intencionPara(accion), contratoId: it.contratoId }], chain });
  const alternar = v => setAbiertas(s => { const x = new Set(s); if (!x.delete(v)) x.add(v); return x; });

  if (lista.loading && !lista.data) return <Loading text="Buscando vencimientos…" />;
  if (lista.error && !lista.data) return <ErrorMessage error={lista.error} onRetry={lista.reload} title="No se pudieron cargar los vencimientos" />;
  if (!vencs.length) return <Empty title="Sin opciones">El proveedor no tiene contratos de opciones de {simbolo}.</Empty>;
  return (
    <div className="cad">
      <div className="cad__barra">
        <MercadoEstado estado={estado} />
        <Segmento etiqueta="Datos" opciones={OPC_VISTA} valor={vista} onCambio={setVista} />
        <Segmento etiqueta="Lado" opciones={OPC_LADO} valor={lado} onCambio={setLado} />
        <label className="toolbar__filter"><span className="muted">Strikes </span><Select value={n} onChange={setN} aria-label="Strikes visibles" options={[['6', '6'], ['10', '10'], ['20', '20'], ['0', 'Todos']].map(([value, label]) => ({ value, label }))} /></label>
      </div>
      <p className="muted small">Toca un <Termino id="ask">Ask</Termino> para comprar o un <Termino id="bid">Bid</Termino> para vender. Sombreado: <Termino id="itm">dentro del dinero</Termino>.</p>
      {vencs.map(v => <Vencimiento key={v} v={v} mensual={esMensual(v, vencs)} simbolo={simbolo} precio={vivo?.precio} cambio={vivo?.cambioPct} abierta={abiertas.has(v)} onAlternar={() => alternar(v)} abierto={estado.data?.abierto === true} ajustes={{ vista, lado, n: Number(n) }} onOperar={operar} onHistorial={(fila, chain) => setHistorial({ fila, chain })} />)}
      {historial && (
        <Modal open title={`Historial de ${simbolo} ${px(historial.fila.strike)}, vence ${fmtDate(historial.chain.vencimiento)}`} onClose={() => setHistorial(null)}>
          <div className="stack">{[historial.fila.call, historial.fila.put].filter(Boolean).map(c => <Historial key={c.simbolo} contrato={c} />)}<p className="muted small">Precio por acción al que se operó cada día. Los días sin operaciones no aparecen.</p></div>
        </Modal>
      )}
      {ticket && empresa && <TicketOrden open empresa={empresa} chain={ticket.chain} legs={ticket.legs} abridor={ticket.abridor} onClose={() => setTicket(null)} />}
    </div>
  );
}
