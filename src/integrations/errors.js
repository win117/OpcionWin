// Error normalizado de integraciones externas (contratos §4).
// Nunca incluir credenciales en `mensaje`: usar `redactar` antes de construirlo.

export const CODIGOS = Object.freeze([
  'SIN_CREDENCIALES', // faltan claves o el proveedor las rechazó (401)
  'LIMITE', // 429 persistente tras reintentos
  'NO_ENCONTRADO', // 404 o recurso inexistente
  'PROVEEDOR', // 4xx/5xx del proveedor o respuesta inválida
  'RED', // fallo de red o tiempo de espera agotado
  'VALIDACION', // parámetros inválidos detectados antes de llamar (extensión)
  'NO_PERMITIDO', // operación bloqueada por política, p. ej. trading live (extensión, ADR-005)
  'NO_IMPLEMENTADO', // adaptador pendiente (extensión, ADR-004)
  'CIRCUITO_ABIERTO', // el proveedor falló varias veces seguidas: se responde al instante sin red (resiliencia-proveedores)
]);

export class IntegrationError extends Error {
  constructor({ proveedor, status = null, codigo = 'PROVEEDOR', mensaje = 'Error de integración.', reintentoEnMs } = {}) {
    super(mensaje);
    this.name = 'IntegrationError';
    this.proveedor = proveedor;
    this.status = status;
    this.codigo = CODIGOS.includes(codigo) ? codigo : 'PROVEEDOR';
    this.mensaje = mensaje;
    if (reintentoEnMs != null) this.reintentoEnMs = reintentoEnMs; // CIRCUITO_ABIERTO: cuánto falta para la prueba
  }

  toJSON() {
    return { proveedor: this.proveedor, status: this.status, codigo: this.codigo, mensaje: this.mensaje };
  }
}

// Sustituye cualquier aparición de los secretos indicados y limita la longitud.
export const redactar = (texto, secretos = []) => {
  let salida = String(texto ?? '');
  for (const secreto of secretos) {
    if (typeof secreto === 'string' && secreto.length >= 4) salida = salida.split(secreto).join('[oculto]');
  }
  return salida.length > 500 ? `${salida.slice(0, 500)}…` : salida;
};

export const esIntegrationError = e => e instanceof IntegrationError;
