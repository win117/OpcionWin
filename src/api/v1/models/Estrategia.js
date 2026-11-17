import { text, choice, entitySchema, register, ESTRATEGIAS } from './shared';


export const schema = entitySchema({
  codigo: choice(ESTRATEGIAS), nombre: text(), descripcion: text(),
  activo: { type: Boolean, default: true }
});
schema.index({ codigo: 1 }, { unique: true });



export default register('Estrategia', schema, 'estrategias');

