// Gráfica técnica: velas/línea + SMA, soportes/resistencias (líneas con nº de toques) y marcadores de compra/venta.
// Recibe las velas diarias ya cargadas (hooks/useVelas) y los niveles/eventos calculados en utils/senales.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CandleChart } from '../../components/CandleChart';
import { ChartToolbar } from '../../components/ChartToolbar';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { acciones, jobPaths } from '../../api/resources';
import { agregar, haceAnios, rangoVisible, sma } from '../../utils/velas';
import { etiquetaEvento } from '../../utils/senales';
import { bollingerSerie, estocasticoSerie, macdSerie, rsiSerie } from '../../utils/indicadores';
import { conVelaEnVivo, detectarPatrones, historialPatrones, PATRONES, rectaTendencia } from '../../utils/patrones';
import { esperar } from './flujo';
import { fmtDate, fmtMoney, fmtPct } from '../../utils/format';

const TradingView = lazy(() => import('../../components/TradingView'));
const VISTA = 'opciones.grafica'; // preferencia de este navegador
const leerVista = () => { try { return localStorage.getItem(VISTA) === 'tradingview' ? 'tradingview' : 'app'; } catch { return 'app'; } };

const ALTO = 440;
const CON_TEXTO = new Set(['1M', '3M', '6M']);
const ANIOS_MAX = 12; // «Máx»: lo que el proveedor tenga (consolidado desde 2016)
const SMAS = [
  { n: 20, color: '--accent' },
  { n: 50, color: '--info-fg' },
  { n: 200, color: '--warning-fg' },
];
const OPCIONES = 'opciones.grafica.capas'; // preferencia de este navegador
const MIN_CASOS = 8; // con menos apariciones, el historial de un patrón no dice nada
const serie = (velas, valores) => velas.flatMap((v, i) => (valores[i] == null ? [] : [{ time: v.time, value: valores[i] }]));

function opcionesIniciales() {
  const ancha = window.innerWidth >= 900;
  const capas = { sma20: true, sma50: true, sma200: false, bollinger: false, tendencia: false, volumen: true, niveles: true, senales: true, patrones: true, rsi: ancha, macd: ancha, estocastico: false };
  try { Object.assign(capas, JSON.parse(localStorage.getItem(OPCIONES) || '{}')); } catch { /* sin almacenamiento */ }
  return { rango: '6M', intervalo: 'D', tipo: 'velas', capas };
}

/** Todos los paneles usan las mismas fórmulas que los cores del servidor. */
function construirPaneles(velas, capas) {
  const cierres = velas.map(v => v.close), out = [];
  if (capas.rsi) out.push({ id: 'rsi', label: 'RSI 14', escala: [0, 100], guias: [30, 70], series: [{ id: 'rsi', label: '', color: '--accent', data: serie(velas, rsiSerie(cierres)) }] });
  if (capas.macd) {
    const m = macdSerie(cierres);
    out.push({ id: 'macd', label: 'MACD 12 26 9', guias: [0], series: [
      { id: 'hist', label: 'Hist.', tipo: 'histograma', color: '--flat', data: serie(velas, m.hist).map(d => ({ ...d, color: d.value >= 0 ? '--up' : '--down' })) },
      { id: 'macd', label: 'MACD', color: '--accent', data: serie(velas, m.macd) }, { id: 'senal', label: 'Señal', color: '--warning-fg', data: serie(velas, m.senal) }] });
  }
  if (capas.estocastico) {
    const e = estocasticoSerie(velas);
    out.push({ id: 'estocastico', label: 'Estocástico 14 3', escala: [0, 100], guias: [20, 80], series: [{ id: 'k', label: '%K', color: '--accent', data: serie(velas, e.k) }, { id: 'd', label: '%D', color: '--warning-fg', data: serie(velas, e.d) }] });
  }
  return out;
}

/** Niveles y últimos patrones en texto: lo mismo que se dibuja, legible sin la gráfica. */
function Niveles({ niveles }) {
  if (!niveles.length) return null;
  return (
    <ul className="niveles" aria-label="Niveles de soporte y resistencia">
      {niveles.map(n => (
        <li key={n.tipo + n.precio} className={n.tipo === 'resistencia' ? 'down' : 'up'}>
          <strong>{n.tipo === 'resistencia' ? 'Resistencia' : 'Soporte'}</strong> {fmtMoney(n.precio)} <span className="muted">{n.extremo ? `${n.tipo === 'resistencia' ? 'máximo' : 'mínimo'} del último año, ${fmtDate(n.ultimoToque * 1000)}` : `${n.toques} toques, último ${fmtDate(n.ultimoToque * 1000)}`}</span>
        </li>
      ))}
    </ul>
  );
}

