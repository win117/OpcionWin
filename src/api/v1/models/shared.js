import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

export const CORES = ['tecnico', 'fundamental', 'institucional', 'indicadores', 'noticias'];
export const ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR'];
export const ESTADOS_TRABAJO = ['pendiente', 'procesando', 'completada', 'fallida'];
export const text = (required = true) => ({ type: String, required, trim: true, maxlength: 2000 });
export const choice = (values, defaultValue) => ({ type: String, enum: values, required: true, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
export const number = (required = true, min, max) => ({
  type: Number, required, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
  validate: { validator: v => v == null || Number.isFinite(v), message: 'Debe ser un número finito.' },
});
export const positiveNumber = () => ({ ...number(), validate: { validator: v => Number.isFinite(v) && v > 0, message: 'Debe ser mayor que cero.' } });
export const positiveInteger = defaultValue => ({
  ...number(true, 1), ...(defaultValue === undefined ? {} : { default: defaultValue }),
  validate: { validator: Number.isSafeInteger, message: 'Debe ser un entero positivo seguro.' },
});
export const integer = defaultValue => ({ ...number(true, 0), default: defaultValue, validate: Number.isSafeInteger });
export const reference = (ref, required = true) => ({ ...text(required), ref });
export const nonEmptyUnique = { validator: v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length, message: 'Se requiere un arreglo no vacío, sin duplicados.' };
export const uniqueIds = { validator: v => new Set(v.map(x => String(x._id))).size === v.length, message: 'No repetir identificadores de subdocumentos.' };
export const coresField = () => ({ type: [String], enum: CORES, required: true, validate: nonEmptyUnique });
const identity = () => ({ type: String, default: randomUUID, required: true });
const options = { strict: 'throw', timestamps: true, versionKey: false, autoCreate: false, autoIndex: false, bufferCommands: false };
export const entitySchema = fields => new mongoose.Schema({ _id: identity(), ...fields }, options);
export const childSchema = fields => new mongoose.Schema({ _id: identity(), ...fields }, { strict: 'throw', versionKey: false });
export const valueSchema = fields => new mongoose.Schema(fields, { _id: false, strict: 'throw' });
export const register = (name, schema, collection) => mongoose.models[name] || mongoose.model(name, schema, collection);

export const fuenteSchema = valueSchema({
  proveedor: text(), fechaDato: { type: Date, required: true },
  recuperadoEn: { type: Date, default: Date.now },
  feed: text(false), referencia: text(false),
});
export const griegasSchema = valueSchema({
  delta: number(false, -1, 1), gamma: number(false), theta: number(false),
  vega: number(false), rho: number(false),
});
export const parametrosSchema = valueSchema({
  intervalo: text(false), periodos: positiveInteger(120),
  diasVencimientoMin: integer(0), diasVencimientoMax: integer(60),
  desde: Date, hasta: Date, indicadores: { type: [String], default: [] },
});
parametrosSchema.pre('validate', function () {
  if (this.diasVencimientoMin > this.diasVencimientoMax) this.invalidate('diasVencimientoMax', 'Rango de vencimiento inválido.');
  if (this.desde && this.hasta && this.desde > this.hasta) this.invalidate('hasta', 'Periodo inválido.');
});
export const metricaSchema = childSchema({
  nombre: text(), valor: number(), unidad: text(), periodo: text(false),
});
export const tenenciaSchema = childSchema({
  institucion: text(), identificadorInstitucion: text(), acciones: number(true, 0),
  valorReportado: number(true, 0), unidad: text(),
});
export const ruleFields = () => ({
  core: choice(CORES), criterio: text(),
  operador: choice(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between']),
  valorReferencia: number(), valorSuperior: number(false),
  peso: number(true, 0), obligatoria: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
});
export const validateRule = schema => schema.pre('validate', function () {
  if (this.operador === 'between' && (this.valorSuperior == null || this.valorSuperior < this.valorReferencia)) this.invalidate('valorSuperior', 'Rango inválido.');
});
export const reglaSnapshotSchema = childSchema(ruleFields());
validateRule(reglaSnapshotSchema);
export const resultadoSchema = childSchema({
  empresaId: reference('Empresa'), estrategiaId: reference('Estrategia'),
  confluenciaId: reference('Confluencia', false), puntaje: number(true, 0, 100),
  cobertura: number(true, 0, 1), motivos: { type: [String], default: [] },
});
export const ponderacionSchema = valueSchema({ core: choice(CORES), peso: number(true, 0) });
export const ordenComponenteSchema = childSchema({
  contratoId: reference('ContratoOpcion'), simbolo: text(),
  accion: choice(['buy', 'sell']), intencion: choice(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']),
  proporcion: positiveInteger(),
});
ordenComponenteSchema.pre('validate', function () {
  if (this.intencion && this.accion && !this.intencion.startsWith(this.accion + '_')) this.invalidate('intencion', 'La intención debe corresponder a la acción.');
});
export const eventoOrdenSchema = childSchema({
  tipo: text(), fecha: { type: Date, default: Date.now }, mensaje: text(false),
});
// No confiar en select:false para serializar documentos recién creados.
export const hideSecrets = schema => {
  const transform = (_doc, record) => {
    delete record.tokenHash;
    delete record.credencialRef;
    return record;
  };
  schema.set('toJSON', { transform });
  schema.set('toObject', { transform });
};
