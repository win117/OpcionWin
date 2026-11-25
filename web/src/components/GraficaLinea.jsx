// Una sola serie en el tiempo, con lectura al pasar el puntero. `puntos`: [{ fecha (ISO), valor }].
import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineSeries } from 'lightweight-charts';
import { fmtDate, fmtMoney, isNum } from '../utils/format';

const cssVar = nombre => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
const tema = () => ({
  layout: { background: { color: 'transparent' }, textColor: cssVar('--text-muted'), fontFamily: 'inherit' },
  grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--border-subtle') } },
  rightPriceScale: { borderVisible: false }, timeScale: { borderColor: cssVar('--border-subtle'), timeVisible: false },
});

export default function GraficaLinea({ puntos, height = 200, etiqueta }) {
  const caja = useRef(null), refs = useRef({});
  const [foco, setFoco] = useState(null);
  const datos = useMemo(() => {
    const m = new Map();
    for (const p of puntos || []) if (isNum(p.valor) && p.fecha) m.set(p.fecha.slice(0, 10), p.valor);
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([time, value]) => ({ time, value }));
  }, [puntos]);

  useEffect(() => {
    const el = caja.current;
    const chart = createChart(el, { ...tema(), height, width: el.clientWidth, autoSize: true, crosshair: { mode: CrosshairMode.Magnet }, localization: { locale: 'es-MX' }, handleScroll: false, handleScale: false });
    const serie = chart.addSeries(LineSeries, { color: cssVar('--accent'), lineWidth: 2, priceLineVisible: false });
    chart.subscribeCrosshairMove(e => { const v = e.seriesData?.get(serie)?.value; setFoco(isNum(v) ? { fecha: String(e.time), valor: v } : null); });
    refs.current = { chart, serie };
    const alCambiar = () => { chart.applyOptions(tema()); serie.applyOptions({ color: cssVar('--accent') }); };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', alCambiar);
    window.addEventListener('opciones:tema', alCambiar);
    return () => { media.removeEventListener?.('change', alCambiar); window.removeEventListener('opciones:tema', alCambiar); chart.remove(); refs.current = {}; };
  }, [height]);
  useEffect(() => { refs.current.serie?.setData(datos); refs.current.chart?.timeScale().fitContent(); }, [datos, height]);

  const primero = datos[0], ultimo = datos.at(-1), v = foco || (ultimo && { fecha: ultimo.time, valor: ultimo.value });
  return (
    <figure className="linea">
      <figcaption className="small">{v ? <><strong>{fmtMoney(v.valor)}</strong> <span className="muted">{fmtDate(v.fecha)}{!foco && primero && primero !== ultimo ? `, ${ultimo.value >= primero.value ? '+' : '−'}${fmtMoney(Math.abs(ultimo.value - primero.value))} desde el ${fmtDate(primero.time)}` : ''}</span></> : <span className="muted">Sin datos</span>}</figcaption>
      <div ref={caja} role="img" aria-label={etiqueta ? `${etiqueta}: de ${fmtMoney(primero?.value)} a ${fmtMoney(ultimo?.value)}` : undefined} />
    </figure>
  );
}
