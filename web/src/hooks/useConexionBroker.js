import { useMemo } from 'react';
import { brokers, conexiones } from '../api/resources';
import { useBroker } from '../context/BrokerContext';
import { useLookup } from './useLookup';

/** Conexión paper registrada del broker elegido (para filtrar posiciones y órdenes). */
export function useConexionBroker() {
  const { broker } = useBroker();
  const brokersL = useLookup(brokers);
  const conexionesL = useLookup(conexiones);
  const conexion = useMemo(() => {
    const b = brokersL.items.find(x => x.codigo === broker);
    if (!b) return null;
    const propias = conexionesL.items.filter(c => c.brokerId === b._id);
    return propias.find(c => c.entorno === 'paper') || propias[0] || null;
  }, [broker, brokersL.items, conexionesL.items]);
  return { conexion, conexionesL, loading: brokersL.loading || conexionesL.loading };
}
