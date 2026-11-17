import { text, choice, entitySchema, register } from './shared';


export const schema = entitySchema({
  usuarioId: text(), accion: text(), recurso: text(), recursoId: text(false),
  resultado: choice(['exito', 'error']), requestId: text(),
  ocurridoEn: { type: Date, default: Date.now }, descripcion: text(false)
});
schema.index({ usuarioId: 1, ocurridoEn: -1 });



export default register('EventoAuditoria', schema, 'eventos_auditoria');

