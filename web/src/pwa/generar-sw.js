// Solo en compilación (lo usa el plugin de web/vite.config.js; tests/pwa.test.cjs lo prueba). No entra al bundle de la app.
// Convierte sw.plantilla.js en el sw.js final: incrusta reglas.js, la lista de precarga y la versión.
import { createHash } from 'node:crypto';

/**
 * @param {{ plantilla: string, reglas: string, archivos: string[], html?: string }} entrada
 *   archivos: nombres emitidos por Vite (p. ej. 'assets/index-abc.js'); html: contenido de index.html
 * @returns {{ codigo: string, version: string, precache: string[] }}
 */
export function generarServiceWorker({ plantilla, reglas, archivos, html = '' }) {
  const reglasSinExport = reglas.replace(/^export /gm, '');
  const precache = ['/', '/index.html', ...archivos.filter(f => f.startsWith('assets/')).sort().map(f => '/' + f)];
  const version = createHash('sha256').update([precache.join('\n'), html, reglasSinExport, plantilla].join('\0')).digest('hex').slice(0, 12);
  // Reemplazos anclados a sus líneas de código; si alguno no aparece se lanza un error en vez de emitir un sw.js roto.
  const reemplazos = [
    [/^\/\* global [^\n]*\*\/\n/m, () => ''],
    [/^\/\/ __REGLAS__$/m, () => reglasSinExport],
    [/^const CACHE = PREFIJO \+ __VERSION__;$/m, () => `const CACHE = PREFIJO + ${JSON.stringify(version)};`],
    [/^const PRECACHE = __PRECACHE__;$/m, () => `const PRECACHE = ${JSON.stringify(precache)};`],
  ];
  let codigo = plantilla;
  for (const [patron, valor] of reemplazos) {
    if (!patron.test(codigo)) throw new Error('sw.plantilla.js: no se encontró ' + patron);
    codigo = codigo.replace(patron, valor);
  }
  if (/__(VERSION|PRECACHE|REGLAS)__/.test(codigo)) throw new Error('sw.js quedó con marcadores sin reemplazar');
  return { codigo, version, precache };
}
