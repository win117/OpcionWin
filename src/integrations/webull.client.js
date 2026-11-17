// Adaptador de Webull: pendiente (ADR-004).
// No se usa una API pública estable de opciones para este alcance; todos los métodos
// fallan con IntegrationError NO_IMPLEMENTADO y no realizan solicitudes de red.
import { IntegrationError } from './errors';

const PROVEEDOR = 'webull';
const MENSAJE = 'Adaptador Webull no implementado (ADR-004): usar Alpaca para datos y trading paper.';
const METODOS = [
  'buscarActivo', 'velas', 'cotizacion', 'contratos', 'snapshotsOpciones', 'noticias',
  'cuenta', 'enviarOrden', 'consultarOrden', 'cancelarOrden', 'posiciones',
];

export const createWebullClient = () => {
  const cliente = { proveedor: PROVEEDOR, configurado: false };
  for (const metodo of METODOS) {
    cliente[metodo] = async () => {
      throw new IntegrationError({ proveedor: PROVEEDOR, status: null, codigo: 'NO_IMPLEMENTADO', mensaje: `${MENSAJE} (${metodo})` });
    };
  }
  return cliente;
};
