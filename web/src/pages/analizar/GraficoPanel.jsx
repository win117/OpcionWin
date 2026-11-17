// Pestaña «Gráfico»: histórico largo, intervalos, rangos, tipo de gráfico e indicadores.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CandleChart } from '../../components/CandleChart';
import { ChartToolbar } from '../../components/ChartToolbar';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { acciones, jobPaths, mercado } from '../../api/resources';
import { toCandles } from '../mercado/GraficoTab';
import { agregar, haceAnios, sma } from '../../utils/velas';
import { esperar } from './flujo';
import { fmtDate } from '../../utils/format';

const SMAS = [
  { n: 20, color: '--accent' },
  { n: 50, color: '--info-fg' },
  { n: 200, color: '--warning-fg' },
];

export default function GraficoPanel({ simbolo, onCambio }) {
  const [opts, setOpts] = useState({ rango: '6M', intervalo: 'D', tipo: 'velas', sma: { 20: true, 50: true, 200: false }, volumen: true });
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, [simbolo]);

  const state = useAsync(async () => {
    const r = await mercado.historicos(simbolo, { limit: 10000 });
    return toCandles(r.items || []);
  }, [simbolo]);
  const diarias = state.data || [];
  const velas = useMemo(() => agregar(diarias, opts.intervalo), [diarias, opts.intervalo]);
  const overlays = useMemo(() => SMAS.filter(s => opts.sma[s.n]).map(s => ({ id: 'sma' + s.n, label: 'SMA ' + s.n, color: s.color, data: sma(velas, s.n) })).filter(o => o.data.length), [velas, opts.sma]);

  const cargarLargo = async () => {
    setCargando(true); setErrorCarga(null);
    try {
      const job = await acciones.sincronizar({ recurso: 'historicos', simbolos: [simbolo], desde: haceAnios(10) });
      const fin = await esperar(jobPaths.sincronizacion(job._id), () => !vivo.current);
      if (!vivo.current) return;
      if (fin.estado === 'fallida') throw new Error(fin.error || 'La sincronización falló.');
      await state.reload();
      setOpts(o => ({ ...o, rango: 'MAX' }));
      onCambio?.();
    } catch (e) { if (vivo.current) setErrorCarga(e); }
    finally { if (vivo.current) setCargando(false); }
  };

  if (state.loading && !state.data) return <Loading text="Cargando velas…" />;
  if (state.error && !state.data) return <ErrorMessage error={state.error} onRetry={state.reload} />;

  return (
    <div className="stack">
      {diarias.length > 0 ? (
        <>
          <ChartToolbar opts={opts} onChange={setOpts} />
          <CandleChart velas={velas} overlays={overlays} tipo={opts.tipo} volumen={opts.volumen} rango={opts.rango} />
          <ul className="chips chips--legend" aria-label="Leyenda">
            {overlays.map(o => <li key={o.id}><i className="swatch" style={{ background: `var(${o.color})` }} /> {o.label}</li>)}
          </ul>
        </>
      ) : <Empty title="Sin velas almacenadas">Carga el histórico para ver el gráfico.</Empty>}
      <div className="chart-hist">
        {diarias.length > 0 && <span className="muted small">Histórico disponible: {fmtDate(diarias[0].time * 1000)} → {fmtDate(diarias.at(-1).time * 1000)} ({diarias.length} sesiones)</span>}
        <button type="button" className="btn btn--sm" onClick={cargarLargo} disabled={cargando}>{cargando ? 'Cargando histórico…' : 'Cargar histórico largo (10 años)'}</button>
      </div>
      {cargando && <Loading text="Descargando histórico del proveedor…" />}
      <ErrorMessage error={errorCarga} title="No se pudo cargar el histórico" />
      <p className="muted small">El feed IEX puede no tener los años más antiguos; se guardan las velas que el proveedor entregue.</p>
      {state.error && <Notice tone="warning">No se pudo refrescar: {state.error.message}</Notice>}
    </div>
  );
}
