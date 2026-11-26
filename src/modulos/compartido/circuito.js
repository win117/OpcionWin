// Circuit breaker puro (openspec: resiliencia-proveedores). Sin temporizadores ni red: el tiempo entra por `ahora`.
//   cerrado     → las solicitudes pasan; `umbral` fallos de disponibilidad seguidos lo abren.
//   abierto     → toda solicitud falla al instante hasta que pasan `esperaMs`.
//   semiabierto → pasa UNA solicitud de prueba: si funciona se cierra; si falla se abre otra vez.
export function createCircuito({ umbral = 5, esperaMs = 30000, ahora = () => Date.now() } = {}) {
  let estado = 'cerrado';
  let fallosSeguidos = 0;
  let abiertoHasta = 0;
  let pruebaEnCurso = false;

  const actualizar = () => {
    if (estado === 'abierto' && ahora() >= abiertoHasta) { estado = 'semiabierto'; pruebaEnCurso = false; }
  };
  const abrir = () => { estado = 'abierto'; abiertoHasta = ahora() + esperaMs; pruebaEnCurso = false; };

  return {
    /** ¿Puede salir esta solicitud? Si no, `reintentoEnMs` dice cuánto falta para la prueba de recuperación. */
    permitir() {
      actualizar();
      if (estado === 'cerrado') return { permitido: true };
      if (estado === 'semiabierto' && !pruebaEnCurso) { pruebaEnCurso = true; return { permitido: true, prueba: true }; }
      return { permitido: false, reintentoEnMs: Math.max(estado === 'abierto' ? abiertoHasta - ahora() : 1000, 0) };
    },
    /** El proveedor respondió (aunque sea con 4xx): está disponible. */
    exito() { estado = 'cerrado'; fallosSeguidos = 0; pruebaEnCurso = false; },
    /** Fallo de disponibilidad (red, tiempo agotado o 5xx tras los reintentos). */
    fallo() {
      if (estado === 'semiabierto') { abrir(); return; }
      fallosSeguidos += 1;
      if (fallosSeguidos >= umbral) abrir();
    },
    estado() {
      actualizar();
      return estado === 'abierto'
        ? { estado, fallosSeguidos, reintentoEnSegundos: Math.ceil((abiertoHasta - ahora()) / 1000) }
        : { estado, fallosSeguidos };
    },
  };
}
