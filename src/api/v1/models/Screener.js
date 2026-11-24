// Resultado compacto del screener por símbolo (se recalcula con el trabajo de sincronización del universo).
import { text, number, entitySchema, valueSchema, register } from './shared';

const factorSchema = valueSchema({ nombre: text(), valor: number(false), puntaje: number(true, 0, 100) });
const porEstrategia = campo => valueSchema({ LONG_CALL: campo, LONG_PUT: campo, IRON_CONDOR: campo });

export const schema = entitySchema({
  usuarioId: text(), simbolo: text(), nombre: text(false),
  precio: number(false), cambioPct: number(false), volumenPromedio: number(false), ivPromedio: number(false),
  puntajes: porEstrategia(number(false, 0, 100)),
  factores: porEstrategia({ type: [factorSchema], default: [] }),
  resumenes: porEstrategia(text(false)),
  // Datos del emisor y variaciones (los llena el universo vivo; obtenidos de la SEC y Alpaca).
  cik: text(false), sic: number(false), sector: text(false), industria: text(false), acciones: number(false), capitalizacion: number(false),
  cambio5d: number(false), cambio21d: number(false), cambioAnio: number(false), maximo52: number(false), minimo52: number(false), hv20: number(false),
  versionAlgoritmo: text(false), actualizadoEn: { type: Date, required: true },
});
schema.index({ usuarioId: 1, simbolo: 1 });

export default register('Screener', schema, 'screener');
