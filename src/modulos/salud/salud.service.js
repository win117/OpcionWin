// Readiness del servicio (openspec: salud-servicio). Sin HTTP: recibe las comprobaciones de cada base ya construidas.
//   - Cada base: 'ok' | 'caido' | 'sin_configurar', con un tope de 2 s por comprobación.
//   - El resultado de las bases se reutiliza `cacheMs` (10 s) y nunca hay dos comprobaciones en vuelo a la vez.
//   - Un circuito de proveedor abierto marca `degradado` pero no vuelve 503: lo demás sigue atendiendo.
//   - Durante el drenado (cola que ya no acepta) responde no listo con motivo 'apagando'.
const TOPE_MS = 2000;

const conTope = (promesa, ms) => {
  let temporizador;
  const vencido = new Promise((_, rechazar) => { temporizador = setTimeout(() => rechazar(new Error('tiempo agotado')), ms); });
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(temporizador));
};

export function createSalud({ comprobaciones = {}, integraciones, cola, cacheMs = 10000, topeMs = TOPE_MS, ahora = () => Date.now() } = {}) {
  let cache = null; // { valor, hasta }
  let enVuelo = null;

  const comprobarBases = () => {
    if (cache && ahora() < cache.hasta) return Promise.resolve(cache.valor);
    if (enVuelo) return enVuelo;
    enVuelo = (async () => {
      const valor = {};
      await Promise.all(Object.entries(comprobaciones).map(async ([nombre, comprobar]) => {
        if (typeof comprobar !== 'function') { valor[nombre] = { estado: 'sin_configurar' }; return; }
        const inicio = ahora();
        try { await conTope(Promise.resolve().then(comprobar), topeMs); valor[nombre] = { estado: 'ok', ms: ahora() - inicio }; }
        catch { valor[nombre] = { estado: 'caido', ms: ahora() - inicio }; } // sin el mensaje: podría traer la dirección
      }));
      cache = { valor, hasta: ahora() + cacheMs };
      return valor;
    })().finally(() => { enVuelo = null; });
    return enVuelo;
  };

  const proveedores = () => Object.fromEntries(Object.entries(integraciones?.estado?.() || {}).map(([nombre, p]) => [nombre, {
    configurado: Boolean(p.configurado),
    circuito: p.circuito?.estado || 'cerrado',
    ...(p.circuito?.reintentoEnSegundos != null ? { reintentoEnSegundos: p.circuito.reintentoEnSegundos } : {}),
  }]));

  return {
    async estado() {
      const aceptando = cola?.aceptando ? cola.aceptando() : true;
      const dependencias = await comprobarBases();
      const prov = proveedores();
      const degradado = Object.values(prov).some(p => p.circuito !== 'cerrado');
      const motivo = !aceptando ? 'apagando'
        : !Object.values(dependencias).some(d => d.estado === 'ok') ? 'sin_base_de_datos' : null;
      return {
        listo: !motivo,
        cuerpo: {
          estado: motivo ? 'no_listo' : 'listo', ...(motivo ? { motivo } : {}), degradado,
          dependencias, proveedores: prov,
          cola: { aceptando, enCurso: cola?.enCurso ? cola.enCurso() : null },
          verificadoEn: new Date(ahora()).toISOString(),
        },
      };
    },
  };
}
