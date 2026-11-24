// Cartera paper: cuenta, posiciones abiertas (con cierre) y órdenes recientes (con cancelación).
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ErrorMessage, Spinner } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { acciones, operacion } from '../../api/resources';
import { fmtDate, fmtDateTime, fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';
import { uuid } from '../../utils/objects';

const CANCELABLES = ['pendiente', 'enviada', 'aceptada', 'parcial'];
const REFRESH_MS = 30000;

const pl = v => (isNum(v) ? (v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v)) : '—');
const cls = v => (isNum(v) ? (v >= 0 ? 'up' : 'down') : '');

function resumenPatas(o) {
  return (o.componentes || []).map(c => `${c.accion === 'sell' ? 'Vender' : 'Comprar'} ${c.simbolo}`).join(' · ') || '—';
}

function CerrarModal({ posicion, onClose, onDone }) {
  const [tipo, setTipo] = useState('market');
  const [limite, setLimite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const clave = useRef(null);
  const p = posicion;
  const largo = p?.lado !== 'short';
  const unit = tipo === 'limit' && Number(limite) > 0 ? Number(limite) : p?.precioActual;
  const monto = isNum(unit) && p ? unit * 100 * p.cantidad : null;
  const limiteOk = tipo === 'market' || Number(limite) > 0;

  const confirmar = async () => {
    if (!clave.current) clave.current = uuid(); // se reutiliza en reintentos
    setBusy(true); setError(null);
    try {
      const orden = await operacion.cerrarPosicion(p.posicionId, { tipo, ...(tipo === 'limit' ? { precioLimite: Number(limite) } : {}) }, clave.current);
      setOk(orden?.orden || orden);
      onDone?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={Boolean(p)} title="Cerrar posición" onClose={onClose} size="sm"
      footer={ok ? <button type="button" className="btn btn--primary" onClick={onClose}>Cerrar ventana</button> : (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn--danger" onClick={confirmar} disabled={busy || !limiteOk}>{busy ? 'Enviando…' : 'Confirmar cierre (paper)'}</button>
        </>
      )}>
      {p && (
        <div className="stack">
          <div className="banner-paper" role="note"><strong>PAPER · dinero simulado.</strong></div>
          {ok ? (
            <div className="alert alert--success" role="status">Orden de cierre enviada. Estado: <Badge value={ok.estado || 'enviada'} />.</div>
          ) : (
            <>
              <p>{largo ? 'Vender' : 'Comprar'} {p.cantidad} × <strong>{p.simbolo}</strong> para cerrar la posición {p.lado}.</p>
              <Field label="Tipo de orden">
                <select value={tipo} onChange={e => setTipo(e.target.value)}><option value="market">Mercado</option><option value="limit">Límite</option></select>
              </Field>
              {tipo === 'limit' && (
                <Field label="Precio límite por contrato" error={limiteOk ? null : 'Mayor que cero'}>
                  <input type="number" min="0.01" step="0.01" value={limite} onChange={e => setLimite(e.target.value)} inputMode="decimal" />
                </Field>
              )}
              <p className="small">{largo ? 'Producto estimado' : 'Costo estimado'}: <strong>{isNum(monto) ? fmtMoney(monto) : '—'}</strong> <span className="muted">(precio {isNum(unit) ? fmtFixed(unit) : '—'} × 100 × {p.cantidad})</span></p>
              {error && <div className="alert alert--danger" role="alert">{error.message} Puedes reintentar con seguridad (misma clave de idempotencia).</div>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** vista: 'todo' | 'posiciones' | 'ordenes'. `broker`: código del broker elegido (alpaca|webull). */
export default function CarteraPaper({ titulo = 'Cartera paper', broker, vista = 'todo' }) {
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
    <section className="inicio-sec cartera" aria-label={titulo}>
      <div className="inicio-sec__head">
        <h2>{titulo}</h2>
        <button type="button" className="btn btn--sm" onClick={st.reload} disabled={st.loading}>{st.loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div className="inicio-card cartera__body">
        <div className="banner-paper" role="note"><strong>PAPER · dinero simulado.</strong> Se actualiza cada 30 s.</div>
        {st.error && !d && <ErrorMessage error={st.error} onRetry={st.reload} title="No se pudo cargar la cartera" />}
        {st.loading && !d && <p className="muted" role="status"><Spinner small /> Cargando cartera…</p>}
        {st.error && d && <p className="small down" role="alert">No se pudo actualizar: {st.error.message}</p>}
        {errAccion && <ErrorMessage error={errAccion} title="No se pudo cancelar" />}
        {d && (
          <>
            {cuenta ? (
              <dl className="stats stats--row">
                <div><dt>Valor del portafolio</dt><dd>{fmtMoney(cuenta.patrimonio ?? cuenta.valorPortafolio ?? cuenta.equity)}</dd></div>
                <div><dt>Efectivo</dt><dd>{fmtMoney(cuenta.efectivo)}</dd></div>
                <div><dt>Poder de compra</dt><dd>{fmtMoney(cuenta.poderCompra)}</dd></div>
              </dl>
            ) : (
              <div className="alert alert--warning" role="note">No hay datos de la cuenta paper{broker ? ' de ' + broker : ''}{d.error ? ': ' + d.error : '.'} Revisa las credenciales del broker en el servidor.</div>
            )}

            {vista !== 'ordenes' && <h3>Posiciones abiertas</h3>}
            {vista !== 'ordenes' && (posiciones.length === 0 ? <p className="muted small">Sin posiciones abiertas.</p> : (
              <div className="table-wrap">
                <table className="table table--dense">
                  <caption className="sr-only">Posiciones abiertas</caption>
                  <thead><tr><th scope="col">Contrato</th><th scope="col">Subyac.</th><th scope="col">Tipo</th><th scope="col" className="num">Strike</th><th scope="col">Venc.</th><th scope="col">Lado</th><th scope="col" className="num">Cant.</th><th scope="col" className="num">Prom.</th><th scope="col" className="num">Actual</th><th scope="col" className="num">P/L</th><th scope="col" className="num">P/L %</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>
                    {posiciones.map((p, i) => (
                      <tr key={p.posicionId || p.simbolo + i}>
                        <td><code>{p.simbolo}</code></td>
                        <td>{p.subyacente}</td>
                        <td>{p.tipo === 'put' ? 'Put' : 'Call'}</td>
                        <td className="num">{fmtFixed(p.strike)}</td>
                        <td>{fmtDate(p.vencimiento)}</td>
                        <td><Badge value={p.lado} tone={p.lado === 'short' ? 'warning' : 'info'} /></td>
                        <td className="num">{p.cantidad}</td>
                        <td className="num">{fmtMoney(p.precioPromedio)}</td>
                        <td className="num">{fmtMoney(p.precioActual)}</td>
                        <td className={'num ' + cls(p.pl)}>{pl(p.pl)}</td>
                        <td className={'num ' + cls(p.plPct)}>{isNum(p.plPct) ? (p.plPct >= 0 ? '+' : '−') + fmtPct(Math.abs(p.plPct) / 100, 1) : '—'}</td>
                        <td><button type="button" className="btn btn--sm" onClick={() => setCerrar(p)} disabled={!p.posicionId} title={p.posicionId ? undefined : 'Posición no sincronizada: sincroniza posiciones para poder cerrarla'} aria-label={'Cerrar ' + p.simbolo}>Cerrar</button></td>
                      </tr>
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
                  <thead><tr><th scope="col">Estado</th><th scope="col">Patas</th><th scope="col" className="num">Cant.</th><th scope="col" className="num">Límite</th><th scope="col">Fecha</th><th scope="col">Último evento</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>
                    {ordenes.map(o => {
                      const ev = o.eventos?.length ? o.eventos[o.eventos.length - 1] : null;
                      return (
                        <tr key={o._id}>
                          <td><Badge value={o.estado} /></td>
                          <td>{resumenPatas(o)}</td>
                          <td className="num">{o.cantidad ?? '—'}</td>
                          <td className="num">{isNum(o.precioLimite) ? fmtMoney(o.precioLimite) : o.tipo === 'market' ? 'Mercado' : '—'}</td>
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
      {cerrar && <CerrarModal posicion={cerrar} onClose={() => setCerrar(null)} onDone={st.reload} />}
    </section>
  );
}
