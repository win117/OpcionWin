import { text, reference, entitySchema, register, fuenteSchema, metricaSchema } from './shared';


export const schema = entitySchema({
  empresaId: reference('Empresa'), fuente: { type: fuenteSchema, required: true },
  forma: text(false), // 10-K, 10-Q (SEC)
  periodoInicio: { type: Date, required: true }, periodoFin: { type: Date, required: true },
  metricas: { type: [metricaSchema], default: [] }
});
schema.index({ empresaId: 1, periodoFin: -1 });
schema.pre('validate', function () {
  if (this.periodoInicio > this.periodoFin) this.invalidate('periodoFin', 'Periodo inválido.');
});


export default register('Fundamental', schema, 'fundamentales');
