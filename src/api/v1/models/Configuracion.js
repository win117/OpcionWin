import { text, choice, reference, uniqueIds, entitySchema, register, parametrosSchema } from './shared';
import componenteSchema from './Componente';

export const schema = entitySchema({
  usuarioId: text(), empresaId: reference('Empresa'), estrategiaId: reference('Estrategia'),
  nombre: text(), estado: choice(['borrador', 'validada', 'archivada'], 'borrador'),
  parametros: { type: parametrosSchema, default: () => ({}) },
  componentes: { type: [componenteSchema], default: [], validate: uniqueIds }
});
schema.index({ usuarioId: 1, updatedAt: -1 });



export default register('Configuracion', schema, 'configuraciones');

