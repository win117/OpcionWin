import { text, choice, number, positiveInteger, reference, entitySchema, register, ordenComponenteSchema, eventoOrdenSchema } from './shared';


export const schema = entitySchema({
  usuarioId: text(), conexionId: reference('ConexionBroker'),
  configuracionId: reference('Configuracion'), ordenExternaId: text(false),
  idempotencyKey: text(), tipo: choice(['market', 'limit']), vigencia: text(),
  cantidad: positiveInteger(), precioLimite: number(false), credito: { type: Boolean, default: false },
  estado: choice(['pendiente', 'enviada', 'aceptada', 'parcial', 'ejecutada', 'cancelada', 'rechazada', 'expirada'], 'pendiente'),
  componentes: { type: [ordenComponenteSchema], required: true, validate: { validator: v => v.length >= 1 && v.length <= 4, message: 'Una orden requiere de 1 a 4 componentes.' } },
  eventos: { type: [eventoOrdenSchema], default: [] },
  // Ejecución reportada por el broker (el precio neto de un multi-pata puede ser negativo).
  cantidadEjecutada: number(false, 0), precioPromedioEjecucion: number(false),
  huella: text(false) // resumen de la solicitud: misma Idempotency-Key con otro contenido → 409
});
schema.index({ usuarioId: 1, conexionId: 1, idempotencyKey: 1 }, { unique: true });
schema.pre('validate', function () {
  if (this.tipo === 'limit' && this.precioLimite == null) this.invalidate('precioLimite', 'Precio requerido para orden limit.');
  if (this.tipo === 'market' && this.precioLimite != null) this.invalidate('precioLimite', 'Una orden market no lleva precio límite.');
});


export default register('Orden', schema, 'ordenes');

