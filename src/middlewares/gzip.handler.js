// Compresión gzip sin dependencias: respuestas JSON/texto de más de 1 KB y archivos de web/dist/assets.
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const gzipAsync = promisify(gzip);
const TEXTO = /^(application\/(json|javascript)|text\/|image\/svg\+xml)/;
const MINIMO = 1024;
export function comprimir(req, res, next) {
  const enviar = res.send;
  res.send = function (cuerpo) {
    const comprimible = (typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo)) && cuerpo.length > MINIMO
      && !res.get('Content-Encoding') && TEXTO.test(res.get('Content-Type') || '');
    if (!comprimible) return enviar.call(res, cuerpo);
    res.vary('Accept-Encoding');
    if (!req.acceptsEncodings('gzip')) return enviar.call(res, cuerpo);
    gzip(cuerpo, (error, comprimido) => {
      if (res.headersSent || res.destroyed) return;
      if (!error) res.set('Content-Encoding', 'gzip');
      enviar.call(res, error ? cuerpo : comprimido);
    });
    return res;
  };
  next();
}
// Los assets llevan hash en el nombre: se comprimen una vez y quedan en memoria. Solo nombres que existían al arrancar.
export function assetsComprimidos(carpeta) {
  const nombres = new Set(existsSync(carpeta) ? readdirSync(carpeta).filter(n => /\.(js|css|svg)$/.test(n)) : []);
  const cache = new Map();
  return async (req, res, next) => {
    const nombre = req.path.slice(1);
    if (!['GET', 'HEAD'].includes(req.method) || !nombres.has(nombre)) return next();
    res.vary('Accept-Encoding');
    if (req.get('Range') || !req.acceptsEncodings('gzip')) return next();
    try {
      if (!cache.has(nombre)) cache.set(nombre, readFile(path.join(carpeta, nombre)).then(b => gzipAsync(b)));
      const cuerpo = await cache.get(nombre);
      res.type(path.extname(nombre)).set({ 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(cuerpo);
    } catch { cache.delete(nombre); next(); }
  };
}
