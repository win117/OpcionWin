// Registro de métricas en memoria con exportación en el formato de texto de Prometheus 0.0.4
// (openspec: monitoreo-servicio «Métricas en formato Prometheus»). Puro: sin red, sin HTTP, sin dependencias.
export const CUBETAS_SEGUNDOS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const escapar = v => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const clave = etiquetas => JSON.stringify(Object.keys(etiquetas).sort().map(k => [k, String(etiquetas[k])]));
const formatear = etiquetas => {
  const pares = Object.keys(etiquetas).sort().map(k => `${k}="${escapar(etiquetas[k])}"`);
  return pares.length ? `{${pares.join(',')}}` : '';
};
const numero = n => (Number.isFinite(n) ? String(n) : n > 0 ? '+Inf' : n < 0 ? '-Inf' : 'NaN');

export function createRegistro() {
  const familias = new Map(); // nombre → { tipo, ayuda, series: Map(clave → { etiquetas, ... }), calcular? }

  const familia = (nombre, tipo, ayuda) => {
    if (!familias.has(nombre)) familias.set(nombre, { tipo, ayuda, series: new Map() });
    return familias.get(nombre);
  };

  return {
    contador(nombre, ayuda) {
      const f = familia(nombre, 'counter', ayuda);
      return { sumar(etiquetas = {}, n = 1) { const k = clave(etiquetas); const s = f.series.get(k) || { etiquetas, valor: 0 }; s.valor += n; f.series.set(k, s); } };
    },
    histograma(nombre, ayuda, cubetas = CUBETAS_SEGUNDOS) {
      const f = familia(nombre, 'histogram', ayuda);
      f.cubetas = cubetas;
      return {
        observar(etiquetas = {}, valor) {
          const k = clave(etiquetas);
          const s = f.series.get(k) || { etiquetas, cubetas: cubetas.map(() => 0), suma: 0, conteo: 0 };
          cubetas.forEach((limite, i) => { if (valor <= limite) s.cubetas[i] += 1; });
          s.suma += valor; s.conteo += 1;
          f.series.set(k, s);
        },
        cubetas,
      };
    },
    /** Valor calculado al exportar (memoria, circuitos, cola…): `calcular()` devuelve [{ etiquetas, valor }]. */
    calculado(nombre, ayuda, calcular) { familia(nombre, 'gauge', ayuda).calcular = calcular; },

    exportar() {
      const lineas = [];
      for (const [nombre, f] of familias) {
        lineas.push(`# HELP ${nombre} ${f.ayuda}`, `# TYPE ${nombre} ${f.tipo}`);
        if (f.calcular) {
          let valores = [];
          try { valores = f.calcular() || []; } catch { /* un valor calculado que falla no rompe la exportación */ }
          for (const { etiquetas = {}, valor } of valores) lineas.push(`${nombre}${formatear(etiquetas)} ${numero(valor)}`);
          continue;
        }
        for (const s of f.series.values()) {
          if (f.tipo === 'counter') { lineas.push(`${nombre}${formatear(s.etiquetas)} ${numero(s.valor)}`); continue; }
          f.cubetas.forEach((limite, i) => lineas.push(`${nombre}_bucket${formatear({ ...s.etiquetas, le: limite })} ${s.cubetas[i]}`));
          lineas.push(`${nombre}_bucket${formatear({ ...s.etiquetas, le: '+Inf' })} ${s.conteo}`);
          lineas.push(`${nombre}_sum${formatear(s.etiquetas)} ${numero(s.suma)}`, `${nombre}_count${formatear(s.etiquetas)} ${s.conteo}`);
        }
      }
      return lineas.join('\n') + '\n';
    },
  };
}
