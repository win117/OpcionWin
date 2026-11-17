import { useMemo, useState } from 'react';
import { CandleChart } from '../../components/CandleChart';
import { SyncButton } from '../../components/SyncButton';
import { SourceLine } from '../../components/Source';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { Select } from '../../components/Field';
import { useAsync } from '../../hooks/useAsync';
import { mercado } from '../../api/resources';
import { fmtCompact, fmtMoney, fmtPct, fmtDate } from '../../utils/format';

const MAX_VELAS = 100;

/** Datos-mercado tipo vela → velas para lightweight-charts (ascendentes, sin tiempos repetidos). */
export function toCandles(rows) {
  const byTime = new Map();
  for (const r of rows) {
    const t = Date.parse(r.fuente?.fechaDato);
    if (Number.isNaN(t) || ![r.apertura, r.maximo, r.minimo, r.cierre].every(Number.isFinite)) continue;
    byTime.set(Math.floor(t / 1000), {
      time: Math.floor(t / 1000), open: r.apertura, high: r.maximo, low: r.minimo, close: r.cierre, volume: r.volumen ?? 0, row: r,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export default function GraficoTab({ simbolo }) {
  // El endpoint devuelve las últimas N velas ordenadas por fecha (máx. 1000).
  const state = useAsync(() => mercado.historicos(simbolo, { limit: 300 }), [simbolo]);
  const [intervalo, setIntervalo] = useState('');
  const rows = state.data?.items || [];
  const intervalos = useMemo(() => [...new Set(rows.map(r => r.intervalo).filter(Boolean))], [rows]);
  const activo = intervalo || intervalos[0] || '';
  const velas = useMemo(() => {
    const filtered = activo ? rows.filter(r => r.intervalo === activo) : rows;
    return toCandles(filtered.slice(0, MAX_VELAS));
  }, [rows, activo]);
  const last = velas.at(-1), prev = velas.at(-2);
  const intradia = /min|hour|^\d+[mh]$/i.test(activo);

  return (
    <div className="stack">
      <div className="toolbar">
        <SyncButton recurso="historicos" simbolos={[simbolo]} onDone={state.reload} label="Sincronizar históricos" />
        {intervalos.length > 1 && (
          <label className="toolbar__filter">
            <span className="muted">Intervalo </span>
            <Select value={activo} onChange={setIntervalo} options={intervalos.map(i => ({ value: i, label: i }))} />
          </label>
        )}
      </div>
      {state.loading && !state.data && <Loading text="Cargando velas…" />}
      <ErrorMessage error={state.error} onRetry={state.reload} />
      {state.data && !velas.length && (
        <Empty title="Sin velas almacenadas">Pulsa «Sincronizar históricos» para obtenerlas del proveedor.</Empty>
      )}
      {velas.length > 0 && (
        <>
          <dl className="stats stats--row">
            <div><dt>Último cierre</dt><dd>{fmtMoney(last.close)}</dd></div>
            <div><dt>Variación</dt><dd className={prev && last.close >= prev.close ? 'up' : 'down'}>{prev ? fmtPct((last.close - prev.close) / prev.close, 2) : '—'}</dd></div>
            <div><dt>Rango ({velas.length} velas)</dt><dd>{fmtMoney(Math.min(...velas.map(v => v.low)))} – {fmtMoney(Math.max(...velas.map(v => v.high)))}</dd></div>
            <div><dt>Volumen último</dt><dd>{fmtCompact(last.volume)}</dd></div>
          </dl>
          <CandleChart velas={velas} intradia={intradia} />
          <SourceLine
            fuente={last.row.fuente}
            extra={`intervalo ${activo || 'no indicado'} · ${fmtDate(velas[0].row.fuente?.fechaDato)} a ${fmtDate(last.row.fuente?.fechaDato)}`}
          />
          {state.data.truncated && <p className="muted small">Hay más velas almacenadas de las descargadas; se muestran las más recientes de lo obtenido.</p>}
        </>
      )}
    </div>
  );
}
