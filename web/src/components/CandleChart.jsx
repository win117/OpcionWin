import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function themeOptions() {
  const text = cssVar('--text-muted', '#64748b');
  const grid = cssVar('--border-subtle', '#e2e8f0');
  return {
    layout: { background: { color: 'transparent' }, textColor: text, fontFamily: 'inherit' },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid },
    timeScale: { borderColor: grid, timeVisible: false },
  };
}

/**
 * Velas + volumen. `velas`: [{ time (segundos UTC), open, high, low, close, volume }] ascendente y sin duplicados.
 */
export function CandleChart({ velas, height = 380, intradia = false }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});

  useEffect(() => {
    const el = container.current;
    const up = cssVar('--up', '#16a34a');
    const down = cssVar('--down', '#dc2626');
    const chart = createChart(el, {
      ...themeOptions(),
      height,
      width: el.clientWidth,
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-MX', priceFormatter: p => p.toLocaleString('es-MX', { maximumFractionDigits: 2 }) },
    });
    const candles = chart.addCandlestickSeries({
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.26 } });
    const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volumen', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volumen').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = { candles, volume, up, down };

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => chart.applyOptions(themeOptions());
    media.addEventListener?.('change', onTheme);
    return () => {
      media.removeEventListener?.('change', onTheme);
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const { candles, volume, up, down } = seriesRef.current;
    if (!candles) return;
    candles.setData(velas.map(v => ({ time: v.time, open: v.open, high: v.high, low: v.low, close: v.close })));
    volume.setData(velas.map(v => ({
      time: v.time,
      value: v.volume,
      color: (v.close >= v.open ? up : down) + '66',
    })));
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intradia } });
    chartRef.current?.timeScale().fitContent();
  }, [velas, intradia]);

  return <div ref={container} className="candle-chart" style={{ height }} role="img" aria-label={`Gráfico de velas con ${velas.length} periodos y volumen`} />;
}
