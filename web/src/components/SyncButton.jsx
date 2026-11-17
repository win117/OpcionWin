import { useEffect, useRef } from 'react';
import { acciones, jobPaths } from '../api/resources';
import { useLaunchJob } from '../hooks/useJob';
import { JobStatus } from './JobStatus';
import { RECURSO_LABELS } from '../utils/constants';

/** Botón "Sincronizar" → POST /sincronizaciones/ejecuciones y sondeo del trabajo. */
export function SyncButton({ recurso, simbolos = [], conexionId, desde, hasta, onDone, label = 'Sincronizar', disabled }) {
  const job = useLaunchJob(body => acciones.sincronizar(body), record => jobPaths.sincronizacion(record._id));
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (job.done) onDoneRef.current?.(job.data);
  }, [job.done, job.data]);

  const run = () => {
    const body = { recurso, simbolos };
    if (conexionId) body.conexionId = conexionId;
    if (desde) body.desde = desde;
    if (hasta) body.hasta = hasta;
    job.launch(body);
  };

  return (
    <div className="sync">
      <button type="button" className="btn btn--sm" onClick={run} disabled={disabled || job.busy}
        title={`Sincronizar ${RECURSO_LABELS[recurso] || recurso} desde el proveedor`}>
        {job.busy ? 'Sincronizando…' : label}
      </button>
      <JobStatus job={job} label={RECURSO_LABELS[recurso] || recurso} showCounts />
    </div>
  );
}
