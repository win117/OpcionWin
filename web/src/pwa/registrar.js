// Registro del service worker (openspec: aplicacion-web-pwa). main.jsx lo llama solo en producción.
// Expone el estado «hay una versión nueva» a la interfaz (AvisosPwa) y la acción para activarla.

const CADA_HORA_MS = 60 * 60 * 1000;
let registro = null;
let versionNueva = false;
let activacionPedida = false;
const oyentes = new Set();

function avisar(valor) {
  versionNueva = valor;
  for (const fn of oyentes) fn(versionNueva);
}

/** Suscribe a «hay una versión nueva en espera». Devuelve la función para cancelar la suscripción. */
export function suscribirVersionNueva(fn) {
  oyentes.add(fn);
  fn(versionNueva);
  return () => oyentes.delete(fn);
}

/** Activa la versión en espera; la página se recarga una sola vez cuando el nuevo service worker toma el control. */
export function activarVersionNueva() {
  const enEspera = registro?.waiting;
  if (!enEspera) return;
  activacionPedida = true;
  enEspera.postMessage({ tipo: 'activar' });
}

/** Registra /sw.js si el navegador lo soporta en un contexto seguro (https o localhost). Devuelve si lo intentó. */
export function registrarServiceWorker({ nav = navigator, win = window } = {}) {
  if (!('serviceWorker' in nav) || !win.isSecureContext) return false;
  const sw = nav.serviceWorker;

  // Solo se recarga si el usuario pulsó «Recargar»; la toma de control de la primera instalación no recarga.
  let recargado = false;
  sw.addEventListener('controllerchange', () => {
    if (!activacionPedida || recargado) return;
    recargado = true;
    win.location.reload();
  });

  const vigilar = reg => {
    registro = reg;
    // «Versión nueva» solo si ya había un service worker controlando la página (no en la primera instalación).
    if (reg.waiting && sw.controller) avisar(true);
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && sw.controller) avisar(true);
      });
    });
    // Una SPA casi no navega: se busca actualización cada hora y al volver a la pestaña.
    win.setInterval(() => reg.update().catch(() => {}), CADA_HORA_MS);
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  };

  const registrar = () => sw.register('/sw.js', { scope: '/' }).then(vigilar).catch(() => { /* sin PWA, la app sigue igual */ });
  if (win.document.readyState === 'complete') registrar();
  else win.addEventListener('load', registrar, { once: true });
  return true;
}
