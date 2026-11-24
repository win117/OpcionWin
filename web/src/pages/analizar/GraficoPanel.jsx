// Gráfica técnica: velas/línea + SMA, soportes/resistencias (líneas con nº de toques) y marcadores de compra/venta.
// Recibe las velas diarias ya cargadas (hooks/useVelas) y los niveles/eventos calculados en utils/senales.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CandleChart } from '../../components/CandleChart';
import { ChartToolbar } from '../../components/ChartToolbar';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { acciones, jobPaths } from '../../api/resources';
import { agregar, haceAnios, rangoVisible, sma } from '../../utils/velas';
import { etiquetaEvento } from '../../utils/senales';
import { esperar } from './flujo';
import { fmtDate, fmtMoney } from '../../utils/format';

const SMAS = [
  { n: 20, color: '--accent' },
  { n: 50, color: '--info-fg' },
  { n: 200, color: '--warning-fg' },
];

export default function GraficoPanel({ simbolo, diarias, loading, error, onReload, onCambio, niveles = [], eventos = [] }) {
  const [opts, setOpts] = useState({ rango: '6M', intervalo: 'D', tipo: 'velas', sma: { 20: true, 50: true, 200: false }, volumen: false });
  const [verNiveles, setVerNiveles] = useState(true);
  const [verSenales, setVerSenales] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, [simbolo]);

  const velas = useMemo(() => agregar(diarias, opts.intervalo), [diarias, opts.intervalo]);
  const overlays = useMemo(() => SMAS.filter(s => opts.sma[s.n]).map(s => ({ id: 'sma' + s.n, label: 'SMA ' + s.n, color: s.color, data: sma(velas, s.n) })).filter(o => o.data.length), [velas, opts.sma]);

  const lineas = useMemo(() => (verNiveles ? niveles.map(n => ({
    precio: n.precio,
    color: n.tipo === 'resistencia' ? '--down' : '--up',
    titulo: `${n.tipo === 'resistencia' ? 'Resistencia' : 'Soporte'} · ${n.toques} ${n.toques === 1 ? 'toque' : 'toques'}`,
  })) : []), [niveles, verNiveles]);

  // Marcadores solo en vista diaria (los eventos se calculan sobre velas diarias) y dentro del rango visible.
  const marcadores = useMemo(() => {
    if (!verSenales || opts.intervalo !== 'D' || !eventos.length) return [];
    const r = rangoVisible(opts.rango, velas);
    const dentro = eventos.filter(e => !r || e.time >= r.from);
    return dentro.slice(-40).map(e => ({
      time: e.time,
      position: e.lado === 'compra' ? 'belowBar' : 'aboveBar',
      shape: e.lado === 'compra' ? 'arrowUp' : 'arrowDown',
      color: e.lado === 'compra' ? '--up' : '--down',
      text: etiquetaEvento(e),
    }));
  }, [eventos, verSenales, opts.intervalo, opts.rango, velas]);

  const cargarLargo = async () => {
    setCargando(true); setErrorCarga(null);
    try {
      const job = await acciones.sincronizar({ recurso: 'historicos', simbolos: [simbolo], desde: haceAnios(10) });
      const fin = await esperar(jobPaths.sincronizacion(job._id), () => !vivo.current);
      if (!vivo.current) return;
      if (fin.estado === 'fallida') throw new Error(fin.error || 'La sincronización falló.');
      await onReload?.();
      setOpts(o => ({ ...o, rango: 'MAX' }));
      onCambio?.();
    } catch (e) { if (vivo.current) setErrorCarga(e); }
    finally { if (vivo.current) setCargando(false); }
  };

  if (loading && !diarias.length) return <Loading text="Cargando velas…" />;
  if (error && !diarias.length) return <ErrorMessage error={error} onRetry={onReload} />;

  return (
    <div className="stack">
      {diarias.length > 0 ? (
        <>
          <ChartToolbar opts={opts} onChange={setOpts} />
          <div className="seg" role="group" aria-label="Capas técnicas">
            <button type="button" className={'seg__btn seg__btn--solo' + (verNiveles ? ' is-active' : '')} aria-pressed={verNiveles} onClick={() => setVerNiveles(v => !v)}>Soportes y resistencias</button>
            <button type="button" className={'seg__btn seg__btn--solo' + (verSenales ? ' is-active' : '')} aria-pressed={verSenales} onClick={() => setVerSenales(v => !v)} disabled={opts.intervalo !== 'D'} title={opts.intervalo !== 'D' ? 'Las señales se muestran en vista diaria' : undefined}>Señales compra/venta</button>
          </div>
          <CandleChart velas={velas} height={460} overlays={overlays} tipo={opts.tipo} volumen={opts.volumen} rango={opts.rango} lineasPrecio={lineas} marcadores={marcadores} />
          <ul className="chips chips--legend" aria-label="Leyenda">
            {overlays.map(o => <li key={o.id}><i className="swatch" style={{ background: `var(${o.color})` }} /> {o.label}</li>)}
            {verNiveles && <li><i className="swatch" style={{ background: 'var(--down)' }} /> Resistencia</li>}
            {verNiveles && <li><i className="swatch" style={{ background: 'var(--up)' }} /> Soporte</li>}
            {verSenales && <li><span className="up" aria-hidden="true">▲</span> Compra <span className="down" aria-hidden="true">▼</span> Venta</li>}
          </ul>
          {verNiveles && niveles.length > 0 && (
            <ul className="niveles" aria-label="Niveles de soporte y resistencia">
              {niveles.map(n => (
                <li key={n.tipo + n.precio} className={n.tipo === 'resistencia' ? 'down' : 'up'}>
                  <strong>{n.tipo === 'resistencia' ? 'Resistencia' : 'Soporte'}</strong> {fmtMoney(n.precio)} <span className="muted">· {n.toques} toques · último {fmtDate(n.ultimoToque * 1000)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : <Empty title="Sin velas almacenadas">Pulsa «Actualizar datos» o carga el histórico para ver el gráfico.</Empty>}
      <div className="chart-hist">
        {diarias.length > 0 && <span className="muted small">Histórico disponible: {fmtDate(diarias[0].time * 1000)} → {fmtDate(diarias.at(-1).time * 1000)} ({diarias.length} sesiones)</span>}
        <button type="button" className="btn btn--sm" onClick={cargarLargo} disabled={cargando}>{cargando ? 'Cargando histórico…' : 'Cargar histórico largo (10 años)'}</button>
      </div>
      {cargando && <Loading text="Descargando histórico del proveedor…" />}
      <ErrorMessage error={errorCarga} title="No se pudo cargar el histórico" />
    </div>
  );
}
