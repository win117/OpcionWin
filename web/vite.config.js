import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  const target = env.VITE_API_TARGET || 'http://localhost:3020';
  const proxy = { target, changeOrigin: true };
  return {
    root,
    base: '/',
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': proxy, '/health': proxy } },
    preview: { port: 4173, proxy: { '/api': proxy, '/health': proxy } },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  };
});
