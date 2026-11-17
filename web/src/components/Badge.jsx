const TONES = {
  completada: 'success', exito: 'success', activa: 'success', ejecutada: 'success', abierta: 'success', validada: 'success', true: 'success',
  fallida: 'danger', error: 'danger', rechazada: 'danger', revocada: 'danger',
  pendiente: 'warning', borrador: 'neutral', parcial: 'warning', expirada: 'neutral',
  procesando: 'info', enviada: 'info', aceptada: 'info',
  cancelada: 'neutral', cerrada: 'neutral', archivada: 'neutral', false: 'neutral',
};

const LABELS = { true: 'Sí', false: 'No', exito: 'éxito' };

export function Badge({ value, tone, children, title }) {
  const key = String(value);
  const resolved = tone || TONES[key] || 'neutral';
  return (
    <span className={'badge badge--' + resolved} title={title}>
      {children ?? LABELS[key] ?? key}
    </span>
  );
}
