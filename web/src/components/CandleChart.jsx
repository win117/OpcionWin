// Gráfica sobre Lightweight Charts, el motor abierto de TradingView: velas o línea, superposiciones, niveles, marcadores y paneles propios.
import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';
import { rangoVisible } from '../utils/velas';
import { fmtCompact, fmtFixed, isNum } from '../utils/format';

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
const color = c => cssVar(c, c);

function themeOptions() {
  const text = cssVar('--text-muted', '#64748b');
  const grid = cssVar('--border-subtle', '#e2e8f0');
  return {
    layout: { background: { color: 'transparent' }, textColor: text, fontFamily: 'inherit', panes: { separatorColor: cssVar('--border', '#d9e0e8'), separatorHoverColor: cssVar('--surface-3', '#eef2f7'), enableResize: true } },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: grid },
    timeScale: { borderColor: grid, timeVisible: false, minBarSpacing: 0.05 },
  };
}

const ALTO_PANEL = 110;
const signo = v => (isNum(v) ? (v >= 0 ? '+' : '−') + fmtFixed(Math.abs(v), 2) + ' %' : '');

/**
 * `velas`: [{ time (segundos UTC), open, high, low, close, volume }] ascendente y sin duplicados.
 * `tipo`: 'velas'|'linea'. `rango`: clave de utils/velas (null = todo).
 * `overlays`: [{ id, label, color, data, estilo?: 'puntos', grosor? }] sobre el precio.
 * `paneles`: [{ id, label, series: [{ id, label, tipo: 'linea'|'histograma', color, data }], guias: [valor] }] debajo del precio.
 * `leyenda`: muestra los valores bajo el puntero (o los últimos). Una sola instancia; los datos se actualizan in situ.
 */
