import { reference, entitySchema, register, fuenteSchema, tenenciaSchema } from './shared';


export const schema = entitySchema({
  empresaId: reference('Empresa'), fuente: { type: fuenteSchema, required: true },
  fechaCorte: { type: Date, required: true }, fechaPublicacion: { type: Date, required: true },
  tenencias: { type: [tenenciaSchema], default: [] }
});
schema.index({ empresaId: 1, fechaCorte: -1 });
schema.pre('validate', function () {
  if (this.fechaPublicacion < this.fechaCorte) this.invalidate('fechaPublicacion', 'La publicación no puede preceder al corte.');
});


export default register('ReporteInstitucional', schema, 'reportes_institucionales');
