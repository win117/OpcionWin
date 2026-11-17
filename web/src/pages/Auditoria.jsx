import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { Badge } from '../components/Badge';
import { auditoria } from '../api/resources';
import { fmtDateTime, shortId } from '../utils/format';

export default function Auditoria() {
  return (
    <>
      <PageHeader title="Auditoría" subtitle="Eventos registrados por el servidor (solo lectura)" />
      <ResourceManager
        api={auditoria}
        sortDesc="ocurridoEn"
        searchPlaceholder="Buscar en la descripción"
        creatable={false}
        editable={false}
        deletable={false}
        filters={[{ name: 'resultado', label: 'Resultado', options: [{ value: 'exito', label: 'Éxito' }, { value: 'error', label: 'Error' }] }]}
        emptyText="No hay eventos de auditoría."
        columns={[
          { key: 'fecha', label: 'Ocurrido', render: r => fmtDateTime(r.ocurridoEn) },
          { key: 'accion', label: 'Acción', render: r => <code>{r.accion}</code> },
          { key: 'recurso', label: 'Recurso' },
          { key: 'recursoId', label: 'ID', render: r => r.recursoId ? <code title={r.recursoId}>{shortId(r.recursoId)}</code> : '—' },
          { key: 'resultado', label: 'Resultado', render: r => <Badge value={r.resultado} /> },
          { key: 'descripcion', label: 'Descripción', className: 'col-wrap', render: r => r.descripcion || '—' },
          { key: 'requestId', label: 'Request', render: r => <code title={r.requestId}>{shortId(r.requestId)}</code> },
        ]}
      />
    </>
  );
}
