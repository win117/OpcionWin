// Piezas comunes de los esquemas de petición (Zod). Cada ruta que no es CRUD se describe una sola vez en esta carpeta:
// de ahí salen la validación (middlewares/validar.handler.js) y la documentación OpenAPI (config/openapi.js).
import * as z from 'zod';
import { CORES, ESTRATEGIAS } from '../models/shared';

z.config(z.locales.es());
export { z };

export const id = z.string().trim().min(1).max(128).describe('Identificador del registro');
export const simbolo = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.-]{0,9}$/, 'símbolo inválido').describe('Símbolo, por ejemplo AAPL');
export const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa AAAA-MM-DD');
export const core = z.enum(CORES);
export const estrategia = z.enum(ESTRATEGIAS);
export const broker = z.enum(['alpaca', 'webull', 'ibkr']).describe('Broker paper; por defecto alpaca');
const SIN_CLAVE = 'Envía el header Idempotency-Key (8-128 caracteres: letras, números, _ o -).';
export const idempotencia = z.object({ 'idempotency-key': z.string({ error: SIN_CLAVE }).regex(/^[\w-]{8,128}$/, SIN_CLAVE) });
export const parametros = z.looseObject({
  intervalo: z.enum(['1Day']).optional(), indicadores: z.array(z.string()).optional().describe('Señales a usar (GET /cores/catalogo)'),
  diasVencimientoMin: z.number().optional(), diasVencimientoMax: z.number().optional(), vidaMediaDias: z.number().optional(), ventanaDias: z.number().optional(),
});
export const ponderaciones = z.array(z.looseObject({ core, peso: z.number().min(0) }));

/** Definición de una ruta: { metodo, ruta, grupo, resumen, params?, query?, headers?, body?, exito? (código), errores? ({ código: texto }) }. */
export const definir = d => ({ exito: 200, errores: {}, ...d });
export const trabajo = d => definir({ exito: 202, ...d, resumen: d.resumen + ' Responde 202: consulta el registro hasta completada o fallida.' });
