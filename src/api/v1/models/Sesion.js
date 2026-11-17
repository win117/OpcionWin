import { text, choice, entitySchema, register, hideSecrets } from './shared';


export const schema = entitySchema({
  usuarioId: text(), baseDatos: choice(['mongodb', 'supabase']),
  tokenHash: { ...text(), select: false },
  expiraEn: { type: Date, required: true }, revocadaEn: Date
});
schema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });
schema.index({ tokenHash: 1 }, { unique: true });
schema.pre('validate', function () {
  if (this.expiraEn && this.expiraEn <= new Date()) this.invalidate('expiraEn', 'La sesión debe expirar en el futuro.');
});
hideSecrets(schema);

export default register('Sesion', schema, 'sesiones');
