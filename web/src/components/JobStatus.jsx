import { Badge } from './Badge';
import { Spinner } from './States';
import { fmtDateTime } from '../utils/format';

/** Estado de un trabajo asíncrono a partir de useJob/useLaunchJob. */
export function JobStatus({ job, label = 'Trabajo', showCounts }) {
  if (!job) return null;
  const { data, error, timedOut, launchError, launching } = job;
  if (launching) {
    return <div className="job" role="status"><Spinner small /> <span>Enviando solicitud…</span></div>;
  }
  if (launchError) {
    return <div className="alert alert--danger" role="alert">{launchError.message}</div>;
  }
  if (!data) return null;
  const running = !['completada', 'fallida'].includes(data.estado);
  return (
    <div className="job" role="status" aria-live="polite">
      <span className="job__label">{label}</span>
      {running && !timedOut && <Spinner small />}
      <Badge value={data.estado} />
      {showCounts && (
        <span className="muted">procesados {data.procesados ?? 0} · fallidos {data.fallidos ?? 0}</span>
      )}
      {data.finalizadaEn && <span className="muted">· {fmtDateTime(data.finalizadaEn)}</span>}
      {data.estado === 'fallida' && data.error && <span className="job__error">{data.error}</span>}
      {timedOut && <span className="job__error">Se dejó de consultar tras 5 minutos; revisa más tarde en Sincronizaciones/Historial.</span>}
      {error && !timedOut && <span className="job__error">Consulta de estado: {error.message}</span>}
    </div>
  );
}
