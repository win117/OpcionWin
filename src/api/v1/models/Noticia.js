import { text, entitySchema, register } from './shared';


export const schema = entitySchema({
  proveedor: text(), noticiaExternaId: text(), titulo: text(), resumen: text(false),
  url: { ...text(), match: /^https?:\/\// },
  publicadaEn: { type: Date, required: true },
  simbolos: { type: [String], default: [] }, idioma: text(false)
});
schema.index({ proveedor: 1, noticiaExternaId: 1 }, { unique: true });



export default register('Noticia', schema, 'noticias');
