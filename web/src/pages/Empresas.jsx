import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { Badge } from '../components/Badge';
import { empresas } from '../api/resources';

const FIELDS = [
  { name: 'simbolo', label: 'Símbolo', required: true, maxLength: 32, uppercase: true, placeholder: 'AAPL' },
  { name: 'nombre', label: 'Nombre', required: true, placeholder: 'Apple Inc.' },
  { name: 'mercado', label: 'Mercado', required: true, placeholder: 'NASDAQ' },
  { name: 'sector', label: 'Sector', placeholder: 'Tecnología' },
  { name: 'cik', label: 'CIK (SEC)', pattern: '\\d{10}', maxLength: 10, inputMode: 'numeric', placeholder: '0000320193', help: '10 dígitos con ceros a la izquierda. Necesario para fundamentales y 13F.' },
  { name: 'activo', label: 'Activa', type: 'checkbox', default: true },
];

const validate = values => {
  if (values.cik && !/^\d{10}$/.test(values.cik)) return 'El CIK debe tener exactamente 10 dígitos.';
  return null;
};

export default function Empresas() {
  return (
    <>
      <PageHeader title="Empresas" subtitle="Símbolos registrados para análisis y sincronización" />
      <ResourceManager
        api={empresas}
        fields={FIELDS}
        selectable
        searchPlaceholder="Buscar por símbolo o nombre"
        createLabel="Nueva empresa"
        nameOf={r => r.simbolo}
        extraValidate={validate}
        filters={[{ name: 'activo', label: 'Activa', options: [{ value: 'true', label: 'Activas' }, { value: 'false', label: 'Inactivas' }] }]}
        emptyText="Registra una empresa para empezar a sincronizar datos."
        columns={[
          { key: 'simbolo', label: 'Símbolo', render: r => <strong>{r.simbolo}</strong> },
          { key: 'nombre', label: 'Nombre' },
          { key: 'mercado', label: 'Mercado' },
          { key: 'sector', label: 'Sector', render: r => r.sector || '—' },
          { key: 'cik', label: 'CIK', render: r => r.cik ? <code>{r.cik}</code> : '—' },
          { key: 'activo', label: 'Activa', render: r => <Badge value={r.activo !== false} /> },
        ]}
        rowActions={row => <Link className="btn btn--sm" to={`/mercado/${encodeURIComponent(row.simbolo)}`}>Mercado</Link>}
      />
    </>
  );
}
