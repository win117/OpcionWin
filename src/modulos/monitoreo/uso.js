// Analítica de uso para capacity planning (openspec: monitoreo-servicio «Analítica de uso»): solicitudes por endpoint
// (con p50/p95 de las últimas `maxMuestras`), por usuario seudonimizado y rechazos 429/503. En memoria y acotada.
const percentil = (ordenadas, p) => (ordenadas.length ? ordenadas[Math.min(ordenadas.length - 1, Math.ceil((p / 100) * ordenadas.length) - 1)] : null);

export function createUso({ maxUsuarios = 5000, maxEndpoints = 500, maxMuestras = 500, ahora = () => new Date() } = {}) {
  const desde = ahora().toISOString();
  const endpoints = new Map();
  const usuarios = new Map();

  const conTope = (mapa, max, k, crear) => {
    if (!mapa.has(k)) {
      if (mapa.size >= max) mapa.delete(mapa.keys().next().value); // descarta el más antiguo
      mapa.set(k, crear());
    }
    return mapa.get(k);
  };

  return {
    registrar({ metodo, ruta, codigo, ms, usuario }) {
      const e = conTope(endpoints, maxEndpoints, `${metodo} ${ruta}`, () => ({ solicitudes: 0, rechazos429: 0, rechazos503: 0, errores5xx: 0, muestras: [], i: 0 }));
      e.solicitudes += 1;
      if (codigo === 429) e.rechazos429 += 1;
      if (codigo === 503) e.rechazos503 += 1;
      if (codigo >= 500) e.errores5xx += 1;
      if (e.muestras.length < maxMuestras) e.muestras.push(ms); else { e.muestras[e.i] = ms; e.i = (e.i + 1) % maxMuestras; }
      if (usuario) conTope(usuarios, maxUsuarios, usuario, () => ({ solicitudes: 0 })).solicitudes += 1;
    },
    resumen({ limite = 50 } = {}) {
      const lista = [...endpoints].map(([endpoint, e]) => {
        const ordenadas = [...e.muestras].sort((a, b) => a - b);
        const redondear = v => (v == null ? null : Math.round(v * 10) / 10);
        return { endpoint, solicitudes: e.solicitudes, p50ms: redondear(percentil(ordenadas, 50)), p95ms: redondear(percentil(ordenadas, 95)),
          rechazos: { 429: e.rechazos429, 503: e.rechazos503 }, errores5xx: e.errores5xx };
      }).sort((a, b) => b.solicitudes - a.solicitudes);
      return {
        desde,
        totalSolicitudes: lista.reduce((n, e) => n + e.solicitudes, 0),
        endpoints: lista.slice(0, limite),
        usuarios: [...usuarios].map(([usuario, u]) => ({ usuario, solicitudes: u.solicitudes })).sort((a, b) => b.solicitudes - a.solicitudes).slice(0, limite),
        totalUsuarios: usuarios.size,
      };
    },
  };
}
