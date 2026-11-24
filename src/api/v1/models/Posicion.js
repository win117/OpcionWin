import { text, choice, number, positiveNumber, reference, entitySchema, register } from './shared';

function siCerrable() { return this.cerrable !== false; }

export const schema = entitySchema({
  usuarioId: text(), conexionId: reference('ConexionBroker'),
  posicionExternaId: text(), contratoId: reference('ContratoOpcion'),
  // Sin lado o cantidad fiables la posición se muestra, pero no se puede cerrar (cerrable: false).
  lado: { ...choice(['long', 'short']), required: siCerrable }, cantidad: { ...positiveNumber(), required: siCerrable },
  precioPromedio: number(false, 0), actualizadaEn: { type: Date, required: true },
  estado: choice(['abierta', 'cerrada'], 'abierta'),
  grupoId: text(false), cerrable: { type: Boolean, default: true } // grupoId: patas de una misma estructura en el broker
});
schema.index({ conexionId: 1, posicionExternaId: 1 }, { unique: true });



export default register('Posicion', schema, 'posiciones');
