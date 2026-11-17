import { isNum, fmtNum } from '../utils/format';

const CX = 100, CY = 104, R = 78;
const point = (value, radius = R) => {
  const angle = Math.PI * (1 - value / 100);
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
};
const arc = (from, to) => {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

export function direccion(puntaje) {
  if (!isNum(puntaje)) return { texto: 'Sin datos', tono: 'neutral' };
  if (puntaje <= 40) return { texto: 'Bajista', tono: 'down' };
  if (puntaje >= 60) return { texto: 'Alcista', tono: 'up' };
  return { texto: 'Neutral', tono: 'flat' };
}

/** Indicador direccional 0 bajista · 50 neutral · 100 alcista. */
export function DirectionalGauge({ puntaje, size = 200 }) {
  const has = isNum(puntaje);
  const dir = direccion(puntaje);
  const [nx, ny] = point(has ? puntaje : 50, R - 14);
  return (
    <figure className="gauge" style={{ maxWidth: size }}>
      <svg viewBox="0 0 200 126" role="img" aria-label={has ? `Puntaje direccional ${fmtNum(puntaje, 0)} de 100: ${dir.texto}` : 'Puntaje direccional sin datos'}>
        <path d={arc(0, 40)} className="gauge__seg gauge__seg--down" />
        <path d={arc(40, 60)} className="gauge__seg gauge__seg--flat" />
        <path d={arc(60, 100)} className="gauge__seg gauge__seg--up" />
        {has && <line x1={CX} y1={CY} x2={nx} y2={ny} className="gauge__needle" />}
        <circle cx={CX} cy={CY} r="5" className="gauge__hub" />
        <text x="16" y="122" className="gauge__tick">0</text>
        <text x={CX} y="12" textAnchor="middle" className="gauge__tick">50</text>
        <text x="184" y="122" textAnchor="end" className="gauge__tick">100</text>
      </svg>
      <figcaption>
        <span className="gauge__value">{has ? fmtNum(puntaje, 0) : '—'}<small>/100</small></span>
        <span className={'dir dir--' + dir.tono}>{dir.texto}</span>
        <span className="gauge__legend">0 bajista · 50 neutral · 100 alcista</span>
      </figcaption>
    </figure>
  );
}

/** Barra 0..100 (compatibilidad de estrategia; no direccional). */
export function ScoreBar({ value, label = 'Compatibilidad' }) {
  const has = isNum(value);
  return (
    <div className="scorebar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={has ? value : undefined} aria-label={label}>
      <div className="scorebar__track"><div className="scorebar__fill" style={{ width: (has ? Math.max(0, Math.min(100, value)) : 0) + '%' }} /></div>
      <span className="scorebar__value">{has ? fmtNum(value, 0) : '—'}</span>
    </div>
  );
}
