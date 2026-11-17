import { text, choice, integer, reference, entitySchema, register, ESTADOS_TRABAJO } from './shared';


export const schema = entitySchema({
  usuarioId: text(), proveedor: text(), recurso: choice(['empresas', 'contratos', 'cotizaciones', 'historicos', 'fundamentales', 'institucional', 'noticias', 'ordenes', 'posiciones']),
  conexionId: reference('ConexionBroker', false), simbolos: { type: [String], default: [] },
  desde: Date, hasta: Date, estado: choice(ESTADOS_TRABAJO, 'pendiente'),
  procesados: integer(0), fallidos: integer(0), error: text(false), finalizadaEn: Date
});

schema.pre('validate', function () {
  if (this.desde && this.hasta && this.desde > this.hasta) this.invalidate('hasta', 'Periodo inválido.');
});


export default register('Sincronizacion', schema, 'sincronizaciones');

