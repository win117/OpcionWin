import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ticksRedondos } from '../utils/analisis';
import { fmtMoney, fmtNum, isNum } from '../utils/format';

// El cálculo (puro y probado) vive en utils/estrategiasOrden.
export { analyzePayoff, payoffAt } from '../utils/estrategiasOrden';

const H = 240, M = { top: 18, right: 12, bottom: 26, left: 52 };

/** Ancho real del contenedor: el dibujo se hace a tamaño 1:1 y el texto no se escala. */
function useAncho(inicial) {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const obs = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setAncho(w); });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, Math.max(220, ancho)];
}

const redondo = v => fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 2 : 1);

/** Ganancia o pérdida al vencimiento. `movimiento` = { monto, abajo, arriba }: rango que el mercado espera. */
export function PayoffChart({ analysis, spot, movimiento }) {
  const [caja, W] = useAncho(340);
  const [hover, setHover] = useState(null);
  const id = useId();
  const g = useMemo(() => {
    if (!analysis) return null;
    const { points, min, max } = analysis;
    const ys = points.map(p => p[1]);
    let yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
    if (yMax - yMin < 1) { yMax += 1; yMin -= 1; }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad; yMax += yPad;
    const x = s => M.left + ((s - min) / (max - min)) * (W - M.left - M.right);
    const y = v => M.top + (1 - (v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);
    const line = points.map(([s, v], i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(max).toFixed(1)},${y(0).toFixed(1)} L${x(min).toFixed(1)},${y(0).toFixed(1)} Z`;
    return { x, y, line, area, y0: y(0), ticksY: ticksRedondos(yMin, yMax, 5), ticksX: ticksRedondos(min, max, Math.max(3, Math.floor((W - M.left - M.right) / 62))) };
  }, [analysis, W]);

  if (!analysis || !g) return null;
  const { x, y, line, area, y0, ticksY, ticksX } = g;
  const { min, max } = analysis;
  const dentro = v => Math.max(min, Math.min(max, v));
  const banda = movimiento && movimiento.arriba > min && movimiento.abajo < max ? [x(dentro(movimiento.abajo)), x(dentro(movimiento.arriba))] : null;
  const conPrecio = isNum(spot) && spot > min && spot < max;
  const derecha = conPrecio && x(spot) > W - 90; // la etiqueta no se sale por la derecha

  const onMove = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const s = min + ((event.clientX - rect.left - M.left) / (W - M.left - M.right)) * (max - min);
    if (s < min || s > max) { setHover(null); return; }
    setHover({ s, v: analysis.points.reduce((best, p) => (Math.abs(p[0] - s) < Math.abs(best[0] - s) ? p : best))[1] });
  };

  return (
    <figure className="payoff" ref={caja}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Ganancia o pérdida al vencimiento según el precio de la acción" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <clipPath id={id + 'a'}><rect x="0" y="0" width={W} height={Math.max(0, y0)} /></clipPath>
          <clipPath id={id + 'b'}><rect x="0" y={y0} width={W} height={Math.max(0, H - y0)} /></clipPath>
        </defs>
        {banda && <rect x={banda[0]} width={Math.max(0, banda[1] - banda[0])} y={M.top} height={H - M.top - M.bottom} className="payoff__banda" />}
        {ticksY.map(t => (
          <g key={'y' + t}>
            {t !== 0 && <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="chart__grid" />}
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" className={'chart__tick' + (t === 0 ? ' chart__tick--cero' : '')}>{t === 0 ? '$0' : redondo(t)}</text>
          </g>
        ))}
        {ticksX.map(t => <text key={'x' + t} x={x(t)} y={H - 8} textAnchor="middle" className="chart__tick">{redondo(t)}</text>)}
        <path d={area} className="payoff__area payoff__area--gain" clipPath={`url(#${id}a)`} />
        <path d={area} className="payoff__area payoff__area--loss" clipPath={`url(#${id}b)`} />
        <line x1={M.left} x2={W - M.right} y1={y0} y2={y0} className="chart__zero" />
        {analysis.strikes.map((k, i) => <line key={'k' + i} x1={x(k)} x2={x(k)} y1={M.top} y2={H - M.bottom} className="payoff__strike" />)}
        {conPrecio && (
          <g>
            <line x1={x(spot)} x2={x(spot)} y1={M.top} y2={H - M.bottom} className="payoff__spot" />
            <text x={x(spot)} y={M.top - 6} textAnchor={derecha ? 'end' : 'middle'} className="chart__tick">hoy {redondo(spot)}</text>
          </g>
        )}
        <path d={line} className="payoff__line" />
        {analysis.breakevens.filter(b => b >= min && b <= max).map(b => <circle key={'b' + b} cx={x(b)} cy={y0} r="4" className="payoff__be" />)}
        {hover && (
          <g>
            <line x1={x(hover.s)} x2={x(hover.s)} y1={M.top} y2={H - M.bottom} className="chart__cursor" />
            <circle cx={x(hover.s)} cy={y(hover.v)} r="4" className="payoff__dot" />
          </g>
        )}
      </svg>
      <figcaption className="muted small">
        <span className="payoff__lectura">{hover ? <>Si la acción vence en {fmtMoney(hover.s)}: {fmtMoney(hover.v)}</> : 'Ganancia o pérdida en dólares al vencimiento, según el precio de la acción.'}</span>
        <span className="payoff__leyenda">
          <span><i className="payoff__clave payoff__clave--be" /> equilibrio</span>
          <span><i className="payoff__clave payoff__clave--strike" /> strike</span>
          {movimiento && <span><i className="payoff__clave payoff__clave--banda" /> movimiento esperado ±{fmtMoney(movimiento.monto)}</span>}
        </span>
      </figcaption>
    </figure>
  );
}
