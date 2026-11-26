import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { generarServiceWorker } from './src/pwa/generar-sw.js';

const root = fileURLToPath(new URL('.', import.meta.url));

// PWA (openspec: aplicacion-web-pwa): emite dist/sw.js en cada `vite build` (en desarrollo no existe sw.js).
// enforce 'post': corre cuando index.html y /assets ya están en el bundle.
function serviceWorkerPwa() {
  const leer = archivo => readFileSync(new URL(archivo, import.meta.url), 'utf8');
  return {
    name: 'winopciones-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opciones, bundle) {
      const { codigo } = generarServiceWorker({
        plantilla: leer('./src/pwa/sw.plantilla.js'),
        reglas: leer('./src/pwa/reglas.js'),
        archivos: Object.keys(bundle),
        html: String(bundle['index.html']?.source ?? ''),
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: codigo });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  const target = env.VITE_API_TARGET || 'http://localhost:3020';
  const proxy = { target, changeOrigin: true };
  return {
    root,
    base: '/',
    plugins: [react(), serviceWorkerPwa()],
    server: { port: 5173, proxy: { '/api': proxy, '/health': proxy } },
    preview: { port: 4173, proxy: { '/api': proxy, '/health': proxy } },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  };
});
