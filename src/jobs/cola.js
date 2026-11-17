// Cola de trabajos en memoria (ADR-003). Una instancia por proceso.
export function createCola({ concurrencia = 2 } = {}) {
  const espera = [];
  const activos = new Set();
  let corriendo = 0;
  const ociosos = [];
  function siguiente() {
    while (corriendo < concurrencia && espera.length) {
      const { id, tarea } = espera.shift();
      corriendo++;
      activos.add(id);
      Promise.resolve().then(tarea).catch(() => {}).finally(() => {
        corriendo--; activos.delete(id);
        if (!corriendo && !espera.length) ociosos.splice(0).forEach(r => r());
        siguiente();
      });
    }
  }
  return {
    encolar(id, tarea) { activos.add(id); espera.push({ id, tarea }); siguiente(); },
    activo: id => activos.has(id),
    // Para pruebas y apagado ordenado.
    vaciar: () => (!corriendo && !espera.length) ? Promise.resolve() : new Promise(r => ociosos.push(r)),
  };
}
export const colaGlobal = createCola();
