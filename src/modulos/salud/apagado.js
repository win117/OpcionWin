// Apagado ordenado con drenado (openspec: salud-servicio «Drenado al apagar»).
// 1) la cola deja de aceptar trabajos (503) y /health/listo pasa a 'apagando';
// 2) se espera hasta `drenadoMs` (8 s) a que terminen los trabajos en curso;
// 3) se cierra el servidor y la base. Un tope global (`topeMs`, 10 s) fuerza la salida si algo se cuelga.
// Devuelve el código de salida; quien lo llama decide qué hacer con él (index.js lo pone en process.exitCode).
export function crearApagado({ server, cola, alApagar = [], cerrarBase = async () => {}, drenadoMs = 8000, topeMs = 10000,
  salir = codigo => process.exit(codigo), avisar = () => {} }) {
  let enCurso = null;
  return function apagar() {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      cola?.drenar?.();
      for (const fn of alApagar) { try { fn(); } catch { /* un fallo al detener algo no impide cerrar */ } }
      const tope = setTimeout(() => salir(1), topeMs); tope.unref?.();
      let espera;
      const vencio = await Promise.race([
        Promise.resolve(cola?.vaciar?.()).then(() => false),
        // Sin unref: esta espera debe mantener vivo el proceso (se cancela en cuanto los trabajos terminan). Solo el tope de
        // seguridad lleva unref, para no retrasar una salida que ya ocurrió por otra vía.
        new Promise(resolver => { espera = setTimeout(() => resolver(true), drenadoMs); }),
      ]);
      clearTimeout(espera);
      if (vencio) avisar(`Apagado: pasaron ${drenadoMs / 1000} s y quedan trabajos en curso; se marcarán como fallidos al consultarse.`);
      await new Promise(resolver => server.close(() => resolver()));
      try { await cerrarBase(); clearTimeout(tope); return 0; } catch { return 1; }
    })();
    return enCurso;
  };
}
