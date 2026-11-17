import { childSchema, reference, choice, positiveInteger } from './shared';

// Subdocumento de Configuracion; no tiene colección independiente.
const schema = childSchema({
  contratoId: reference('ContratoOpcion'),
  accion: choice(['buy', 'sell']),
  cantidad: positiveInteger(), proporcion: positiveInteger(1),
});
export default schema;

