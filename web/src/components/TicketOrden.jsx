// Ticket de orden PAPER: edición de patas → revisión → envío directo al broker elegido (paper) + seguimiento del estado.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { Checkbox, Field } from './Field';
import { Spinner } from './States';
import { useBroker } from '../context/BrokerContext';
import { api, esNoDisponible } from '../api/client';
import { acciones, mercado, operacion } from '../api/resources';
import { CORE_LABELS, ESTRATEGIA_LABELS } from '../utils/constants';
import { fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../utils/format';
import {
  antiguedadCotizacion, camposPrecio, costoSpread, cotizacionValida, CREDITO_ANCHO_MINIMO, diasHasta, intencionPara, liquidez, metricasOrden, mid, netoMid, nombreConContexto,
  nombreOrden, notasVencimiento, reconstruirPatas, redondearPrecio, signoNeto, SPREAD_AVISO, spreadPct, textoPuntaje, validarPatas, vencimientosVigentes,
} from '../utils/estrategiasOrden';
import { uuid } from '../utils/objects';

export const ESTADOS_TERMINALES = ['ejecutada', 'cancelada', 'rechazada', 'expirada'];
const POLL_MS = 3000;
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
  const [avisoVenc, setAvisoVenc] = useState(null); // qué pasó con los strikes al cambiar de vencimiento
  const [confirmado, setConfirmado] = useState(false); // confirmación explícita de spread amplio
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
    return vencimientosVigentes(l);
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
      setAvisoVenc(r.aviso);
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
  const signo = signoNeto(patas, neto);
  const credito = signo === 'credito'; // solo para mostrar; lo que se envía lo decide camposPrecio
  const limiteDefecto = redondearPrecio(neto);
  const limiteNum = limiteTocado ? Number(limite) : limiteDefecto;
  const precioUnit = tipo === 'limit' ? limiteNum : isNum(neto) ? Math.abs(neto) : null;
  const cant = Number(cantidad);
  const cantOk = Number.isInteger(cant) && cant >= 1 && cant <= 100;
  const total = isNum(precioUnit) ? precioUnit * 100 * (cantOk ? cant : 1) : null;
  const unidades = cantOk ? cant : 1;
  const metricas = useMemo(() => metricasOrden({
    patas, precioNeto: precioUnit, credito, cantidad: unidades, S: precioSub, items, vencimiento: chain?.vencimiento, patrimonio: cuenta.data?.cuenta?.patrimonio,
  }), [legs, porId, precioUnit, credito, unidades, precioSub, chain, cuenta.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const perfil = metricas.riesgo;
  const ilimitada = Boolean(perfil) && perfil.maxPerdida == null;
  const liq = liquidez(patas);
  const costo = costoSpread(patas, unidades);
  const edad = antiguedadCotizacion(patas);
  const dias = chain?.vencimiento ? diasHasta(chain.vencimiento) : null;
  const poder = cuenta.data?.cuenta?.poderCompra;
  const requerido = credito ? perfil?.maxPerdida : total;

  const problemas = [];
  if (cargaV.loading) problemas.push('Cargando la cadena del vencimiento elegido…');
  if (cargaV.error || (vencPendiente && !cargaV.loading)) problemas.push('No se pudo cargar el vencimiento elegido.');
  if (!legs.length) problemas.push('Agrega al menos una pata.');
  if (patas.some(p => !p.item)) problemas.push('Una de las patas no existe en la cadena del vencimiento.');
  if (new Set(legs.map(l => l.contratoId)).size < legs.length) problemas.push('Hay un contrato repetido en las patas.');
  // Los strikes son editables: se vuelve a validar la estructura. Cuatro patas sin estrategia se registran como iron condor.
  const codigoValidar = estrategiaCodigo || (legs.length === 4 ? 'IRON_CONDOR' : null);
  if (codigoValidar && legs.length && patas.every(p => p.item)) problemas.push(...validarPatas(codigoValidar, patas));
  if (isNum(dias) && dias < 0) problemas.push('El vencimiento elegido ya pasó.');
  if (legs.length && signo == null) problemas.push('Sin cotización en todas las patas no se puede saber si la orden es de crédito o de débito.');
  if (!cantOk) problemas.push('La cantidad debe ser un entero entre 1 y 100.');
  if (tipo === 'limit' && !(isNum(limiteNum) && limiteNum > 0)) problemas.push('Indica un precio límite mayor que cero.');
  if (tipo === 'market' && liq.sinCotizacion > 0) problemas.push('Sin cotización bid/ask válida: usa una orden límite.');
  const advertencias = [];
  if (liq.sinCotizacion > 0) advertencias.push(`${liq.sinCotizacion} de ${patas.length} patas sin cotización bid/ask válida: el precio estimado usa el último operado y puede no ser real.`);
  if (liq.avisar) advertencias.push(`Spread de hasta ${fmtPct(liq.peorSpread, 0)} del precio${liq.insuficiente ? ' (sin liquidez suficiente)' : ''}: ${tipo === 'market' ? 'una orden de mercado puede ejecutarse a un precio mucho peor; considera una límite.' : 'puede que no se ejecute en el punto medio.'}`);
  if (edad && edad.horas > 24) advertencias.push(`La cotización es de ${edad.texto}: el precio actual puede ser distinto. Sincroniza los contratos.`);
  if (!edad && patas.length) advertencias.push('No se conoce la fecha de las cotizaciones.');
  if (!estrategiaCodigo && legs.length > 1 && legs.length < 4) advertencias.push('El servidor solo registra órdenes de una pata o iron condor de cuatro: puede rechazar esta combinación.');
  if (perfil && perfil.maxGanancia != null && perfil.maxGanancia <= 0) advertencias.push('Con este precio la combinación no puede ganar dinero al vencimiento.');
  if (isNum(requerido) && isNum(poder) && requerido > poder) advertencias.push(`Poder de compra insuficiente: se requieren ${fmtMoney(requerido)} y hay ${fmtMoney(poder)}.`);
  if (analisis?.sinAnalisis) advertencias.push('Opera sin análisis: no hay una selección completada para esta empresa.');
  if (analisis && !analisis.sinAnalisis && analisis.antiguo) advertencias.push('El análisis tiene más de 24 horas; el mercado pudo cambiar. Considera volver a analizar.');
  if (analisis && !analisis.sinAnalisis && !analisis.esTop) advertencias.push(`La estrategia elegida no es la mejor clasificada (la más compatible es ${ESTRATEGIA_LABELS[analisis.topCodigo] || analisis.topCodigo}).`);
  if (analisis?.contradiccion) advertencias.push('Los cores se contradicen: la neutralidad puede ser desacuerdo, no rango lateral.');
  if (isNum(metricas.creditoAncho) && metricas.creditoAncho < CREDITO_ANCHO_MINIMO) advertencias.push(`El crédito es solo ${fmtPct(metricas.creditoAncho, 0)} del ancho de las alas (menos de ${fmtPct(CREDITO_ANCHO_MINIMO, 0)}): arriesgas mucho para ganar poco.`);

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

  const volver = () => { clave.current = null; setConfirmado(false); setError(null); setPaso('editar'); };

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
      ...camposPrecio({ tipo, limite: limiteNum, credito, nPatas: patas.length }),
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

  // Seguimiento: cada 3 s pide al servidor actualizar la orden (espera cada respuesta), hasta estado final o 60 s.
  // Si ese recurso no existe en el servidor (404), consulta la orden guardada.
  const ordenId = orden?._id;
  const terminal = ESTADOS_TERMINALES.includes(orden?.estado);
  useEffect(() => {
    if (paso !== 'enviado' || !ordenId || terminal) return undefined;
    let cancelado = false, timer, sinActualizacion = false;
    const t0 = Date.now();
    setSondeo('activo');
    const tick = async () => {
      try {
        let o = null;
        if (!sinActualizacion) {
          try {
            const r = await api.post(`/ordenes/${encodeURIComponent(ordenId)}/actualizacion`);
            o = r?.orden || r;
          } catch (e) {
            if (!esNoDisponible(e)) throw e;
            sinActualizacion = true;
          }
        }
        if (cancelado) return;
        if (!o) o = await operacion.orden(ordenId);
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
  }, [paso, ordenId, terminal]);

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
      <button type="button" className="btn btn--primary" onClick={enviar} disabled={enviando || problemas.length > 0 || (liq.confirmar && !confirmado)}>{enviando ? 'Enviando…' : error ? 'Reintentar envío (paper)' : 'Confirmar envío (paper)'}</button>
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
            <strong>Análisis de origen:</strong> {ESTRATEGIA_LABELS[analisis.codigo] || analisis.codigo} · compatibilidad {textoPuntaje(analisis.puntaje)}/100 · confianza {analisis.est ? fmtPct(analisis.est.confianza) : '—'} · dispersión {analisis.est ? analisis.est.dispersion.toFixed(2) : '—'} · cobertura {isNum(analisis.cobertura) ? fmtPct(analisis.cobertura) : '—'} · {fmtDateTime(analisis.fecha)} · cores: {analisis.cores.map(c => CORE_LABELS[c] || c).join(', ') || '—'}
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
            {avisoVenc && <div className="alert alert--info" role="status">{avisoVenc}</div>}
            <div className="table-wrap">
              <table className="table table--dense">
                <caption className="sr-only">Patas de la orden</caption>
                <thead><tr><th scope="col">Acción</th><th scope="col">Tipo</th><th scope="col">Strike</th><th scope="col" className="num">Bid</th><th scope="col" className="num">Ask</th><th scope="col" className="num">Mid</th><th scope="col" className="num">Spread</th><th scope="col" className="num">IV</th><th scope="col" className="num">Δ</th><th scope="col"><span className="sr-only">Quitar</span></th></tr></thead>
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
                        <td className="num">{isNum(mid(it)) ? <>{fmtFixed(mid(it))}{!cotizacionValida(it) && <abbr title="Último precio operado: no hay cotización bid/ask válida">*</abbr>}</> : '—'}</td>
                        <td className={'num' + ((spreadPct(it) ?? 0) > SPREAD_AVISO ? ' down' : '')}>{isNum(spreadPct(it)) ? fmtPct(spreadPct(it), 0) : '—'}</td>
                        <td className="num">{isNum(it?.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 1) : '—'}</td>
                        <td className="num">{isNum(it?.griegas?.delta) ? fmtFixed(it.griegas.delta, 3) : '—'}</td>
                        <td>{legs.length > 1 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => quitar(l.id)} aria-label={`Quitar pata ${i + 1}`}>×</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Cotización: {edad ? `${edad.texto} (${fmtDateTime(edad.fecha)})` : 'fecha desconocida'} · Cruzar el spread cuesta {isNum(costo) ? `${fmtMoney(costo)} al entrar (y otro tanto, aproximadamente, al salir)` : '—'}.</p>
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
            {ilimitada && <PerdidaIlimitada />}
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
            {ilimitada && <PerdidaIlimitada />}
            <Cifras m={metricas} costo={costo} edad={edad} />
            {advertencias.map(a => <div key={a} className="alert alert--warning" role="note">{a}</div>)}
            <div className="ticket__notas small">
              <strong>Antes de confirmar</strong>
              <ul className="list list--compact">
                {notasVencimiento(patas, precioSub, dias).map(n => <li key={n}>{n}</li>)}
                <li>Fecha de resultados: no disponible. Comprueba si la empresa publica resultados antes del {chain?.vencimiento || 'vencimiento'}: el precio puede saltar y la volatilidad implícita caer de golpe.</li>
              </ul>
            </div>
            {liq.confirmar && (
              <div className="ticket__confirmar">
                <Checkbox checked={confirmado} onChange={setConfirmado} disabled={enviando}
                  label={liq.sinCotizacion > 0 ? 'Entiendo que hay patas sin cotización válida y que el precio estimado puede no ser real.' : `Entiendo que el spread llega al ${fmtPct(liq.peorSpread, 0)} y que cruzarlo costaría ${fmtMoney(costo)}.`} />
              </div>
            )}
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

const PerdidaIlimitada = () => (
  <div className="alert alert--danger ticket__ilimitada" role="alert"><div><strong>Pérdida ilimitada.</strong> Vendes una opción sin otra que la cubra: si el precio sube mucho, la pérdida no tiene tope y puede superar el dinero de la cuenta. Añade una pata comprada que la limite.</div></div>
);

const monto = v => (v == null ? 'Ilimitada' : fmtMoney(v));

function Resumen({ credito, total, perfil }) {
  return (
    <dl className="stats stats--row ticket__resumen">
      <div><dt>{credito ? 'Crédito neto estimado' : 'Costo (débito) estimado'}</dt><dd className={credito ? 'up' : ''}>{isNum(total) ? fmtMoney(total) : '—'}</dd></div>
      <div><dt>Pérdida máxima</dt><dd className="down">{perfil ? monto(perfil.maxPerdida) : 'Sin datos'}</dd></div>
      <div><dt>Ganancia máxima</dt><dd className="up">{perfil ? monto(perfil.maxGanancia) : 'Sin datos'}</dd></div>
      <div><dt>{perfil?.breakevens.length > 1 ? 'Puntos de equilibrio' : 'Punto de equilibrio'}</dt><dd>{perfil ? perfil.breakevens.map(b => fmtFixed(b, 2)).join(' / ') || 'Ninguno' : 'Sin datos'}</dd></div>
    </dl>
  );
}

/** Cifras de la revisión: probabilidad, griegas en dólares, retorno, movimiento esperado y peso en la cuenta. */
function Cifras({ m, costo, edad }) {
  const dinero = v => (isNum(v) ? <span className={v < 0 ? 'down' : v > 0 ? 'up' : ''}>{fmtMoney(v)}</span> : '—');
  const mv = m.movimiento;
  return (
    <>
      <dl className="stats stats--row ticket__cifras">
        <div><dt>Probabilidad de ganar al vencer</dt><dd>{isNum(m.probabilidad) ? fmtPct(m.probabilidad, 0) : '—'}</dd></div>
        <div><dt>Retorno sobre el riesgo</dt><dd>{isNum(m.retornoRiesgo) ? fmtPct(m.retornoRiesgo, 0) : m.riesgo?.maxGanancia == null && m.riesgo?.maxPerdida != null ? 'Sin tope de ganancia' : '—'}</dd></div>
        {isNum(m.creditoAncho) && <div><dt>Crédito / ancho del ala</dt><dd className={m.creditoAncho < CREDITO_ANCHO_MINIMO ? 'down' : ''}>{fmtPct(m.creditoAncho, 0)}</dd></div>}
        <div><dt>% de la cuenta en riesgo</dt><dd>{isNum(m.pctCuenta) ? fmtPct(m.pctCuenta, 1) : m.riesgo && m.riesgo.maxPerdida == null ? 'Ilimitado' : '—'}</dd></div>
        <div><dt>Delta: por cada $1 que suba</dt><dd>{dinero(m.delta)}</dd></div>
        <div><dt>Theta: por cada día</dt><dd>{dinero(m.theta)}</dd></div>
        <div><dt>Vega: por punto de volatilidad</dt><dd>{dinero(m.vega)}</dd></div>
        <div><dt>Costo de cruzar el spread</dt><dd>{isNum(costo) ? fmtMoney(costo) : '—'}</dd></div>
      </dl>
      <p className="small">{mv
        ? <>Movimiento esperado hasta el vencimiento: ±{fmtMoney(mv.monto)}. Si baja a {fmtMoney(mv.abajo)}: {dinero(mv.plAbajo)}; si sube a {fmtMoney(mv.arriba)}: {dinero(mv.plArriba)} (al vencimiento).</>
        : 'Movimiento esperado: no disponible (falta volatilidad implícita o precio del subyacente).'}</p>
      <p className="muted small">Cotización {edad ? edad.texto : 'de fecha desconocida'}. Probabilidad estimada con Black-Scholes y la volatilidad implícita; no es una garantía. Griegas indicativas del proveedor.</p>
    </>
  );
}
