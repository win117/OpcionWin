import { text, choice, reference, coresField, entitySchema, register, ESTRATEGIAS, ESTADOS_TRABAJO, parametrosSchema, resultadoSchema } from './shared';


export const schema = entitySchema({
  usuarioId: text(), modo: choice(['empresa', 'estrategia', 'empresa_estrategia']),
  empresaId: reference('Empresa', false), estrategiaId: reference('Estrategia', false),
  empresasCandidatas: { type: [String], default: [] },
  estrategiasCandidatas: { type: [String], enum: ESTRATEGIAS, default: [] },
  coresSeleccionados: coresField(), perfilId: reference('PerfilAnalisis', false),
  filtros: { type: parametrosSchema, default: () => ({}) },
  estado: choice(ESTADOS_TRABAJO, 'pendiente'),
  resultados: { type: [resultadoSchema], default: [] }, error: text(false)
});
schema.index({ usuarioId: 1, createdAt: -1 });
schema.pre('validate', function () {
  if (['empresa', 'empresa_estrategia'].includes(this.modo) && !this.empresaId) this.invalidate('empresaId', 'Empresa requerida para este modo.');
  if (['estrategia', 'empresa_estrategia'].includes(this.modo) && !this.estrategiaId) this.invalidate('estrategiaId', 'Estrategia requerida para este modo.');
});


export default register('Seleccion', schema, 'selecciones');

