import { text, choice, number, positiveNumber, reference, entitySchema, register } from './shared';


export const schema = entitySchema({
  usuarioId: text(), conexionId: reference('ConexionBroker'),
  posicionExternaId: text(), contratoId: reference('ContratoOpcion'),
  lado: choice(['long', 'short']), cantidad: positiveNumber(),
  precioPromedio: number(true, 0), actualizadaEn: { type: Date, required: true },
  estado: choice(['abierta', 'cerrada'], 'abierta')
});
schema.index({ conexionId: 1, posicionExternaId: 1 }, { unique: true });



export default register('Posicion', schema, 'posiciones');
