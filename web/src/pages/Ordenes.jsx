import { PageHeader } from '../components/Layout';
import CarteraPaper from './analizar/CarteraPaper';
import { OrdenesRegistro } from './broker/OrdenesRegistro';
import { useBroker } from '../context/BrokerContext';
import { useConexionBroker } from '../hooks/useConexionBroker';
import { useLookup } from '../hooks/useLookup';
import { configuraciones } from '../api/resources';
import { Notice } from '../components/States';

export default function Ordenes() {
  const { broker, nombre, entorno, bloqueado, info } = useBroker();
  const { conexion, conexionesL } = useConexionBroker();
  const configsL = useLookup(configuraciones);
  return (
    <>
      <PageHeader title="Órdenes" subtitle={`Órdenes de ${nombre} · ${entorno}. Cambia de broker en la barra superior.`} />
      {bloqueado && <Notice tone="warning" title={nombre + ' no está operativo.'}>{info?.mensaje || 'El servidor indica que aún no se puede operar con este broker.'}</Notice>}
      <CarteraPaper key={broker} broker={broker} vista="ordenes" titulo={`Órdenes recientes en ${nombre}`} />
      <details className="card details">
        <summary>Historial y órdenes desde configuración</summary>
        {conexion
          ? <OrdenesRegistro conexionesL={conexionesL} configsL={configsL} conexionId={conexion._id} />
          : <p className="muted small">No hay una conexión registrada para {nombre}. Se crea automáticamente al enviar la primera orden, o en Configuración → Conexiones.</p>}
      </details>
    </>
  );
}
