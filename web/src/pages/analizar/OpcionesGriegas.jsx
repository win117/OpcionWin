// Cadena de opciones con griegas (GET /mercado/opciones/resumen/:simbolo) y sonrisa de volatilidad.
import { useMemo, useState } from 'react';
import TicketOrden from '../../components/TicketOrden';
import { intencionPara } from '../../utils/estrategiasOrden';
import { SyncButton } from '../../components/SyncButton';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { Select } from '../../components/Field';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import { fmtFixed, fmtMoney, fmtPct, isNum } from '../../utils/format';

const f = (v, d = 3) => (isNum(v) ? fmtFixed(v, d) : '—');
const px = v => (isNum(v) ? fmtFixed(v, 2) : '—');
const iv = v => (isNum(v) ? fmtPct(v, 1) : '—');

/** Agrupa por strike: { strike, call, put }. */
export function porStrike(items) {
  const m = new Map();
  for (const it of items) {
    if (!isNum(it.strike)) continue;
    const row = m.get(it.strike) || { strike: it.strike };
    row[it.tipo === 'put' ? 'put' : 'call'] = it;
    m.set(it.strike, row);
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
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

function Lado({ o, lado, onOperar }) {
  const g = o?.griegas || {};
  const celdas = [iv(o?.volatilidadImplicita), f(g.delta), f(g.gamma, 4), f(g.theta), f(g.vega)];
  const boton = (accion, valor) => {
    const etiqueta = `${accion === 'buy' ? 'Comprar' : 'Vender'} ${o?.tipo === 'put' ? 'put' : 'call'} strike ${o?.strike} a ${accion === 'buy' ? 'ask' : 'bid'} ${valor}`;
    return o && o.contratoId && onOperar && isNum(valor)
      ? <button type="button" className="chain__px" onClick={() => onOperar(o, accion)} aria-label={etiqueta} title={etiqueta}>{px(valor)}</button>
      : px(valor);
  };
  return (
    <>
      {celdas.map((c, i) => <td key={lado + i} className={'num ' + lado}>{c}</td>)}
      <td className={'num ' + lado}>{boton('sell', o?.bid)}</td>
      <td className={'num ' + lado}>{boton('buy', o?.ask)}</td>
    </>
  );
}

export default function OpcionesGriegas({ simbolo, empresa }) {
  const [ticket, setTicket] = useState(null);
  const [venc, setVenc] = useState('');
  const state = useAsync(() => mercado.opcionesResumen(simbolo, { vencimiento: venc }), [simbolo, venc]);
  const d = state.data;
  const filas = useMemo(() => porStrike(d?.items || []), [d]);
  const precio = d?.precioSubyacente;
  const atm = useMemo(() => (isNum(precio) && filas.length ? filas.reduce((a, b) => (Math.abs(b.strike - precio) < Math.abs(a.strike - precio) ? b : a)).strike : null), [filas, precio]);
  const sync = <SyncButton recurso="contratos" simbolos={[simbolo]} onDone={state.reload} label="Sincronizar contratos" />;

  if (state.loading && !d) return <Loading text="Cargando cadena y griegas…" />;
  if (state.error && !d) {
    const noDisp = state.error.status === 404;
    return noDisp
      ? <Empty title="Resumen de opciones no disponible">El servidor aún no ofrece este recurso. Puedes sincronizar contratos y revisar la cadena en Mercado.</Empty>
      : <ErrorMessage error={state.error} onRetry={state.reload} />;
  }
  if (!d?.items?.length) {
    return (
      <div className="stack">
        <Empty title="Sin contratos de opciones">Sincroniza los contratos de {simbolo} para ver la cadena y las griegas.</Empty>
        <div className="toolbar">{sync}</div>
      </div>
    );
  }
  const vencs = d.vencimientos || [];
  const operar = (o, accion) => setTicket({ legs: [{ accion, intencion: intencionPara(accion), contratoId: o.contratoId }], chain: d });
  return (
    <div className="stack">
      <div className="toolbar">
        {vencs.length > 0 && (
          <label className="toolbar__filter"><span className="muted">Vencimiento </span>
            <Select value={d.vencimiento || venc} onChange={setVenc} options={vencs.map(v => ({ value: v, label: v }))} aria-label="Vencimiento" />
          </label>
        )}
        {sync}
      </div>
      {state.error && <Notice tone="warning">No se pudo actualizar: {state.error.message}</Notice>}
      <p className="muted small">Subyacente {fmtMoney(precio)} · {d.total ?? d.items.length} contratos · ITM sombreado, strike ATM resaltado.</p>
      <Sonrisa filas={filas} precio={precio} />
      <div className="table-wrap">
        <table className="table table--dense chain">
          <caption className="sr-only">Cadena de opciones de {simbolo}</caption>
          <thead>
            <tr><th colSpan="7" scope="colgroup" className="chain__grp chain__grp--call">Calls</th><th rowSpan="2" scope="col">Strike</th><th colSpan="7" scope="colgroup" className="chain__grp chain__grp--put">Puts</th></tr>
            <tr>{['IV', 'Δ', 'Γ', 'Θ', 'ν', 'Bid', 'Ask'].map(h => <th key={'c' + h} scope="col" className="num">{h}</th>)}{['IV', 'Δ', 'Γ', 'Θ', 'ν', 'Bid', 'Ask'].map(h => <th key={'p' + h} scope="col" className="num">{h}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map(r => (
              <tr key={r.strike} className={r.strike === atm ? 'chain__atm' : ''}>
                <Lado o={r.call} lado={isNum(precio) && r.strike < precio ? 'itm' : ''} onOperar={empresa ? operar : null} />
                <th scope="row" className="num chain__strike">{fmtFixed(r.strike, 2)}</th>
                <Lado o={r.put} lado={isNum(precio) && r.strike > precio ? 'itm' : ''} onOperar={empresa ? operar : null} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ticket && empresa && <TicketOrden open empresa={empresa} chain={ticket.chain} legs={ticket.legs} onClose={() => setTicket(null)} />}
    </div>
  );
}
