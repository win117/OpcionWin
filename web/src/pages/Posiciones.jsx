import { PageHeader } from '../components/Layout';
import CarteraPaper from './analizar/CarteraPaper';
import { PosicionesRegistro } from './broker/PosicionesRegistro';
import { useBroker } from '../context/BrokerContext';
import { useConexionBroker } from '../hooks/useConexionBroker';
import { Notice } from '../components/States';

export default function Posiciones() {
  const { broker, nombre, entorno, bloqueado, info } = useBroker();
  const { conexion, conexionesL } = useConexionBroker();
  return (
    <>
      <PageHeader title="Posiciones" subtitle={`Posiciones abiertas en ${nombre} · ${entorno}. Cambia de broker en la barra superior.`} />
      {bloqueado && <Notice tone="warning" title={nombre + ' no está operativo.'}>{info?.mensaje || 'El servidor indica que aún no se puede operar con este broker.'}</Notice>}
      <CarteraPaper key={broker} broker={broker} vista="posiciones" titulo={`Cartera ${nombre} (${entorno})`} />
      <details className="card details">
        <summary>Registro de posiciones sincronizadas</summary>
        <PosicionesRegistro conexionesL={conexionesL} conexionId={conexion?._id} />
      </details>
    </>
  );
}