export function CandleChart({ velas, height = 380, intradia = false, overlays, tipo = 'velas', volumen = true, rango = null, lineasPrecio, marcadores, paneles, leyenda = false }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const lineasRef = useRef(new Map());
  const panelesRef = useRef([]);
  const nivelesRef = useRef([]);
  const [lectura, setLectura] = useState(null); // valores bajo el puntero
  const [tops, setTops] = useState([]); // dónde empieza cada panel
  const nPaneles = paneles?.length || 0, altoTotal = height + nPaneles * ALTO_PANEL;
  const ultimaVela = velas.at(-1);

  useEffect(() => {
    const el = container.current;
    const up = cssVar('--up', '#16a34a');
    const down = cssVar('--down', '#dc2626');
    const chart = createChart(el, {
      ...themeOptions(),
      height: el.clientHeight,
      width: el.clientWidth,
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-MX', priceFormatter: p => p.toLocaleString('es-MX', { maximumFractionDigits: 2 }) },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.26 } });
    const linea = chart.addSeries(LineSeries, { color: cssVar('--accent', '#0f766e'), lineWidth: 2, visible: false, priceLineVisible: false });
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volumen', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volumen').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = { candles, linea, volume: vol, up, down, marcas: createSeriesMarkers(candles, []) };
    chart.subscribeCrosshairMove(e => {
      if (!e.time || !e.point) { setLectura(null); return; }
      const valores = new Map();
      for (const [s, v] of e.seriesData) valores.set(s, v);
      setLectura({ time: e.time, valores });
    });

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
      panelesRef.current = [];
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
    candles.priceScale().applyOptions({ scaleMargins: { top: leyenda ? 0.1 : 0.06, bottom: volumen ? (leyenda ? 0.18 : 0.26) : 0.06 } });
  }, [tipo, volumen, height, leyenda]);

  // Superposiciones: se crean, actualizan o eliminan por id.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const mapa = lineasRef.current;
    const ids = new Set((overlays || []).map(o => o.id));
    for (const [id, l] of mapa) if (!ids.has(id)) { try { chart.removeSeries(l); } catch { /* ya eliminada */ } mapa.delete(id); }
    for (const o of overlays || []) {
      let l = mapa.get(o.id);
      if (!l) {
        l = chart.addSeries(LineSeries, { color: color(o.color), lineWidth: o.grosor || 2, lineStyle: o.estilo === 'puntos' ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); // los valores van en la leyenda: un rótulo aquí tapa los precios
        mapa.set(o.id, l);
      }
      l.setData(o.data);
    }
  }, [overlays, velas, height]);

  // Paneles: se rehacen solo cuando cambia cuáles hay; si no, se actualizan sus datos.
  const firmaPaneles = (paneles || []).map(p => p.id).join('|');
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const actuales = panelesRef.current;
    if (actuales.map(p => p.id).join('|') !== firmaPaneles) {
      for (const p of [...actuales].reverse()) for (const s of p.series.values()) { try { chart.removeSeries(s); } catch { /* ya eliminada */ } }
      panelesRef.current = (paneles || []).map((p, k) => {
        const series = new Map();
        p.series.forEach((s, j) => {
          const serie = s.tipo === 'histograma'
            ? chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, k + 1)
            : chart.addSeries(LineSeries, { color: color(s.color), lineWidth: j ? 1 : 2, priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: j === 0 || p.series[0].tipo === 'histograma' }, k + 1);
          series.set(s.id, serie);
        });
        const primera = series.values().next().value;
        for (const g of p.guias || []) primera.createPriceLine({ price: g, color: cssVar('--flat', '#94a3b8'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
        if (p.escala) primera.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: p.escala[0], maxValue: p.escala[1] } }) });
        return { id: p.id, series };
      });
      const panes = chart.panes();
      panes[0]?.setStretchFactor(height);
      for (let k = 1; k < panes.length; k += 1) panes[k].setStretchFactor(ALTO_PANEL);
    }
    (paneles || []).forEach((p, k) => p.series.forEach(s => panelesRef.current[k]?.series.get(s.id)?.setData(s.data.map(d => (d.color ? { ...d, color: color(d.color) } : d)))));
  }, [paneles, firmaPaneles, velas, height]);

  // Posición de cada panel para su rótulo (cambia al redimensionar la ventana o arrastrar un separador).
  useEffect(() => {
    if (!leyenda) return undefined;
    const medir = () => {
      const panes = chartRef.current?.panes() || [];
      let y = 0;
      const t = panes.map(p => { const top = y; y += p.getHeight() + 1; return top; });
      setTops(previo => (previo.length === t.length && previo.every((v, i) => v === t[i]) ? previo : t));
    };
    const id = setTimeout(medir, 60), ro = new ResizeObserver(() => setTimeout(medir, 60)), el = container.current;
    ro.observe(el);
    el.addEventListener('pointerup', medir);
    return () => { clearTimeout(id); ro.disconnect(); el.removeEventListener('pointerup', medir); };
  }, [leyenda, firmaPaneles, altoTotal, height]);

  // Líneas horizontales de precio (soportes/resistencias): [{ precio, color (var CSS o color), titulo }].
  useEffect(() => {
    const { candles } = seriesRef.current;
    if (!candles) return;
    for (const l of nivelesRef.current) { try { candles.removePriceLine(l); } catch { /* ya eliminada */ } }
    // La escala incluye los niveles cercanos a lo visible; los lejanos no aplastan las velas.
    const precios = (lineasPrecio || []).map(n => n.precio);
    candles.applyOptions({ autoscaleInfoProvider: original => {
      const r = original();
      if (!r?.priceRange) return r;
      const { minValue, maxValue } = r.priceRange, margen = (maxValue - minValue) * 0.35;
      const dentro = precios.filter(p => p >= minValue - margen && p <= maxValue + margen);
      return { ...r, priceRange: { minValue: Math.min(minValue, ...dentro), maxValue: Math.max(maxValue, ...dentro) } };
    } });
    nivelesRef.current = (lineasPrecio || []).map(n => candles.createPriceLine({
      price: n.precio, color: color(n.color), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: n.titulo,
    }));
  }, [lineasPrecio, velas, height]);

  // Marcadores: [{ time, position, color, shape, text, size? }] (se ordenan por tiempo).
  useEffect(() => {
    seriesRef.current.marcas?.setMarkers([...(marcadores || [])].sort((a, b) => a.time - b.time).map(m => ({ ...m, color: color(m.color) })));
  }, [marcadores, velas, height]);

  // El encuadre depende del rango elegido y del número de velas; un precio en vivo no mueve lo que el usuario está mirando.
  const nVelas = velas.length;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !nVelas) return;
    const r = rango ? rangoVisible(rango, velas) : null;
    try {
      if (r) chart.timeScale().setVisibleRange(r); else chart.timeScale().fitContent();
    } catch { chart.timeScale().fitContent(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nVelas, velas[0]?.time, rango, height]);

  const bajo = s => lectura?.valores.get(s);
  const vela = (lectura && velas.find(v => v.time === lectura.time)) || ultimaVela;
  const previa = leyenda && vela ? velas[velas.indexOf(vela) - 1] : null;
  const valor = (serie, data) => { const v = bajo(serie); return v?.value ?? (lectura ? null : data?.at(-1)?.value); };
  const cambio = vela && previa ? (vela.close / previa.close - 1) * 100 : null;

  return (
    <div className="candle-chart" style={{ height: altoTotal }}>
      <div ref={container} className="candle-chart__lienzo" role="img" aria-label={`Gráfico de ${tipo === 'linea' ? 'línea' : 'velas'} con ${velas.length} periodos`} />
      {leyenda && vela && (
        <div className="candle-chart__leyenda" aria-hidden="true">
          <span>A <b>{fmtFixed(vela.open)}</b></span><span>Máx <b>{fmtFixed(vela.high)}</b></span><span>Mín <b>{fmtFixed(vela.low)}</b></span><span>C <b>{fmtFixed(vela.close)}</b></span>
          <b className={isNum(cambio) ? (cambio >= 0 ? 'up' : 'down') : ''}>{signo(cambio)}</b><span>Vol <b>{fmtCompact(vela.volume)}</b></span>
          {vela.enVivo && <span className="candle-chart__vivo">En vivo</span>}
          {(overlays || []).map(o => { const v = valor(lineasRef.current.get(o.id), o.data); return isNum(v) ? <span key={o.id} className="candle-chart__sup"><i style={{ background: `var(${o.color})` }} />{o.label} <b>{fmtFixed(v)}</b></span> : null; })}
        </div>
      )}
      {leyenda && (paneles || []).map((p, k) => (isNum(tops[k + 1]) ? (
        <div key={p.id} className="candle-chart__leyenda" style={{ top: tops[k + 1] }} aria-hidden="true">
          <span>{p.label}</span>
          {p.series.map(s => { const v = valor(panelesRef.current[k]?.series.get(s.id), s.data); return isNum(v) ? <span key={s.id}><i style={{ background: `var(${s.color})` }} />{s.label} <b>{fmtFixed(v)}</b></span> : null; })}
        </div>
      ) : null))}
    </div>
  );
}
