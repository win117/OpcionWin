import { text, choice, number, reference, entitySchema, register, CORES, ESTADOS_TRABAJO, parametrosSchema, fuenteSchema, metricaSchema, reglaSnapshotSchema } from './shared';


export const schema = entitySchema({
  usuarioId: text(), core: choice([...CORES, 'configuracion']),
  empresaId: reference('Empresa', false), configuracionId: reference('Configuracion', false),
  perfilId: reference('PerfilAnalisis', false), versionAlgoritmo: text(),
  parametros: { type: parametrosSchema, default: () => ({}) },
  reglasAplicadas: { type: [reglaSnapshotSchema], default: [] },
  estado: choice(ESTADOS_TRABAJO, 'pendiente'),
  puntaje: number(false, 0, 100), cobertura: number(false, 0, 1),
  fuentes: { type: [fuenteSchema], default: [] },
  metricas: { type: [metricaSchema], default: [] },
  motivos: { type: [String], default: [] }, datosFaltantes: { type: [String], default: [] },
  error: text(false), finalizadaEn: Date
});
schema.index({ usuarioId: 1, core: 1, createdAt: -1 });
schema.pre('validate', function () {
  const requiredField = this.core === 'configuracion' ? 'configuracionId' : 'empresaId';
  if (!this[requiredField]) this.invalidate(requiredField, 'Debe identificar el objeto evaluado.');
  if (this.estado === 'fallida' && !this.error) this.invalidate('error', 'Describe el error.');
});


export default register('Evaluacion', schema, 'evaluaciones');

