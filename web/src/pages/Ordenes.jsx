import { PageHeader } from '../components/Layout';
import CarteraPaper from './analizar/CarteraPaper';
import { OrdenesRegistro } from './broker/OrdenesRegistro';
import { useBroker } from '../context/BrokerContext';
import { useConexionBroker } from '../hooks/useConexionBroker';
import { useLookup } from '../hooks/useLookup';
import { configuraciones } from '../api/resources';

export default function Ordenes() {
  const { broker, nombre, bloqueado, info } = useBroker();
  const { conexion, conexionesL } = useConexionBroker();
  const configsL = useLookup(configuraciones);
  return (
    <>
      <PageHeader title="Órdenes" subtitle={`Cuenta simulada de ${nombre}, sin dinero real. Para cambiar de broker usa el selector de la cabecera o, en pantallas chicas, el menú de tu cuenta.`} />
      <CarteraPaper key={broker} broker={broker} nombre={nombre} vista="ordenes" noOperativo={bloqueado ? info?.mensaje || 'Todavía no se puede operar con este broker.' : null} />
      <details className="card details">
        <summary>Historial y órdenes desde configuración</summary>
        {conexion
          ? <OrdenesRegistro conexionesL={conexionesL} configsL={configsL} conexionId={conexion._id} />
          : <p className="muted small">No hay una conexión registrada para {nombre}. Se crea automáticamente al enviar la primera orden, o en Configuración → Conexiones.</p>}
      </details>
    </>
  );
}
