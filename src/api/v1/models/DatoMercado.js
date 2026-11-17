import { text, choice, number, reference, entitySchema, register, fuenteSchema, griegasSchema } from './shared';


export const schema = entitySchema({
  empresaId: reference('Empresa'), contratoId: reference('ContratoOpcion', false),
  tipo: choice(['cotizacion', 'vela', 'snapshot_opcion']),
  fuente: { type: fuenteSchema, required: true }, intervalo: text(false),
  apertura: number(false, 0), maximo: number(false, 0), minimo: number(false, 0),
  cierre: number(false, 0), volumen: number(false, 0),
  bid: number(false, 0), ask: number(false, 0), ultimo: number(false, 0),
  volatilidadImplicita: number(false, 0),
  griegas: { type: griegasSchema }
});
schema.index({ empresaId: 1, tipo: 1, 'fuente.fechaDato': -1 });
schema.pre('validate', function () {
  if (this.tipo === 'vela') {
    for (const campo of ['apertura', 'maximo', 'minimo', 'cierre', 'volumen', 'intervalo']) {
      if (this[campo] == null) this.invalidate(campo, 'Campo obligatorio para una vela.');
    }
    if (this.maximo < Math.max(this.apertura, this.minimo, this.cierre) ||
        this.minimo > Math.min(this.apertura, this.maximo, this.cierre)) {
      this.invalidate('maximo', 'Los extremos deben contener apertura y cierre.');
    }
  }
  if (this.tipo === 'snapshot_opcion' && !this.contratoId) this.invalidate('contratoId', 'Contrato requerido.');
  if (this.bid != null && this.ask != null && this.bid > this.ask) this.invalidate('ask', 'Ask no puede ser menor que bid.');
});


export default register('DatoMercado', schema, 'datos_mercado');
