import { z, definir } from './comunes';

const grupo = 'Sesiones';
export const login = definir({ metodo: 'post', ruta: '/sesiones', grupo, publica: true, resumen: 'Inicia sesión eligiendo la base de datos. Devuelve el token Bearer.', errores: { 401: 'Credenciales inválidas', 429: 'Demasiados intentos' },
  body: z.looseObject({ email: z.string(), password: z.string().max(1024).meta({ format: 'password' }), baseDatos: z.enum(['mongodb', 'supabase']) }) });
export const actual = definir({ metodo: 'get', ruta: '/sesiones/actual', grupo, resumen: 'Sesión vigente.' });
export const logout = definir({ metodo: 'delete', ruta: '/sesiones/actual', grupo, resumen: 'Cierra la sesión.', exito: 204 });
