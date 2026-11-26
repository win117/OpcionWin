import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import { registrarServiceWorker } from './pwa/registrar';
import './styles.css';

// PWA: solo en la compilación de producción; en `npm run dev:web` no hay service worker (no interfiere con Vite).
if (import.meta.env.PROD) registrarServiceWorker();

// Tras publicar una versión nueva, una pestaña vieja pide archivos que ya no existen: se recarga una vez.
window.addEventListener('vite:preloadError', () => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('opciones.recarga') || 0) < 30000) return;
    sessionStorage.setItem('opciones.recarga', String(Date.now()));
  } catch { return; }
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
