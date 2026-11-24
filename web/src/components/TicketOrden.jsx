// Ticket de orden PAPER: edición de patas → revisión → envío directo al broker elegido (paper) + seguimiento del estado.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { Field } from './Field';
import { Spinner } from './States';
import { useBroker } from '../context/BrokerContext';
import { acciones, mercado, operacion } from '../api/resources';
import { CORE_LABELS, ESTRATEGIA_LABELS } from '../utils/constants';
import { fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../utils/format';
import { diasHasta, intencionPara, mid, netoMid, nombreConContexto, nombreOrden, perfilRiesgo, reconstruirPatas, redondearPrecio, spreadPct } from '../utils/estrategiasOrden';
import { uuid } from '../utils/objects';

export const ESTADOS_TERMINALES = ['ejecutada', 'cancelada', 'rechazada', 'expirada'];
const POLL_MS = 2000;
const POLL_MAX_MS = 60000;
let seq = 0;
const nuevaPata = p => ({ id: ++seq, accion: p.accion || 'buy', intencion: p.intencion || intencionPara(p.accion), contratoId: p.contratoId });

export default function TicketOrden({ open = true, onClose, empresa, chain: chainInicial, legs: legsIniciales = [], estrategiaCodigo, analisis }) {
  const navigate = useNavigate();
  const { broker, nombre: brokerNombre, bloqueado: brokerBloqueado, info: brokerInfo } = useBroker();
  const [chain, setChain] = useState(chainInicial);
  const [vencSel, setVencSel] = useState(chainInicial?.vencimiento || '');
  const [cargaV, setCargaV] = useState({ loading: false, error: null });
  const reqV = useRef(0);
  const items = useMemo(() => (chain?.items || []).filter(i => i.contratoId && isNum(i.strike)), [chain]);
  const precioSub = chain?.precioSubyacente;
  const [legs, setLegs] = useState(() => legsIniciales.map(nuevaPata));
  const [cantidad, setCantidad] = useState(1);
  const [tipo, setTipo] = useState('limit');
  const [limite, setLimite] = useState('');
  const [limiteTocado, setLimiteTocado] = useState(false);
  const [vigencia, setVigencia] = useState('day');
  const [paso, setPaso] = useState('editar'); // editar | revisar | enviado
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [orden, setOrden] = useState(null);
  const [cancelando, setCancelando] = useState(false);
  const [sondeo, setSondeo] = useState('idle'); // idle | activo | timeout
  const [cuenta, setCuenta] = useState({ loading: true, data: null, error: null });
  const clave = useRef(null);

  const cargarCuenta = () => {
    setCuenta({ loading: true, data: null, error: null });
    operacion.asegurarConexion(broker)
      .then(data => setCuenta({ loading: false, data, error: null }))
      .catch(error => setCuenta({ loading: false, data: null, error }));
  };
  useEffect(() => {
    if (open) cargarCuenta();
  }, [open, broker]); // eslint-disable-line react-hooks/exhaustive-deps

  const vencimientos = useMemo(() => {
    const l = chain?.vencimientos?.length ? chain.vencimientos : chain?.vencimiento ? [chain.vencimiento] : [];
    return [...new Set(l)].sort();
  }, [chain]);
  const bloqueado = paso === 'enviado' || enviando;
  const cambiarVencimiento = async v => {
    if (!v) return;
    const req = ++reqV.current;
    setVencSel(v);
    setCargaV({ loading: true, error: null });
    try {
      const d = await mercado.opcionesResumen(empresa.simbolo, { vencimiento: v });
      if (req !== reqV.current) return;
      const nuevos = d.items || [];
      const previas = legs.map(l => ({ accion: l.accion, intencion: l.intencion, item: porId.get(l.contratoId) }));
      const r = reconstruirPatas(estrategiaCodigo, previas, nuevos, d.precioSubyacente);
      if (r.error) throw new Error(r.error);
      setChain({ ...d, vencimientos: d.vencimientos?.length ? d.vencimientos : vencimientos, vencimiento: d.vencimiento || v });
      setLegs(r.legs.map(nuevaPata));
      setLimiteTocado(false);
      setCargaV({ loading: false, error: null });
    } catch (error) {
      if (req === reqV.current) setCargaV({ loading: false, error });
    }
  };
  const vencPendiente = vencSel !== (chain?.vencimiento || '');

  const porId = useMemo(() => new Map(items.map(i => [i.contratoId, i])), [items]);
  const patas = legs.map(l => ({ ...l, item: porId.get(l.contratoId) }));
  const neto = useMemo(() => netoMid(patas), [legs, porId]); // eslint-disable-line react-hooks/exhaustive-deps
  const credito = isNum(neto) ? neto > 0 : false;
  const limiteDefecto = redondearPrecio(neto);
  const limiteNum = limiteTocado ? Number(limite) : limiteDefecto;
  const precioUnit = tipo === 'limit' ? limiteNum : isNum(neto) ? Math.abs(neto) : null;
  const cant = Number(cantidad);
  const cantOk = Number.isInteger(cant) && cant >= 1 && cant <= 100;
  const total = isNum(precioUnit) ? precioUnit * 100 * (cantOk ? cant : 1) : null;
  const perfil = useMemo(() => perfilRiesgo(patas, precioUnit, credito, cantOk ? cant : 1), [legs, porId, precioUnit, credito, cant]); // eslint-disable-line react-hooks/exhaustive-deps
  const poder = cuenta.data?.cuenta?.poderCompra;
  const requerido = credito ? perfil?.maxPerdida : total;

  const problemas = [];
  if (cargaV.loading) problemas.push('Cargando la cadena del vencimiento elegido…');
  if (cargaV.error || (vencPendiente && !cargaV.loading)) problemas.push('No se pudo cargar el vencimiento elegido.');
  if (!legs.length) problemas.push('Agrega al menos una pata.');
  if (patas.some(p => !p.item)) problemas.push('Una de las patas no existe en la cadena del vencimiento.');
  if (!cantOk) problemas.push('La cantidad debe ser un entero entre 1 y 100.');
  if (tipo === 'limit' && !(isNum(limiteNum) && limiteNum > 0)) problemas.push('Indica un precio límite mayor que cero.');
  if (tipo === 'market' && patas.some(p => p.item && !isNum(mid(p.item)))) problemas.push('Sin cotización: usa una orden límite.');
  const advertencias = [];
  if (tipo === 'market') {
    const ancho = patas.filter(p => (spreadPct(p.item) ?? 0) > 0.1);
    if (ancho.length) advertencias.push('Orden de mercado con spread amplio (más de 10 % del punto medio): puede ejecutarse a un precio mucho peor. Considera una orden límite.');
  }
  if (isNum(requerido) && isNum(poder) && requerido > poder) advertencias.push(`Poder de compra insuficiente: se requieren ${fmtMoney(requerido)} y hay ${fmtMoney(poder)}.`);
  if (analisis?.sinAnalisis) advertencias.push('Opera sin análisis: no hay una selección completada para esta empresa.');
  if (analisis && !analisis.sinAnalisis && analisis.antiguo) advertencias.push('El análisis tiene más de 24 horas; el mercado pudo cambiar. Considera volver a analizar.');
  if (analisis && !analisis.sinAnalisis && !analisis.esTop) advertencias.push(`La estrategia elegida no es la mejor clasificada (la más compatible es ${ESTRATEGIA_LABELS[analisis.topCodigo] || analisis.topCodigo}).`);
  if (analisis?.contradiccion) advertencias.push('Los cores se contradicen: la neutralidad puede ser desacuerdo, no rango lateral.');
  if (!isNum(neto)) advertencias.push('Alguna pata no tiene cotización (bid/ask); el precio estimado puede no ser confiable.');

  const setPata = (id, cambios) => { setLegs(ls => ls.map(l => (l.id === id ? { ...l, ...cambios } : l))); setLimiteTocado(false); };
  const cambiarAccion = (id, accion) => setPata(id, { accion, intencion: intencionPara(accion) });
  const cambiarTipo = (l, t) => {
    const actual = porId.get(l.contratoId);
    const cand = items.filter(i => i.tipo === t);
    if (!cand.length) return;
    const ref = actual?.strike ?? precioSub ?? 0;
    const best = cand.reduce((a, b) => (Math.abs(b.strike - ref) < Math.abs(a.strike - ref) ? b : a));
    setPata(l.id, { contratoId: best.contratoId });
  };
  const agregar = () => {
    const base = items.filter(i => i.tipo === 'call')[0] || items[0];
    if (base && legs.length < 4) { setLegs(ls => [...ls, nuevaPata({ accion: 'buy', contratoId: base.contratoId })]); setLimiteTocado(false); }
  };
  const quitar = id => { setLegs(ls => ls.filter(l => l.id !== id)); setLimiteTocado(false); };

  const volver = () => { clave.current = null; setError(null); setPaso('editar'); };

  const enviar = async () => {
    if (!empresa?._id) return;
    if (!clave.current) clave.current = uuid(); // misma clave en reintentos de esta confirmación
    setEnviando(true);
    setError(null);
    const body = {
      broker,
      empresaId: empresa._id,
      ...(estrategiaCodigo ? { estrategiaCodigo } : {}),
      nombre: analisis && estrategiaCodigo ? nombreConContexto(empresa.simbolo, estrategiaCodigo, analisis) : nombreOrden(empresa.simbolo, patas, estrategiaCodigo),
      tipo,
      ...(tipo === 'limit' ? { precioLimite: Math.round(limiteNum * 100) / 100, credito } : { credito }),
      vigencia,
      cantidad: cant,
      componentes: patas.map(p => ({ contratoId: p.contratoId, accion: p.accion, intencion: p.intencion, proporcion: 1 })),
    };
    try {
      const res = await operacion.ticket(body, clave.current);
      setOrden(res?.orden || res);
      setSondeo('activo');
      setPaso('enviado');
    } catch (e) {
      setError(e);
    } finally {
      setEnviando(false);
    }
  };

  // Seguimiento: cada 2 s sincroniza órdenes y consulta la orden, hasta estado final o 60 s.
  const ordenId = orden?._id;
  const terminal = ESTADOS_TERMINALES.includes(orden?.estado);
  const conexionId = cuenta.data?.conexion?._id || orden?.conexionId;
  useEffect(() => {
    if (paso !== 'enviado' || !ordenId || terminal) return undefined;
    let cancelado = false, timer;
    const t0 = Date.now();
    setSondeo('activo');
    const tick = async () => {
      try {
        if (conexionId) await acciones.sincronizar({ recurso: 'ordenes', conexionId }).catch(() => {});
        const o = await operacion.orden(ordenId);
        if (cancelado) return;
        setOrden(o);
        if (ESTADOS_TERMINALES.includes(o?.estado)) { setSondeo('idle'); return; }
      } catch { /* se reintenta */ }
      if (cancelado) return;
      if (Date.now() - t0 >= POLL_MAX_MS) { setSondeo('timeout'); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [paso, ordenId, terminal, conexionId]);

  const cancelar = async () => {
    setCancelando(true);
    setError(null);
    try { setOrden(await acciones.cancelarOrden(ordenId)); setSondeo('idle'); } catch (e) { setError(e); } finally { setCancelando(false); }
  };
  const verCartera = () => { onClose?.(); navigate('/posiciones'); };

  const ultimoEvento = orden?.eventos?.length ? orden.eventos[orden.eventos.length - 1] : null;
  const c = cuenta.data?.cuenta;
  const titulo = `Ticket de orden · ${empresa?.simbolo || ''}`;

  const footer = paso === 'editar' ? (
    <>
      <button type="button" className="btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn--primary" disabled={problemas.length > 0 || cuenta.loading || Boolean(cuenta.error) || brokerBloqueado} onClick={() => setPaso('revisar')}>Revisar</button>
    </>
  ) : paso === 'revisar' ? (
    <>
      <button type="button" className="btn" onClick={volver} disabled={enviando}>Volver</button>
      <button type="button" className="btn btn--primary" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando…' : error ? 'Reintentar envío (paper)' : 'Confirmar envío (paper)'}</button>
    </>
  ) : (
    <>
      {!terminal && <button type="button" className="btn btn--danger" onClick={cancelar} disabled={cancelando}>{cancelando ? 'Cancelando…' : 'Cancelar orden'}</button>}
      <button type="button" className="btn" onClick={verCartera}>Ver cartera</button>
      <button type="button" className="btn btn--primary" onClick={onClose}>Cerrar</button>
    </>
  );

  return (
    <Modal open={open} title={titulo} onClose={onClose} size="lg" footer={footer}>
      <div className="stack ticket">
        <div className="banner-paper" role="note"><strong>PAPER · dinero simulado.</strong> Esta orden se envía a {brokerNombre} paper trading; no se usa dinero real.</div>
        {brokerBloqueado && <div className="alert alert--warning" role="alert"><div><strong>{brokerNombre} no está operativo.</strong> {brokerInfo?.mensaje || 'Elige otro broker en la barra superior para enviar la orden.'}</div></div>}

        <div className="ticket__cuenta" aria-live="polite">
          {cuenta.loading && <span className="muted small"><Spinner small /> Verificando conexión con {brokerNombre} paper…</span>}
          {cuenta.error && (
            <div className="alert alert--danger" role="alert">
              <div><strong>No se pudo conectar con {brokerNombre} paper.</strong> {cuenta.error.message} Revisa las credenciales del servidor.</div>
              <button type="button" className="btn btn--sm" onClick={cargarCuenta}>Reintentar</button>
            </div>
          )}
          {c && <span className="small">Cuenta {brokerNombre} paper · Poder de compra <strong>{fmtMoney(c.poderCompra)}</strong> · Efectivo <strong>{fmtMoney(c.efectivo)}</strong>{c.estado ? <> · <Badge value={c.estado} tone="info" /></> : null}</span>}
        </div>

        {analisis && !analisis.sinAnalisis && (
          <div className="ticket__analisis small" role="note">
            <strong>Análisis de origen:</strong> {ESTRATEGIA_LABELS[analisis.codigo] || analisis.codigo} · compatibilidad {isNum(analisis.puntaje) ? Math.round(analisis.puntaje) : '—'}/100 · cobertura {isNum(analisis.cobertura) ? fmtPct(analisis.cobertura) : '—'} · {fmtDateTime(analisis.fecha)} · cores: {analisis.cores.map(c => CORE_LABELS[c] || c).join(', ') || '—'}
          </div>
        )}

        {paso === 'editar' && (
          <>
            <p className="muted small">{empresa?.simbolo} · subyacente {fmtMoney(precioSub)} · vencimiento {chain?.vencimiento || '—'}{chain?.vencimiento ? ' · ' + diasTxt(diasHasta(chain.vencimiento)) : ''}</p>
            {vencimientos.length > 0 && (
              <div className="ticket__venc" aria-live="polite">
                <Field label="Vencimiento">
                  <select value={vencSel} onChange={e => cambiarVencimiento(e.target.value)} disabled={bloqueado || cargaV.loading}>
                    {vencimientos.map(v => <option key={v} value={v}>{v} · {diasTxt(diasHasta(v))}</option>)}
                  </select>
                </Field>
                {cargaV.loading && <span className="muted small"><Spinner small /> Cargando cadena…</span>}
                {cargaV.error && (
                  <div className="alert alert--danger" role="alert">
                    <div><strong>No se pudo cargar el vencimiento.</strong> {cargaV.error.message}</div>
                    <button type="button" className="btn btn--sm" onClick={() => cambiarVencimiento(vencSel)}>Reintentar</button>
                  </div>
                )}
              </div>
            )}
            <div className="table-wrap">
              <table className="table table--dense">
                <caption className="sr-only">Patas de la orden</caption>
                <thead><tr><th scope="col">Acción</th><th scope="col">Tipo</th><th scope="col">Strike</th><th scope="col" className="num">Bid</th><th scope="col" className="num">Ask</th><th scope="col" className="num">Mid</th><th scope="col" className="num">IV</th><th scope="col" className="num">Δ</th><th scope="col"><span className="sr-only">Quitar</span></th></tr></thead>
                <tbody>
                  {patas.map((l, i) => {
                    const it = l.item;
                    const strikes = items.filter(x => x.tipo === (it?.tipo || 'call')).sort((a, b) => a.strike - b.strike);
                    return (
                      <tr key={l.id}>
                        <td><select value={l.accion} onChange={e => cambiarAccion(l.id, e.target.value)} aria-label={`Acción de la pata ${i + 1}`}><option value="buy">Comprar</option><option value="sell">Vender</option></select></td>
                        <td><select value={it?.tipo || 'call'} onChange={e => cambiarTipo(l, e.target.value)} aria-label={`Tipo de la pata ${i + 1}`}><option value="call">Call</option><option value="put">Put</option></select></td>
                        <td><select value={l.contratoId} onChange={e => setPata(l.id, { contratoId: e.target.value })} aria-label={`Strike de la pata ${i + 1}`}>
                          {!it && <option value={l.contratoId}>—</option>}
                          {strikes.map(s => <option key={s.contratoId} value={s.contratoId}>{fmtFixed(s.strike, 2)}{isNum(s.griegas?.delta) ? ` · Δ ${fmtFixed(s.griegas.delta, 2)}` : ''}{isNum(mid(s)) ? ` · ${fmtFixed(mid(s), 2)}` : ''}</option>)}
                        </select></td>
                        <td className="num">{isNum(it?.bid) ? fmtFixed(it.bid) : '—'}</td>
                        <td className="num">{isNum(it?.ask) ? fmtFixed(it.ask) : '—'}</td>
                        <td className="num">{isNum(mid(it)) ? fmtFixed(mid(it)) : '—'}</td>
                        <td className="num">{isNum(it?.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 1) : '—'}</td>
                        <td className="num">{isNum(it?.griegas?.delta) ? fmtFixed(it.griegas.delta, 3) : '—'}</td>
                        <td>{legs.length > 1 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => quitar(l.id)} aria-label={`Quitar pata ${i + 1}`}>×</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {legs.length < 4 && <div><button type="button" className="btn btn--sm" onClick={agregar}>+ Añadir pata</button></div>}

            <div className="ticket__form">
              <Field label="Cantidad (contratos)" error={cantOk ? null : 'Entero de 1 a 100'}>
                <input type="number" min="1" max="100" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="Tipo de orden">
                <select value={tipo} onChange={e => setTipo(e.target.value)}><option value="limit">Límite</option><option value="market">Mercado</option></select>
              </Field>
              {tipo === 'limit' && (
                <Field label={credito ? 'Precio límite (crédito neto por unidad)' : 'Precio límite (débito neto por unidad)'} help="Precio neto positivo por contrato; por defecto el punto medio.">
                  <input type="number" min="0.01" step="0.01" value={limiteTocado ? limite : isNum(limiteDefecto) ? limiteDefecto.toFixed(2) : ''} onChange={e => { setLimite(e.target.value); setLimiteTocado(true); }} inputMode="decimal" />
                </Field>
              )}
              <Field label="Vigencia">
                <select value={vigencia} onChange={e => setVigencia(e.target.value)}><option value="day">Día</option><option value="gtc">GTC (hasta cancelar)</option></select>
              </Field>
            </div>
            <Resumen credito={credito} total={total} perfil={perfil} />
            {advertencias.map(a => <div key={a} className="alert alert--warning" role="note">{a}</div>)}
            {problemas.length > 0 && <ul className="list list--compact small down">{problemas.map(p => <li key={p}>{p}</li>)}</ul>}
          </>
        )}

        {paso === 'revisar' && (
          <>
            <h3>Revisa tu orden</h3>
            <ul className="list">
              {patas.map(p => <li key={p.id}><strong>{p.accion === 'sell' ? 'Vender' : 'Comprar'}</strong> {cant} × {empresa?.simbolo} {fmtFixed(p.item?.strike, 2)} {p.item?.tipo === 'put' ? 'Put' : 'Call'} · {chain?.vencimiento} <span className="muted small">({p.item?.simbolo})</span></li>)}
            </ul>
            <dl className="stats stats--row">
              <div><dt>Tipo</dt><dd>{tipo === 'limit' ? 'Límite ' + fmtMoney(limiteNum) : 'Mercado'}</dd></div>
              <div><dt>Vigencia</dt><dd>{vigencia === 'gtc' ? 'GTC' : 'Día'}</dd></div>
              <div><dt>Cantidad</dt><dd>{cant}</dd></div>
            </dl>
            <Resumen credito={credito} total={total} perfil={perfil} />
            {advertencias.map(a => <div key={a} className="alert alert--warning" role="note">{a}</div>)}
            {error && <div className="alert alert--danger" role="alert"><div><strong>No se pudo enviar la orden.</strong> {error.message} Puedes reintentar: se reutiliza la misma clave de idempotencia.</div></div>}
          </>
        )}

        {paso === 'enviado' && orden && (
          <div className="stack" aria-live="polite">
            <div className="ticket__estado">
              <Badge value={orden.estado} />
              <span>{orden.estado === 'ejecutada' ? 'Orden ejecutada' : terminal ? 'Orden finalizada' : `Orden enviada a ${brokerNombre} paper`}</span>
              {sondeo === 'activo' && !terminal && <span className="muted small"><Spinner small /> Actualizando estado…</span>}
            </div>
            {ultimoEvento && <p>{ultimoEvento.mensaje} <span className="muted small">{fmtDateTime(ultimoEvento.fecha)}</span></p>}
            {sondeo === 'timeout' && !terminal && <div className="alert alert--info" role="note">La orden sigue abierta. Revisa su estado en la cartera.</div>}
            {error && <div className="alert alert--danger" role="alert">{error.message}</div>}
            <p className="muted small">ID orden: <code>{orden._id}</code></p>
          </div>
        )}
      </div>
    </Modal>
  );
}

const diasTxt = d => (d === 1 ? '1 día' : d + ' días');

function Resumen({ credito, total, perfil }) {
  return (
    <dl className="stats stats--row ticket__resumen">
      <div><dt>{credito ? 'Crédito neto estimado' : 'Costo (débito) estimado'}</dt><dd className={credito ? 'up' : ''}>{isNum(total) ? fmtMoney(total) : '—'}</dd></div>
      {perfil && (
        <>
          <div><dt>Pérdida máxima</dt><dd className="down">{perfil.maxPerdida == null ? 'Ilimitada' : fmtMoney(perfil.maxPerdida)}</dd></div>
          <div><dt>Ganancia máxima</dt><dd className="up">{perfil.maxGanancia == null ? 'Ilimitada' : fmtMoney(perfil.maxGanancia)}</dd></div>
          <div><dt>{perfil.breakevens.length > 1 ? 'Puntos de equilibrio' : 'Punto de equilibrio'}</dt><dd>{perfil.breakevens.map(b => fmtFixed(b, 2)).join(' / ')}</dd></div>
        </>
      )}
    </dl>
  );
}
