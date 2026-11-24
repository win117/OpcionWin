// Contador por clave en una ventana fija. Memoria acotada: al llegar a la capacidad se descarta la clave más antigua.
export function createLimitador({ max, ventanaMs, capacidad = 10000, ahora = Date.now }) {
  const cuentas = new Map(); // todas duran lo mismo, así que el orden de inserción es el de vencimiento
  return {
    // Suma un intento. Devuelve 0 si se permite, o los segundos que faltan para volver a intentar.
    sumar(clave) {
      const t = ahora();
      for (const [k, cuenta] of cuentas) { if (cuenta.hasta > t) break; cuentas.delete(k); }
      let cuenta = cuentas.get(clave);
      if (!cuenta) {
        if (cuentas.size >= capacidad) cuentas.delete(cuentas.keys().next().value);
        cuenta = { n: 0, hasta: t + ventanaMs };
        cuentas.set(clave, cuenta);
      }
      cuenta.n++;
      return cuenta.n > max ? Math.ceil((cuenta.hasta - t) / 1000) : 0;
    },
    olvidar(clave) { cuentas.delete(clave); },
  };
}
