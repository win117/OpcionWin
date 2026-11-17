import { useId } from 'react';
import { isNum, fmtPct } from '../utils/format';

/** Mini gráfico de línea con área. `values`: números ascendentes en el tiempo. Color según tendencia (--up/--down). */
export default function Sparkline({ values = [], width = 120, height = 36, label = 'Tendencia' }) {
  const uid = useId().replace(/:/g, '');
  const v = values.filter(isNum);
  if (v.length < 2) return <svg className="spark spark--empty" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label + ': sin datos'} />;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pad = 3;
  const x = i => (i / (v.length - 1)) * width;
  const y = n => pad + (1 - (n - min) / span) * (height - pad * 2);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const change = v[0] ? v[v.length - 1] / v[0] - 1 : 0;
  const up = v[v.length - 1] >= v[0];
  return (
    <svg className={'spark ' + (up ? 'spark--up' : 'spark--down')} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`${label}: ${up ? 'al alza' : 'a la baja'}, ${fmtPct(change, 1)} en ${v.length} sesiones`}>
      <defs>
        <linearGradient id={'sg' + uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${uid})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
