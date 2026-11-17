import { text, choice, number, reference, nonEmptyUnique, coresField, entitySchema, register, ESTADOS_TRABAJO, ponderacionSchema } from './shared';


export const schema = entitySchema({
  usuarioId: text(), empresaId: reference('Empresa'), estrategiaId: reference('Estrategia'),
  evaluacionesIds: { type: [String], required: true, validate: nonEmptyUnique },
  coresSeleccionados: coresField(), versionAlgoritmo: text(),
  estado: choice(ESTADOS_TRABAJO, 'pendiente'),
  ponderaciones: { type: [ponderacionSchema], default: [] },
  puntaje: number(false, 0, 100), cobertura: number(false, 0, 1),
  motivos: { type: [String], default: [] }, error: text(false)
});

schema.pre('validate', function () {
  const cores = this.ponderaciones.map(p => p.core);
  if (new Set(cores).size !== cores.length || cores.some(c => !this.coresSeleccionados.includes(c))) this.invalidate('ponderaciones', 'Cores duplicados o no seleccionados.');
});


export default register('Confluencia', schema, 'confluencias');
