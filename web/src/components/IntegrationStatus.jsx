import { acciones } from '../api/resources';
import { useAsync } from '../hooks/useAsync';

const PROVEEDORES = [
  { key: 'alpaca', label: 'Alpaca' },
  { key: 'sec', label: 'SEC' },
  { key: 'webull', label: 'Webull' },
  { key: 'ibkr', label: 'Interactive Brokers' },
];

/** Estado de integraciones (GET /integraciones/estado). Tolera 404 mientras el backend no lo exponga. */
export function useIntegraciones() {
  return useAsync(() => acciones.integraciones(), []);
}

export function IntegrationStatus({ state, compact = false }) {
  const { data, error, loading } = state;
  if (loading && !data) return <span className="integrations muted">Integraciones…</span>;
  if (error) {
    const text = error.status === 404 ? 'Integraciones: no disponible aún' : 'Integraciones: sin respuesta';
    return <span className="integrations" title={error.message}><span className="dot dot--error" aria-hidden="true" />{text}</span>;
  }
  return (
    <span className="integrations" aria-label="Estado de integraciones">
      {PROVEEDORES.map(p => {
        const ok = Boolean(data?.[p.key]?.configurado);
        return (
          <span key={p.key} className="integrations__item" title={`${p.label}: ${ok ? 'configurado' : 'no configurado'}`}>
            <span className={'dot ' + (ok ? 'dot--ok' : 'dot--off')} aria-hidden="true" />
            {p.label}{!compact && <span className="sr-only">{ok ? ' configurado' : ' no configurado'}</span>}
          </span>
        );
      })}
    </span>
  );
}
