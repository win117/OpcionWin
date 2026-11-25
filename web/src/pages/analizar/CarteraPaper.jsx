// Cartera de la cuenta simulada: cuenta, posiciones abiertas (cierre por pata o por estructura) y órdenes recientes (con cancelación).
import { Fragment, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorMessage, Spinner } from '../../components/States';
import { MercadoCerrado } from '../../components/MercadoEstado';
import { useAsync } from '../../hooks/useAsync';
import { useEstadoMercado } from '../../hooks/useEstadoMercado';
import { ESTADOS_TERMINALES, useSeguimientoOrden } from '../../hooks/useSeguimientoOrden';
import { acciones, operacion } from '../../api/resources';
import { fmtDate, fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';
import { uuid } from '../../utils/objects';
import { cederPrecio } from '../../utils/estrategiasOrden';
import { ejecutado } from '../broker/ejecutado';
import HistorialCartera from './HistorialCartera';

const CANCELABLES = ['pendiente', 'enviada', 'aceptada', 'parcial'];
const REFRESH_MS = 30000;

const pl = v => (isNum(v) ? (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v)) : '—');
const cls = v => (isNum(v) ? (v >= 0 ? 'up' : 'down') : '');

function resumenPatas(o) {
  return (o.componentes || []).map(c => `${c.accion === 'sell' ? 'Vender' : 'Comprar'} ${c.simbolo}`).join(' · ') || '—';
}

const mcd = (a, b) => (b ? mcd(b, a % b) : a);
const MENSAJE_CIERRE = { ejecutada: 'Posición cerrada.', cancelada: 'Orden de cierre cancelada: la posición sigue abierta.', rechazada: 'El broker rechazó el cierre: la posición sigue abierta.',
  expirada: 'La orden venció sin ejecutarse: la posición sigue abierta.', parcial: 'Cierre parcial: falta el resto.' };
const LADO = { long: 'comprada', short: 'vendida' };
const netoSigno = p => (p.lado === 'short' ? -1 : 1); // cerrar un largo cobra; cerrar un corto paga

/** Agrupa las patas de una misma estructura: grupo del broker o mismo subyacente y vencimiento. */
function agrupar(posiciones) {
  const grupos = new Map();
  posiciones.forEach((p, i) => {
    const clave = p.grupoId ? 'g:' + p.grupoId : p.tipo && p.vencimiento ? p.subyacente + '|' + p.vencimiento : 'u:' + i;
    grupos.set(clave, [...(grupos.get(clave) || []), p]);
  });
  return [...grupos.values()];
}

/** Cerrar solo esta pata larga dejaría más opciones cortas que largas del mismo tipo. */
function dejaCortaDescubierta(p, grupo) {
  if (p.lado !== 'long') return false;
  const resto = grupo.filter(x => x !== p && x.tipo === p.tipo);
  const suma = lado => resto.filter(x => x.lado === lado).reduce((n, x) => n + (x.cantidad || 0), 0);
  return suma('short') > suma('long');
}

const puedeCerrarGrupo = g => g.length >= 2 && g.length <= 4 && new Set(g.map(p => p.contratoId)).size === g.length && g.every(p => p.posicionId && p.cerrable !== false);
const motivoNoCerrable = p => (!p.posicionId ? 'Posición no sincronizada: sincroniza posiciones para poder cerrarla'
  : p.cerrable === false ? 'El broker no informa el lado o la cantidad de esta pata: ciérrala en su plataforma' : undefined);

