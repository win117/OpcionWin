import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';

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

import { rangoVisible } from '../utils/velas';

/**
 * Velas o línea + volumen. `velas`: [{ time (segundos UTC), open, high, low, close, volume }] ascendente y sin duplicados.
 * `tipo`: 'velas'|'linea'. `rango`: clave de utils/velas (null = todo). Una sola instancia; los datos se actualizan in situ.
 */
export function CandleChart({ velas, height = 380, intradia = false, overlays, tipo = 'velas', volumen = true, rango = null, lineasPrecio, marcadores }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const lineasRef = useRef(new Map());
  const nivelesRef = useRef([]);

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
    const linea = chart.addLineSeries({ color: cssVar('--accent', '#0f766e'), lineWidth: 2, visible: false, priceLineVisible: false });
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volumen', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volumen').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = { candles, linea, volume: vol, up, down };

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => chart.applyOptions(themeOptions());
    media.addEventListener?.('change', onTheme);
    window.addEventListener('opciones:tema', onTheme);
    const lineas = lineasRef.current;
    return () => {
      media.removeEventListener?.('change', onTheme);
      window.removeEventListener('opciones:tema', onTheme);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
      lineas.clear();
      nivelesRef.current = [];
    };
  }, [height]);

  useEffect(() => {
    const { candles, linea, volume, up, down } = seriesRef.current;
    if (!candles) return;
    candles.setData(velas.map(v => ({ time: v.time, open: v.open, high: v.high, low: v.low, close: v.close })));
    linea.setData(velas.map(v => ({ time: v.time, value: v.close })));
    volume.setData(velas.map(v => ({ time: v.time, value: v.volume, color: (v.close >= v.open ? up : down) + '66' })));
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intradia } });
  }, [velas, intradia, height]);

  useEffect(() => {
    const { candles, linea, volume } = seriesRef.current;
    if (!candles) return;
    candles.applyOptions({ visible: tipo === 'velas' });
    linea.applyOptions({ visible: tipo === 'linea' });
    volume.applyOptions({ visible: volumen });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: volumen ? 0.26 : 0.06 } });
  }, [tipo, volumen, height]);

  // Superposiciones: [{ id, label, color, data }]; se crean/actualizan/eliminan por id.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const mapa = lineasRef.current;
    const ids = new Set((overlays || []).map(o => o.id));
    for (const [id, l] of mapa) if (!ids.has(id)) { try { chart.removeSeries(l); } catch { /* ya eliminada */ } mapa.delete(id); }
    for (const o of overlays || []) {
      let l = mapa.get(o.id);
      if (!l) {
        l = chart.addLineSeries({ color: cssVar(o.color, o.color), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: o.label });
        mapa.set(o.id, l);
      }
      l.setData(o.data);
    }
  }, [overlays, velas, height]);

  // Líneas horizontales de precio (soportes/resistencias): [{ precio, color (var CSS o color), titulo }].
  useEffect(() => {
    const { candles } = seriesRef.current;
    if (!candles) return;
    for (const l of nivelesRef.current) { try { candles.removePriceLine(l); } catch { /* ya eliminada */ } }
    nivelesRef.current = (lineasPrecio || []).map(n => candles.createPriceLine({
      price: n.precio, color: cssVar(n.color, n.color), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: n.titulo,
    }));
  }, [lineasPrecio, velas, height]);

  // Marcadores de señales: [{ time, position, color, shape, text }] (se ordenan por tiempo).
  useEffect(() => {
    const { candles } = seriesRef.current;
    if (!candles) return;
    const ms = [...(marcadores || [])].sort((a, b) => a.time - b.time).map(m => ({ ...m, color: cssVar(m.color, m.color) }));
    candles.setMarkers(ms);
  }, [marcadores, velas, height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !velas.length) return;
    const r = rango ? rangoVisible(rango, velas) : null;
    try {
      if (r) chart.timeScale().setVisibleRange(r); else chart.timeScale().fitContent();
    } catch { chart.timeScale().fitContent(); }
  }, [velas, rango, height]);

  return <div ref={container} className="candle-chart" style={{ height }} role="img" aria-label={`Gráfico de ${tipo === 'linea' ? 'línea' : 'velas'} con ${velas.length} periodos`} />;
}
