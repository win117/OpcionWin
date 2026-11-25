import { z, id, simbolo, definir, trabajo } from './comunes';

const grupo = 'Datos de proveedores';
export const RECURSOS = ['empresas', 'historicos', 'cotizaciones', 'contratos', 'noticias', 'fundamentales', 'institucional', 'posiciones', 'ordenes'];
const DE_CONEXION = ['posiciones', 'ordenes'];
const dias = z.coerce.number().int().min(0).max(3650).nullish();
const fecha = z.string().max(40).refine(v => !Number.isNaN(Date.parse(v)), 'fecha inválida').nullish();

export const estado = definir({ metodo: 'get', ruta: '/integraciones/estado', grupo, resumen: 'Qué proveedores están configurados (sin revelar claves).' });

export const sincronizar = trabajo({ metodo: 'post', ruta: '/sincronizaciones/ejecuciones', grupo, resumen: 'Trae datos del proveedor y los guarda en la base de la sesión.',
  body: z.looseObject({
    recurso: z.enum(RECURSOS, { error: 'recurso inválido. Usa: ' + RECURSOS.join(', ') }),
    simbolos: z.array(simbolo).max(100).transform(l => [...new Set(l)]).pipe(z.array(z.string()).max(25, 'hasta 25 símbolos')).optional().default([]),
    desde: fecha, hasta: fecha, diasVencimientoMin: dias, diasVencimientoMax: dias, conexionId: id.nullish().describe('Obligatorio para posiciones y ordenes'),
  }).refine(b => !DE_CONEXION.includes(b.recurso) || b.conexionId, { message: 'requerido para posiciones y ordenes', path: ['conexionId'] }) });

export const buscarActivos = definir({ metodo: 'get', ruta: '/activos/busqueda', grupo, resumen: 'Busca empresas por símbolo o nombre (tolera errores de escritura).',
  query: z.object({ q: z.string().optional().describe('1 a 20 caracteres'), limit: z.string().optional().describe('1 a 50; por defecto 20') }) });
