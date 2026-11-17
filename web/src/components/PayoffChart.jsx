import { useMemo, useState } from 'react';
import { fmtMoney, fmtNum } from '../utils/format';

/*
 * Pago al vencimiento calculado en el cliente a partir de las patas:
 * legs: [{ tipo: 'call'|'put', strike, accion: 'buy'|'sell', cantidad, multiplicador, prima }]
 * P/L(S) = Σ signo · cantidad · multiplicador · (intrínseco(S) − prima), signo +1 compra, −1 venta.
 */
export function payoffAt(legs, S) {
  return legs.reduce((sum, leg) => {
    const intrinsic = leg.tipo === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
    const sign = leg.accion === 'sell' ? -1 : 1;
    return sum + sign * leg.cantidad * leg.multiplicador * (intrinsic - (leg.prima || 0));
  }, 0);
}

export function analyzePayoff(legs, samples = 240) {
  if (!legs.length) return null;
  const strikes = legs.map(l => l.strike);
  const lo = Math.min(...strikes), hi = Math.max(...strikes);
  const pad = Math.max((hi - lo) * 0.6, hi * 0.15, 1);
  const min = Math.max(0, lo - pad), max = hi + pad;
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const S = min + ((max - min) * i) / samples;
    points.push([S, payoffAt(legs, S)]);
  }
  // Incluir los strikes exactos para no perder vértices.
  for (const k of strikes) points.push([k, payoffAt(legs, k)]);
  points.sort((a, b) => a[0] - b[0]);
  const breakevens = [];
  for (let i = 1; i < points.length; i++) {
    const [s0, p0] = points[i - 1], [s1, p1] = points[i];
    if (p0 === 0 && i >= 2 && points[i - 2][1] !== 0 && p1 !== 0) breakevens.push(s0);
    else if ((p0 < 0 && p1 > 0) || (p0 > 0 && p1 < 0)) breakevens.push(s0 + ((s1 - s0) * -p0) / (p1 - p0));
  }
  const values = points.map(p => p[1]);
  // Pendiente en los extremos: indica pérdida/ganancia ilimitada.
  const slopeRight = payoffAt(legs, max * 2) - payoffAt(legs, max);
  return {
    points, min, max, strikes,
    breakevens: [...new Set(breakevens.map(b => Math.round(b * 100) / 100))],
    maxGain: Math.max(...values), maxLoss: Math.min(...values),
    gainUnbounded: slopeRight > 1e-9, lossUnbounded: slopeRight < -1e-9,
  };
}

const W = 640, H = 300, M = { top: 16, right: 16, bottom: 34, left: 64 };

function ticks(min, max, count = 5) {
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

export function PayoffChart({ analysis, spot }) {
  const [hover, setHover] = useState(null);
  const geometry = useMemo(() => {
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
    return { x, y, line, area, yMin, yMax, y0: y(0) };
  }, [analysis]);

  if (!analysis || !geometry) return null;
  const { x, y, line, area, yMin, yMax, y0 } = geometry;
  const { min, max } = analysis;

  const onMove = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const s = min + ((px - M.left) / (W - M.left - M.right)) * (max - min);
    if (s < min || s > max) { setHover(null); return; }
    setHover({ s, v: analysis.points.reduce((best, p) => (Math.abs(p[0] - s) < Math.abs(best[0] - s) ? p : best))[1] });
  };

  return (
    <figure className="payoff">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de pago al vencimiento" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <clipPath id="payoff-above"><rect x="0" y="0" width={W} height={Math.max(0, y0)} /></clipPath>
          <clipPath id="payoff-below"><rect x="0" y={y0} width={W} height={Math.max(0, H - y0)} /></clipPath>
        </defs>
        {ticks(yMin, yMax).map(t => (
          <g key={'y' + t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">{fmtNum(t, 0)}</text>
          </g>
        ))}
        {ticks(min, max).map(t => (
          <text key={'x' + t} x={x(t)} y={H - 12} textAnchor="middle" className="chart__tick">{fmtNum(t, 2)}</text>
        ))}
        <path d={area} className="payoff__area payoff__area--gain" clipPath="url(#payoff-above)" />
        <path d={area} className="payoff__area payoff__area--loss" clipPath="url(#payoff-below)" />
        <line x1={M.left} x2={W - M.right} y1={y0} y2={y0} className="chart__zero" />
        {analysis.strikes.map((k, i) => (
          <line key={'k' + i} x1={x(k)} x2={x(k)} y1={M.top} y2={H - M.bottom} className="payoff__strike" />
        ))}
        {spot > min && spot < max && (
          <g>
            <line x1={x(spot)} x2={x(spot)} y1={M.top} y2={H - M.bottom} className="payoff__spot" />
            <text x={x(spot) + 4} y={M.top + 10} className="chart__tick">subyacente</text>
          </g>
        )}
        <path d={line} className="payoff__line" />
        {analysis.breakevens.map(b => <circle key={'b' + b} cx={x(b)} cy={y0} r="4" className="payoff__be" />)}
        {hover && (
          <g>
            <line x1={x(hover.s)} x2={x(hover.s)} y1={M.top} y2={H - M.bottom} className="chart__cursor" />
            <circle cx={x(hover.s)} cy={y(hover.v)} r="4" className="payoff__dot" />
          </g>
        )}
      </svg>
      <figcaption className="muted">
        {hover
          ? <>Subyacente {fmtMoney(hover.s)} → P/L {fmtMoney(hover.v)}</>
          : <>Eje X: precio del subyacente al vencimiento · Eje Y: ganancia/pérdida (USD). Líneas punteadas: strikes; puntos: breakevens.</>}
      </figcaption>
    </figure>
  );
}
