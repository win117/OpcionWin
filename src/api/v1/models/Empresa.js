import { text, entitySchema, register } from './shared';


export const schema = entitySchema({
  simbolo: { ...text(), uppercase: true, maxlength: 32 },
  nombre: text(), mercado: text(), sector: text(false),
  cik: { type: String, match: /^\d{10}$/ }, activo: { type: Boolean, default: true }
});
schema.index({ simbolo: 1, mercado: 1 }, { unique: true });



export default register('Empresa', schema, 'empresas');

