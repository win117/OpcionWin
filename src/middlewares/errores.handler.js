// Registro de errores inesperados: nombre, mensaje corto y pila. Sin cuerpos, cabeceras, consulta ni secretos.
const SECRETA = /KEY|SECRET|TOKEN|PASSWORD|CONNECTION_STRING|AUTH_USERS_JSON/;
export function ocultarSecretos(texto, entorno = process.env) {
  let salida = String(texto ?? '');
  for (const [nombre, valor] of Object.entries(entorno)) if (SECRETA.test(nombre) && valor?.length >= 6) salida = salida.split(valor).join('[oculto]');
  return salida.replace(/\/\/[^\s/@]+@/g, '//[oculto]@'); // usuario:contraseña dentro de una URL
}
export function registrarError(error, { requestId = '-', metodo = '', ruta = '' } = {}) {
  // Un SyntaxError de JSON cita un fragmento del cuerpo: se omite su mensaje.
  const mensaje = error instanceof SyntaxError ? '' : ocultarSecretos(error?.message).slice(0, 300);
  const pila = String(error?.stack || '').split('\n').filter(l => /^\s+at /.test(l)).join('\n');
  console.error('[error]', requestId, metodo, ruta, (error?.name || typeof error) + (mensaje ? ': ' + mensaje : '') + (pila ? '\n' + ocultarSecretos(pila) : ''));
}
