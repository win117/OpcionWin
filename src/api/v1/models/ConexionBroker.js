import { text, choice, reference, entitySchema, register, hideSecrets } from './shared';


export const schema = entitySchema({
  usuarioId: text(), brokerId: reference('Broker'), alias: text(),
  entorno: choice(['paper', 'live']), cuentaExternaId: text(false),
  credencialRef: { ...text(false), select: false },
  estado: choice(['pendiente', 'activa', 'revocada', 'error'], 'pendiente')
});
schema.index({ usuarioId: 1, brokerId: 1, entorno: 1 });

hideSecrets(schema);

export default register('ConexionBroker', schema, 'conexiones_broker');

