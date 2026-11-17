import { text, choice, integer, reference, entitySchema, register, ESTADOS_TRABAJO } from './shared';


export const schema = entitySchema({
  usuarioId: text(), proveedor: text(), recurso: choice(['empresas', 'contratos', 'cotizaciones', 'historicos', 'fundamentales', 'institucional', 'noticias', 'ordenes', 'posiciones']),
  conexionId: reference('ConexionBroker', false), simbolos: { type: [String], default: [] },
  desde: Date, hasta: Date, diasVencimientoMin: { type: Number, min: 0, max: 3650 }, diasVencimientoMax: { type: Number, min: 0, max: 3650 }, estado: choice(ESTADOS_TRABAJO, 'pendiente'),
  procesados: integer(0), fallidos: integer(0), error: text(false), finalizadaEn: Date
});

schema.pre('validate', function () {
  if (this.desde && this.hasta && this.desde > this.hasta) this.invalidate('hasta', 'Periodo inválido.');
  if (this.diasVencimientoMin != null && this.diasVencimientoMax != null && this.diasVencimientoMin > this.diasVencimientoMax) this.invalidate('diasVencimientoMax', 'Rango de vencimiento inválido.');
});


export default register('Sincronizacion', schema, 'sincronizaciones');

