// Cola de trabajos en memoria (ADR-003). Una instancia por proceso.
import { AsyncLocalStorage } from 'node:async_hooks';
// Usuario de la solicitud en curso (lo establece authenticate); los trabajos internos no tienen usuario.
export const usuarioActual = new AsyncLocalStorage();
export function createCola({ concurrencia = 2, maxPorUsuario = 60 } = {}) {
  const espera = [];
  const activos = new Set();
  const porUsuario = new Map(); // en espera + en ejecución
  let corriendo = 0;
  const ociosos = [];
  const contar = (usuario, cambio) => {
    if (!usuario) return;
    const n = (porUsuario.get(usuario) || 0) + cambio;
    if (n > 0) porUsuario.set(usuario, n); else porUsuario.delete(usuario);
  };
  function siguiente() {
    while (corriendo < concurrencia && espera.length) {
      const { id, tarea, usuario } = espera.shift();
      corriendo++;
      activos.add(id);
      Promise.resolve().then(tarea).catch(() => {}).finally(() => {
        corriendo--; activos.delete(id); contar(usuario, -1);
        if (!corriendo && !espera.length) ociosos.splice(0).forEach(r => r());
        siguiente();
      });
    }
  }
  return {
    maxPorUsuario, // tope que aplica el middleware limiteOperaciones (429) antes de crear el registro
    encolar(id, tarea) {
      const usuario = usuarioActual.getStore();
      activos.add(id); contar(usuario, 1); espera.push({ id, tarea, usuario }); siguiente();
    },
    pendientes: usuario => porUsuario.get(usuario) || 0,
    activo: id => activos.has(id),
    // Para pruebas y apagado ordenado.
    vaciar: () => (!corriendo && !espera.length) ? Promise.resolve() : new Promise(r => ociosos.push(r)),
  };
}
export const colaGlobal = createCola();
