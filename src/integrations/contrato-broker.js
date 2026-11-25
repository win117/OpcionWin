// Qué debe saber hacer un broker para poder operar con él. Los datos de mercado son otra cosa: solo los da Alpaca.
// Cada método devuelve la misma forma en todos los brokers (ver los normalizadores de alpaca.client.js y webull.client.js).
export const METODOS_BROKER = {
  cuenta: 'Cuenta: { cuentaExternaId, estado, moneda, efectivo, poderCompra, patrimonio, entorno }',
  enviarOrden: 'Envía una orden neutral y devuelve { ordenExternaId, clientOrderId, estado, … }',
  consultarOrden: 'Orden por su identificador externo',
  consultarPorClientOrderId: 'Orden por la Idempotency-Key con la que se envió (NO_ENCONTRADO si nunca llegó)',
  cancelarOrden: 'Pide la cancelación y devuelve la orden',
  ordenesAbiertas: 'Órdenes vivas en el broker, se hayan enviado desde aquí o no',
  posiciones: 'Posiciones vivas, una entrada por contrato',
};
// Opcionales: si el broker no los ofrece, la aplicación lo dice.
export const METODOS_OPCIONALES = { historialCartera: 'Valor diario de la cuenta', suscribirOrdenes: 'Avisos de órdenes en vivo' };

/** Falla al arrancar, y no a media operación, si a un broker le falta algo. */
export function exigirContratoBroker(adaptador) {
  const faltan = Object.keys(METODOS_BROKER).filter(m => typeof adaptador?.[m] !== 'function');
  if (faltan.length) throw new Error(`El broker ${adaptador?.proveedor || '?'} no cumple el contrato: falta ${faltan.join(', ')}.`);
  if (adaptador.entorno !== 'paper') throw new Error(`El broker ${adaptador.proveedor} no declara entorno paper.`);
  return adaptador;
}
