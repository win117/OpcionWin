import { text, positiveInteger, uniqueIds, coresField, entitySchema, register, parametrosSchema } from './shared';
import reglaSchema from './ReglaAnalisis';

export const schema = entitySchema({
  usuarioId: text(), nombre: text(), descripcion: text(false),
  coresSeleccionados: coresField(),
  parametros: { type: parametrosSchema, default: () => ({}) },
  reglas: { type: [reglaSchema], default: [], validate: uniqueIds },
  version: positiveInteger(1), activo: { type: Boolean, default: true }
});
schema.index({ usuarioId: 1, nombre: 1 });
schema.pre('validate', function () {
  if (this.reglas.some(regla => !this.coresSeleccionados.includes(regla.core))) {
    this.invalidate('reglas', 'Cada regla debe pertenecer a un core seleccionado.');
  }
});


export default register('PerfilAnalisis', schema, 'perfiles_analisis');

