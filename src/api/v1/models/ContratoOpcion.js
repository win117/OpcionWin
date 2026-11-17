import { text, choice, positiveNumber, positiveInteger, reference, entitySchema, register } from './shared';


export const schema = entitySchema({
  proveedor: text(), contratoExternoId: text(), empresaId: reference('Empresa'),
  simbolo: text(), tipo: choice(['call', 'put']),
  strike: positiveNumber(), vencimiento: { type: Date, required: true },
  multiplicador: positiveInteger(100), moneda: { type: String, default: 'USD', enum: ['USD'] },
  activo: { type: Boolean, default: true }
});
schema.index({ proveedor: 1, contratoExternoId: 1 }, { unique: true });
schema.index({ empresaId: 1, vencimiento: 1, tipo: 1 });



export default register('ContratoOpcion', schema, 'contratos_opciones');
