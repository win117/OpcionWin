import { useState } from 'react';
import { ResourceManager } from '../../components/ResourceManager';
import { Badge } from '../../components/Badge';
import { SyncButton } from '../../components/SyncButton';
import { useLookup } from '../../hooks/useLookup';
import { contratos, posiciones } from '../../api/resources';
import { fmtDateTime, fmtMoney, fmtNum, shortId } from '../../utils/format';
import { contratoLabel } from '../../utils/objects';

/* ---------- Posiciones ---------- */
export function PosicionesRegistro({ conexionesL, conexionId }) {
  const contratosL = useLookup(contratos);
  const [signal, setSignal] = useState(0);
  return (
    <ResourceManager
      api={posiciones}
      baseQuery={conexionId ? { conexionId } : {}}
      searchable={false}
      creatable={false}
      editable={false}
      deletable={false}
      reloadSignal={signal}
      filters={[{ name: 'estado', label: 'Estado', options: [{ value: 'abierta', label: 'Abiertas' }, { value: 'cerrada', label: 'Cerradas' }] }]}
      emptyText="Sincroniza posiciones desde una conexión paper."
      toolbar={() => (
        <div className="sync-inline">
          {!conexionId && <span className="muted small">No hay conexión paper para este broker (créala en Configuración → Conexiones).</span>}
          <SyncButton recurso="posiciones" conexionId={conexionId} disabled={!conexionId} onDone={() => setSignal(s => s + 1)} label="Sincronizar posiciones" />
          <SyncButton recurso="ordenes" conexionId={conexionId} disabled={!conexionId} label="Sincronizar órdenes" />
        </div>
      )}
      columns={[
        { key: 'contrato', label: 'Contrato', render: r => contratoLabel(contratosL.byId.get(r.contratoId)) || <code>{shortId(r.contratoId)}</code> },
        { key: 'lado', label: 'Lado', render: r => (r.lado ? <Badge tone={r.lado === 'long' ? 'info' : 'warning'}>{r.lado === 'long' ? 'comprada' : 'vendida'}</Badge> : '—') },
        { key: 'cantidad', label: 'Cantidad', align: 'right', render: r => fmtNum(r.cantidad, 2) },
        { key: 'precio', label: 'Precio promedio', align: 'right', render: r => fmtMoney(r.precioPromedio) },
        { key: 'conexion', label: 'Conexión', render: r => conexionesL.byId.get(r.conexionId)?.alias || '—' },
        { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
        { key: 'actualizada', label: 'Actualizada', render: r => fmtDateTime(r.actualizadaEn) },
      ]}
    />
  );
}

