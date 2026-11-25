import { text, choice, entitySchema, register } from './shared';


export const schema = entitySchema({
  codigo: choice(['alpaca', 'webull', 'ibkr']), nombre: text(),
  activo: { type: Boolean, default: false },
  entornos: { type: [String], enum: ['paper', 'live'], default: [] }
});
schema.index({ codigo: 1 }, { unique: true });



export default register('Broker', schema, 'brokers');
