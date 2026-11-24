import { PageHeader } from '../components/Layout';
import CarteraPaper from './analizar/CarteraPaper';
import { PosicionesRegistro } from './broker/PosicionesRegistro';
import { useBroker } from '../context/BrokerContext';
import { useConexionBroker } from '../hooks/useConexionBroker';

export default function Posiciones() {
  const { broker, nombre, bloqueado, info } = useBroker();
  const { conexion, conexionesL } = useConexionBroker();
  return (
    <>
      <PageHeader title="Posiciones" subtitle={`Cuenta simulada de ${nombre}, sin dinero real. Para cambiar de broker usa el selector de la cabecera o, en pantallas chicas, el menú de tu cuenta.`} />
      <CarteraPaper key={broker} broker={broker} nombre={nombre} vista="posiciones" noOperativo={bloqueado ? info?.mensaje || 'Todavía no se puede operar con este broker.' : null} />
      <details className="card details">
        <summary>Registro de posiciones sincronizadas</summary>
        <PosicionesRegistro conexionesL={conexionesL} conexionId={conexion?._id} />
      </details>
    </>
  );
}