/** Cierre de una posición o de una estructura completa (una sola orden). `cierre`: { posiciones, grupo }. */
function CerrarModal({ cierre, broker, onClose, onDone }) {
  const { posiciones, grupo } = cierre;
  const estado = useEstadoMercado(), cerrado = estado.data?.abierto === false;
  const esGrupo = posiciones.length > 1;
  const sinMercado = esGrupo && broker === 'webull'; // Webull solo admite estructuras a limite
  const unidades = posiciones.map(p => p.cantidad).reduce(mcd);
  const conPrecio = posiciones.every(p => isNum(p.precioActual));
  const neto = conPrecio ? posiciones.reduce((n, p) => n + netoSigno(p) * p.precioActual * p.cantidad, 0) / unidades : null;
  const [tipo, setTipo] = useState(esGrupo ? 'limit' : 'market');
  const [limite, setLimite] = useState(esGrupo && isNum(neto) && Math.abs(neto) >= 0.01 ? Math.abs(neto).toFixed(2) : '');
  const [sentido, setSentido] = useState(isNum(neto) ? (neto >= 0 ? 'credito' : 'debito') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const clave = useRef(null);
  const editar = fn => v => { clave.current = null; setError(null); fn(v); }; // otros datos = otra clave de idempotencia
  const cobra = esGrupo ? sentido === 'credito' : posiciones[0].lado !== 'short';
  const unit = tipo === 'limit' && Number(limite) > 0 ? Number(limite) : isNum(neto) ? Math.abs(neto) : null;
  const monto = isNum(unit) ? unit * 100 * unidades : null;
  const limiteOk = tipo === 'market' || Number(limite) > 0;
  const listo = limiteOk && (!esGrupo || sentido);
  const descubre = !esGrupo && dejaCortaDescubierta(posiciones[0], grupo);

  // Seguimiento del cierre hasta estado final: enviar no es lo mismo que haber cerrado.
  const [cancelando, setCancelando] = useState(false);
  const okId = ok?._id, terminado = ESTADOS_TERMINALES.includes(ok?.estado);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const sig = useSeguimientoOrden(okId, { activo: !terminado, alCambio: setOk });
  useEffect(() => { if (okId && terminado) doneRef.current?.(); }, [okId, terminado]);

  const cancelarCierre = async () => {
    setCancelando(true); setError(null);
    try { const r = await acciones.cancelarOrden(okId); setOk(r?.orden || r); } catch (e) { setError(e); } finally { setCancelando(false); }
  };
  const otroPrecio = () => { clave.current = null; setOk(null); setError(null); };
  const ejecutadas = ok?.cantidadEjecutada || 0;
  const puedeReintentar = terminado && ok.estado !== 'ejecutada' && !ejecutadas; // con un cierre parcial, las cantidades de esta ventana ya no valen

  const confirmar = async () => {
    if (!clave.current) clave.current = uuid(); // se reutiliza en reintentos
    setBusy(true); setError(null);
    const body = { tipo, ...(tipo === 'limit' ? { precioLimite: Number(limite) } : {}) };
    try {
      const r = esGrupo
        ? await operacion.cerrarGrupo({ ...body, posicionIds: posiciones.map(p => p.posicionId), credito: sentido === 'credito' }, clave.current)
        : await operacion.cerrarPosicion(posiciones[0].posicionId, body, clave.current);
      setOk(r?.orden || r);
      onDone?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal open title={esGrupo ? 'Cerrar estructura' : 'Cerrar posición'} onClose={onClose} size="sm"
      footer={ok ? (
        <>
          {!terminado && <button type="button" className="btn btn--danger" onClick={cancelarCierre} disabled={cancelando}>{cancelando ? 'Cancelando…' : 'Cancelar orden'}</button>}
          {puedeReintentar && <button type="button" className="btn" onClick={otroPrecio}>Intentar con otro precio</button>}
          <button type="button" className="btn btn--primary" onClick={onClose}>Cerrar ventana</button>
        </>
      ) : (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn--danger" onClick={confirmar} disabled={busy || !listo || cerrado}>{cerrado ? 'Mercado cerrado' : busy ? 'Enviando…' : 'Confirmar cierre simulado'}</button>
        </>
      )}>
      <div className="stack">
        <div className="banner-paper" role="note"><strong>Orden simulada.</strong> No se usa dinero real.</div>
        {ok ? (
          <>
            <div className={'alert ' + (ok.estado === 'ejecutada' ? 'alert--success' : terminado ? 'alert--warning' : 'alert--info')} role="status">
              <div>
                <strong>{MENSAJE_CIERRE[ok.estado] || 'Orden de cierre enviada. Aún no se ejecuta.'}</strong> <Badge value={ok.estado || 'enviada'} />
                {ok.estado === 'ejecutada' && isNum(ok.precioPromedioEjecucion) && <p className="small">{cobra ? 'Cobraste' : 'Pagaste'} {fmtMoney(ok.precioPromedioEjecucion * 100 * unidades)} (precio {fmtFixed(ok.precioPromedioEjecucion)} × 100 × {unidades}).</p>}
                {terminado && ok.estado !== 'ejecutada' && ejecutadas > 0 && <p className="small">Se cerraron {ejecutadas} antes de terminar; revisa en Posiciones lo que queda.</p>}
                {ok.estado === 'rechazada' && ok.eventos?.length > 0 && <p className="small">{ok.eventos[ok.eventos.length - 1].mensaje}</p>}
                {!terminado && sig.siguiendo && <p className="small muted"><Spinner small /> {sig.enVivo ? 'El broker avisa en vivo…' : 'Esperando al broker…'}</p>}
              </div>
            </div>
            {sig.lenta && !terminado && <div className="alert alert--warning" role="alert">Sigue abierta: nadie ha aceptado tu precio y la posición todavía no está cerrada. Puedes esperar (la verás en Órdenes) o cancelarla aquí y ceder un poco.</div>}
            {error && <div className="alert alert--danger" role="alert">{error.message}</div>}
          </>
        ) : (
          <>
            {cerrado && <MercadoCerrado estado={estado.data}>Puedes preparar el cierre; el envío se habilita solo al abrir.</MercadoCerrado>}
            {esGrupo && <p>Una sola orden cierra las {posiciones.length} patas:</p>}
            <ul className="list">
              {posiciones.map(p => <li key={p.posicionId}>{p.lado === 'short' ? 'Comprar' : 'Vender'} {p.cantidad} × <strong>{p.simbolo}</strong> para cerrar la posición {LADO[p.lado] || ''}.</li>)}
            </ul>
            {descubre && <div className="alert alert--warning" role="alert">Esta pata cubre una opción vendida del mismo vencimiento: si la cierras sola, la pata corta queda descubierta. Considera «Cerrar estructura».</div>}
            <Field label="Tipo de orden">
              <select value={tipo} onChange={e => editar(setTipo)(e.target.value)}><option value="market" disabled={sinMercado}>Mercado{sinMercado ? ' (no disponible en Webull)' : ''}</option><option value="limit">Límite</option></select>
            </Field>
            {esGrupo && (
              <Field label="Neto del cierre" error={sentido ? null : 'Elige si cobras o pagas'}>
                <select value={sentido} onChange={e => editar(setSentido)(e.target.value)}>
                  {!sentido && <option value="">Elige…</option>}
                  <option value="credito">Crédito (cobras)</option><option value="debito">Débito (pagas)</option>
                </select>
              </Field>
            )}
            {tipo === 'limit' && (
              <Field label={esGrupo ? 'Precio límite neto por unidad' : 'Precio límite por contrato'} error={limiteOk ? null : 'Mayor que cero'}>
                <input type="number" min="0.01" step="0.01" value={limite} onChange={e => editar(setLimite)(e.target.value)} inputMode="decimal" />
              </Field>
            )}
            {tipo === 'limit' && isNum(neto) && Math.abs(neto) >= 0.01 && (
              <div className="ticket__precios small" role="group" aria-label="Atajos de precio">
                {[0, 0.05, 0.1, 0.2].map(x => <button key={x} type="button" className="btn btn--sm" onClick={() => editar(setLimite)(x ? cederPrecio(Math.abs(neto), x, cobra).toFixed(2) : Math.abs(neto).toFixed(2))}>{x ? `Ceder ${x * 100} %` : 'Último precio'}</button>)}
                <span className="muted">Si no se ejecuta, cancela y cede un poco: {cobra ? 'cobras menos' : 'pagas más'}, pero cierras antes.</span>
              </div>
            )}
            <p className="small">{cobra ? 'Producto estimado' : 'Costo estimado'}: <strong>{isNum(monto) ? fmtMoney(monto) : '—'}</strong> <span className="muted">(precio {isNum(unit) ? fmtFixed(unit) : '—'} × 100 × {unidades})</span></p>
            {error && <div className="alert alert--danger" role="alert">{error.message} Puedes reintentar con seguridad (misma clave de idempotencia).</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

/** vista: 'todo' | 'posiciones' | 'ordenes'. `broker`: código del broker elegido (alpaca|webull). `noOperativo`: por qué no se puede operar con él. */
export default function CarteraPaper({ nombre = 'el broker', broker, vista = 'todo', noOperativo = null }) {
  const st = useAsync(() => operacion.resumen(broker), [broker]);
  const [cerrar, setCerrar] = useState(null);
  const [cancelando, setCancelando] = useState(null);
  const [errAccion, setErrAccion] = useState(null);
  const reloadRef = useRef(st.reload);
  reloadRef.current = st.reload;

  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') reloadRef.current(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const d = st.data;
  const cuenta = d?.cuenta;
  const posiciones = d?.posiciones || [];
  const ordenes = [...(d?.ordenes || [])].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, vista === 'ordenes' ? 50 : 10);

  const cancelar = async o => {
    setCancelando(o._id); setErrAccion(null);
    try { await acciones.cancelarOrden(o._id); st.reload(); } catch (e) { setErrAccion(e); } finally { setCancelando(null); }
  };

  return (
    <section className="card cartera" aria-labelledby="cartera-titulo">
      <div className="section-head">
        <h2 id="cartera-titulo">Cuenta simulada</h2>
        <button type="button" className="btn btn--sm" onClick={st.reload} disabled={st.loading}>{st.loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div className="cartera__body">
        {noOperativo && <div className="alert alert--warning" role="alert"><div><strong>{nombre} no está operativo.</strong> {noOperativo}</div></div>}
        {st.error && !d && <ErrorMessage error={st.error} onRetry={st.reload} title="No se pudo cargar la cartera" />}
        {st.loading && !d && <p className="muted" role="status"><Spinner small /> Cargando cartera…</p>}
        {st.error && d && <p className="small down" role="alert">No se pudo actualizar: {st.error.message}</p>}
        {d?.avisoSincronizacion && <div className="alert alert--warning" role="alert">{d.avisoSincronizacion}</div>}
        {d?.ordenesExternas?.length > 0 && (
          <div className="alert alert--info" role="note"><div><strong>{d.ordenesExternas.length === 1 ? 'Hay 1 orden abierta' : `Hay ${d.ordenesExternas.length} órdenes abiertas`} en {nombre} que no se enviaron desde tu sesión.</strong> Se administran donde se crearon: {d.ordenesExternas.map(resumenPatas).join(' | ')}</div></div>
        )}
        {errAccion && <ErrorMessage error={errAccion} title="No se pudo cancelar" />}
        {d && (
          <>
            {cuenta ? (
              <dl className="stats stats--row">
                <div><dt>Valor del portafolio</dt><dd>{fmtMoney(cuenta.patrimonio ?? cuenta.valorPortafolio ?? cuenta.equity)}</dd></div>
                <div><dt>Efectivo</dt><dd>{fmtMoney(cuenta.efectivo)}</dd></div>
                <div><dt>Poder de compra</dt><dd>{fmtMoney(cuenta.poderCompra)}</dd></div>
              </dl>
            ) : !noOperativo && (
              <div className="alert alert--warning" role="note">No hay datos de la cuenta simulada de {nombre}{d.error ? ': ' + d.error : '.'} Revisa las credenciales del broker en el servidor.</div>
            )}

            {vista !== 'ordenes' && cuenta && <HistorialCartera broker={broker} nombre={nombre} actual={cuenta.patrimonio} />}
            {vista !== 'ordenes' && <h3>Posiciones abiertas</h3>}
            {vista !== 'ordenes' && (posiciones.length === 0 ? <p className="muted small">{d.posicionesDisponibles === false ? 'Posiciones no disponibles por ahora.' : 'Sin posiciones abiertas.'}</p> : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <caption className="sr-only">Posiciones abiertas</caption>
                  <thead><tr><th scope="col">Contrato</th><th scope="col">Subyac.</th><th scope="col">Tipo</th><th scope="col" className="num">Strike</th><th scope="col">Venc.</th><th scope="col">Lado</th><th scope="col" className="num">Cant.</th><th scope="col" className="num">Prom.</th><th scope="col" className="num">Actual</th><th scope="col" className="num">P/L</th><th scope="col" className="num">P/L %</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>
                    {agrupar(posiciones).map((g, gi) => (
                    <Fragment key={gi}>
                    {g.length > 1 && (
                      <tr>
                        <th scope="rowgroup" colSpan={11}>{g[0].subyacente} · {fmtDate(g[0].vencimiento)} · {g.length} patas</th>
                        <td><button type="button" className="btn btn--sm btn--primary" onClick={() => setCerrar({ posiciones: g, grupo: g })} disabled={!puedeCerrarGrupo(g)} title={puedeCerrarGrupo(g) ? undefined : g.length > 4 ? 'Más de 4 patas: ciérralas por separado' : 'Alguna pata no se puede cerrar desde aquí'} aria-label={`Cerrar estructura ${g[0].subyacente} ${g[0].vencimiento}`}>Cerrar estructura</button></td>
                      </tr>
                    )}
                    {g.map((p, i) => (
                      <tr key={p.posicionId || p.simbolo + i}>
                        <td><code>{p.simbolo}</code></td>
                        <td>{p.subyacente}</td>
                        <td>{p.tipo === 'put' ? 'Put' : p.tipo === 'call' ? 'Call' : '—'}</td>
                        <td className="num">{fmtFixed(p.strike)}</td>
                        <td>{fmtDate(p.vencimiento)}</td>
                        <td>{p.lado ? <Badge tone={p.lado === 'short' ? 'warning' : 'info'}>{LADO[p.lado]}</Badge> : '—'}</td>
                        <td className="num">{p.cantidad ?? '—'}</td>
                        <td className="num">{fmtMoney(p.precioPromedio)}</td>
                        <td className="num">{fmtMoney(p.precioActual)}</td>
                        <td className={'num ' + cls(p.pl)}>{pl(p.pl)}</td>
                        <td className={'num ' + cls(p.plPct)}>{isNum(p.plPct) ? (p.plPct >= 0 ? '+' : '−') + fmtPct(Math.abs(p.plPct) / 100, 1) : '—'}</td>
                        <td><button type="button" className="btn btn--sm" onClick={() => setCerrar({ posiciones: [p], grupo: g })} disabled={Boolean(motivoNoCerrable(p))} title={motivoNoCerrable(p)} aria-label={'Cerrar ' + p.simbolo}>Cerrar</button></td>
                      </tr>
                    ))}
                    </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {vista !== 'posiciones' && <h3>Órdenes recientes</h3>}
            {vista !== 'posiciones' && (ordenes.length === 0 ? <p className="muted small">Sin órdenes recientes.</p> : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <caption className="sr-only">Órdenes recientes</caption>
                  <thead><tr><th scope="col">Estado</th><th scope="col">Patas</th><th scope="col" className="num">Cant.</th><th scope="col" className="num">Límite</th><th scope="col" className="num">Ejecutado</th><th scope="col">Fecha</th><th scope="col">Último evento</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>
                    {ordenes.map(o => {
                      const ev = o.eventos?.length ? o.eventos[o.eventos.length - 1] : null;
                      return (
                        <tr key={o._id}>
                          <td><Badge value={o.estado} /></td>
                          <td>{resumenPatas(o)}</td>
                          <td className="num">{o.cantidad ?? '—'}</td>
                          <td className="num">{isNum(o.precioLimite) ? fmtMoney(o.precioLimite) : o.tipo === 'market' ? 'Mercado' : '—'}</td>
                          <td className="num">{ejecutado(o)}</td>
                          <td>{fmtDateTime(o.createdAt)}</td>
                          <td className="small">{ev?.mensaje || '—'}</td>
                          <td>{CANCELABLES.includes(o.estado) && <button type="button" className="btn btn--sm" onClick={() => cancelar(o)} disabled={cancelando === o._id} aria-label={'Cancelar orden ' + resumenPatas(o)}>{cancelando === o._id ? 'Cancelando…' : 'Cancelar'}</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </div>
      {cerrar && <CerrarModal broker={broker} cierre={cerrar} onClose={() => setCerrar(null)} onDone={st.reload} />}
    </section>
  );
}