function PatronesRecientes({ velas, patrones }) {
  const historial = useMemo(() => historialPatrones(velas, patrones), [velas, patrones]);
  const ultimos = patrones.filter(x => x.tipo !== 'doji').slice(-5).reverse();
  if (!ultimos.length) return null;
  return (
    <div className="patrones small">
      <h3>Patrones de velas recientes</h3>
      <ul className="list list--compact">
        {ultimos.map(x => {
          const t = PATRONES[x.tipo], h = historial[x.tipo];
          return (
            <li key={x.time}><strong className={x.lado === 'alcista' ? 'up' : 'down'}>{t.nombre}</strong> <span className="muted">{fmtDate(x.time * 1000)}</span>. {t.texto}{' '}
              <span className="muted">{h && h.n >= MIN_CASOS ? `En esta empresa apareció ${h.n} veces: a 5 sesiones acertó ${fmtPct(h.aciertos, 0)} (en un día cualquiera, ${fmtPct(h.base, 0)}).` : `Aparece poco en esta empresa (${h?.n || 0} ${h?.n === 1 ? 'vez' : 'veces'}): su historial no dice nada.`}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted">Los patrones describen la forma de las velas; no cuentan en el puntaje. Si el acierto no supera al de un día cualquiera, el patrón no aporta.</p>
    </div>
  );
}

function GraficoApp({ simbolo, registrada = true, diarias, vivo: fichaViva, loading, error, onReload, onCambio, niveles = [], eventos = [] }) {
  const [opts, setOpts] = useState(opcionesIniciales);
  const cambiar = o => { setOpts(o); try { localStorage.setItem(OPCIONES, JSON.stringify(o.capas)); } catch { /* sin almacenamiento */ } };
  const { capas } = opts;
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, [simbolo]);

  const conVivo = useMemo(() => conVelaEnVivo(diarias, fichaViva), [diarias, fichaViva]);
  const velas = useMemo(() => agregar(conVivo, opts.intervalo), [conVivo, opts.intervalo]);
  const overlays = useMemo(() => {
    const o = SMAS.filter(x => capas['sma' + x.n]).map(x => ({ id: 'sma' + x.n, label: 'SMA ' + x.n, color: x.color, data: sma(velas, x.n) }));
    if (capas.bollinger) {
      const b = bollingerSerie(velas.map(v => v.close));
      o.push({ id: 'bb-sup', label: 'Bollinger sup.', color: '--flat', estilo: 'puntos', grosor: 1, data: serie(velas, b.sup) }, { id: 'bb-inf', label: 'inf.', color: '--flat', estilo: 'puntos', grosor: 1, data: serie(velas, b.inf) });
    }
    if (capas.tendencia) o.push({ id: 'tendencia', label: 'Tendencia 20', color: '--text', estilo: 'puntos', data: rectaTendencia(velas) });
    return o.filter(x => x.data.length);
  }, [velas, capas]);
  const paneles = useMemo(() => construirPaneles(velas, capas), [velas, capas]);
  const patrones = useMemo(() => detectarPatrones(velas), [velas]);

  const lineas = useMemo(() => (capas.niveles ? niveles.map(n => ({
    precio: n.precio,
    color: n.tipo === 'resistencia' ? '--down' : '--up',
    titulo: n.extremo ? (n.tipo === 'resistencia' ? 'Máximo del año' : 'Mínimo del año') : `${n.tipo === 'resistencia' ? 'Resistencia' : 'Soporte'} ×${n.toques}`,
  })) : []), [niveles, capas.niveles]);

  // Señales solo en vista diaria (se calculan sobre velas diarias); patrones, sobre las velas que se ven. Todo dentro del rango visible.
  const marcadores = useMemo(() => {
    const r = rangoVisible(opts.rango, velas), dentro = x => !r || x.time >= r.from, out = [];
    if (capas.senales && opts.intervalo === 'D') {
      out.push(...eventos.filter(dentro).slice(-40).map(e => ({
        time: e.time, position: e.lado === 'compra' ? 'belowBar' : 'aboveBar', shape: e.lado === 'compra' ? 'arrowUp' : 'arrowDown', color: e.lado === 'compra' ? '--up' : '--down',
        text: CON_TEXTO.has(opts.rango) ? etiquetaEvento(e) : '', // en rangos largos los textos se enciman: solo flechas
      })));
    }
    if (capas.patrones) {
      out.push(...patrones.filter(x => x.lado !== 'info' && dentro(x)).slice(-30).map(x => ({
        time: x.time, position: x.lado === 'alcista' ? 'belowBar' : 'aboveBar', shape: 'circle', size: 0.6, color: x.lado === 'alcista' ? '--up' : '--down', text: opts.rango === '1M' || opts.rango === '3M' ? PATRONES[x.tipo].corto : '',
      })));
    }
    return out;
  }, [eventos, patrones, capas.senales, capas.patrones, opts.intervalo, opts.rango, velas]);

  // Elegir 1A, 3A, 5A o Máx trae solo lo que falte. Una empresa joven no tiene más: cada rango se intenta una vez.
  const pedidos = useRef(new Set());
  useEffect(() => { pedidos.current = new Set(); }, [simbolo]);
  const anios = { '1A': 1, '3A': 3, '5A': 5, MAX: ANIOS_MAX }[opts.rango];
  const primera = diarias[0]?.time;
  const falta = Boolean(anios && primera && primera - Date.parse(haceAnios(anios)) / 1000 > 10 * 86400);
  const cargarHistorico = async () => {
    setCargando(true); setErrorCarga(null);
    try {
      const job = await acciones.sincronizar({ recurso: 'historicos', simbolos: [simbolo], desde: haceAnios(anios) });
      const fin = await esperar(jobPaths.sincronizacion(job._id), () => !vivo.current);
      if (!vivo.current) return;
      if (fin.estado === 'fallida') throw new Error(fin.error || 'La sincronización falló.');
      await onReload?.();
      onCambio?.();
    } catch (e) { if (vivo.current) setErrorCarga(e); }
    finally { if (vivo.current) setCargando(false); }
  };
  useEffect(() => {
    if (!falta || !registrada || cargando) return;
    const clave = opts.rango;
    if (pedidos.current.has(clave)) return;
    pedidos.current.add(clave);
    cargarHistorico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falta, registrada, cargando, opts.rango, simbolo]);

  if (loading && !diarias.length) return <div className="grafico-hueco"><Loading text="Cargando precios…" /></div>;
  if (error && !diarias.length) return <ErrorMessage error={error} onRetry={onReload} />;

  return (
    <div className="stack">
      {diarias.length > 0 ? (
        <>
          <ChartToolbar opts={opts} onChange={cambiar} bloqueadas={opts.intervalo !== 'D' ? { senales: 'Las señales se calculan sobre velas diarias' } : {}} />
          <CandleChart velas={velas} height={ALTO} overlays={overlays} tipo={opts.tipo} volumen={capas.volumen} rango={opts.rango} lineasPrecio={lineas} marcadores={marcadores} paneles={paneles} leyenda />
          <ul className="chips chips--legend" aria-label="Leyenda">
            {capas.niveles && <li><i className="swatch" style={{ background: 'var(--down)' }} /> Resistencia</li>}
            {capas.niveles && <li><i className="swatch" style={{ background: 'var(--up)' }} /> Soporte</li>}
            {capas.senales && <li><span className="up" aria-hidden="true">▲</span> Compra <span className="down" aria-hidden="true">▼</span> Venta</li>}
            {capas.patrones && <li><span className="up" aria-hidden="true">●</span> Patrón alcista <span className="down" aria-hidden="true">●</span> Patrón bajista</li>}
          </ul>
          {capas.niveles && <Niveles niveles={niveles} />}
          {capas.patrones && <PatronesRecientes velas={velas} patrones={patrones} />}
        </>
      ) : <Empty title="Sin velas almacenadas">Pulsa «Actualizar datos» o carga el histórico para ver el gráfico.</Empty>}
      <div className="chart-hist">
        {diarias.length > 0 && <span className="muted small">Histórico disponible: {fmtDate(diarias[0].time * 1000)} → {fmtDate(diarias.at(-1).time * 1000)} ({diarias.length} sesiones){registrada ? '' : '. Precios en vivo mientras se guardan los datos'}</span>}
{falta && !cargando && pedidos.current.has(opts.rango) && !errorCarga && <span className="muted small">No hay datos anteriores: es todo el histórico disponible.</span>}
        {errorCarga && <button type="button" className="btn btn--sm" onClick={cargarHistorico}>Reintentar</button>}
      </div>
      {cargando && <Loading text={opts.rango === 'MAX' ? 'Trayendo todo el histórico…' : `Trayendo ${anios} ${anios === 1 ? 'año' : 'años'} de precios…`} />}
      <ErrorMessage error={errorCarga} title="No se pudo cargar el histórico" />
    </div>
  );
}

/** Dos vistas: nuestros cálculos sobre el motor de TradingView, y la gráfica oficial de TradingView (marco cerrado: no admite dibujos nuestros). */
export default function GraficoPanel({ mercado, ...props }) {
  const [vista, setVista] = useState(leerVista);
  const elegir = v => { setVista(v); try { localStorage.setItem(VISTA, v); } catch { /* sin almacenamiento */ } };
  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Gráfica">
        {[['app', 'Con nuestros cálculos'], ['tradingview', 'TradingView oficial']].map(([id, t]) => (
          <button key={id} type="button" className={'seg__btn seg__btn--solo' + (vista === id ? ' is-active' : '')} aria-pressed={vista === id} onClick={() => elegir(id)}>{t}</button>
        ))}
      </div>
      {vista === 'tradingview'
        ? <Suspense fallback={<Loading text="Cargando TradingView…" />}><TradingView simbolo={props.simbolo} mercado={mercado} /><h3>Nuestros niveles</h3><Niveles niveles={props.niveles || []} /></Suspense>
        : <GraficoApp {...props} />}
    </div>
  );
}
