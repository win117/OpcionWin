# Tasks

## 0. Punto de partida

- [x] 0.1 Confirmar que `npm run verificar` pasa antes de tocar código (lint limpio, 287 pruebas, build de la web) y anotar el resultado

## 1. Manifest e iconos

- [x] 1.1 Exportar el logotipo actual (SVG en línea de `web/index.html`) a `web/public/icons/icon.svg` y verificar que se ve igual que el favicon
- [x] 1.2 Crear `scripts/generar-iconos-pwa.py` (Playwright con Edge, ya disponible) que genere `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (margen de seguridad del 20 %) y `apple-touch-icon.png` (180) en `web/public/icons/`; verificar dimensiones con el propio script y guardar los PNG en el repositorio
- [x] 1.3 Crear `web/public/manifest.webmanifest` (name WinOpciones, short_name, start_url y scope `/`, display standalone, lang es, theme_color y background_color `#3550b8`/fondo de la app, iconos 192/512/maskable) y verificar que es JSON válido
- [x] 1.4 Enlazar en `web/index.html` el manifest, `theme-color` y `apple-touch-icon`; verificar con `npm --prefix web run build` que `web/dist/` contiene `manifest.webmanifest` e `icons/`

## 2. Reglas del service worker (lógica pura)

- [x] 2.1 Crear `web/src/pwa/reglas.js` con la función que decide `null | 'cascara' | 'navegacion'` según URL, método, origen, cabecera Accept y modo de la solicitud
- [x] 2.2 Crear `tests/pwa.test.cjs` que verifique: `/api/*`, `/health`, `/api/v1/api-docs`, `text/event-stream`, POST/PUT/DELETE y otro origen → `null`; `/assets/x.js` → `cascara`; navegación a `/analisis/AAPL` → `navegacion`; y que pase con `npm test`

## 3. Service worker generado en la compilación

- [x] 3.1 Crear la plantilla `web/src/pwa/sw.plantilla.js`: precarga en `install` (caché `winopciones-<versión>`), borrado de cachés `winopciones-*` ajenas en `activate`, `fetch` con caché primero para cáscara y red primero con respaldo a `index.html` para navegación, y `skipWaiting` solo al recibir `{tipo:'activar'}`
- [x] 3.2 Agregar a `web/vite.config.js` el plugin (`generateBundle`) que incrusta `reglas.js`, la lista de precarga (`/` + `/index.html` + `/assets/*`) y la versión (hash de la lista) y emite `sw.js`; verificar que dos compilaciones con cambios producen versiones distintas y que sin cambios la versión se repite
- [x] 3.3 Extender `tests/pwa.test.cjs` para compilar (o leer `web/dist/sw.js` ya compilado) y comprobar que no quedan marcadores `__PRECACHE__`/`__VERSION__` y que la lista incluye `index.html` y todos los archivos de `web/dist/assets`

## 4. Backend: cabeceras de sw.js y manifest

- [x] 4.1 En `src/app.js`, en `setHeaders` de `express.static` de la raíz de `web/dist`, servir `sw.js` con `Cache-Control: no-cache`; sin tocar `/api/v1`, la CSP ni el respaldo SPA
- [x] 4.2 Extender la prueba «Archivos web» de `tests/plataforma.test.cjs`: `/sw.js` → 200, `no-cache`, tipo JavaScript y no es el `index.html`; `/manifest.webmanifest` → `application/manifest+json`; las aserciones existentes de `/assets`, `/`, `/robots.txt` siguen pasando

## 5. Registro y avisos en la web

- [x] 5.1 Crear `web/src/pwa/registrar.js` (solo si `serviceWorker` existe y hay contexto seguro): registra `/sw.js` con alcance `/`, detecta `registration.waiting`/`updatefound`, expone «activar» (postMessage + recarga única en `controllerchange` con bandera anti-bucle)
- [x] 5.2 Llamarlo desde `web/src/main.jsx` solo con `import.meta.env.PROD`, conservando el manejador `vite:preloadError`; verificar que con `npm run dev:web` no se registra ningún service worker (DevTools → Application)
- [x] 5.3 Crear `web/src/components/AvisosPwa.jsx` (aviso «Hay una versión nueva · Recargar» y aviso sin conexión con `online`/`offline`), montarlo en `Layout`, con estilos en `styles.css` coherentes con la app y legible en tema claro y oscuro; verificar que no se recarga solo
- [x] 5.4 Documentar en `docs/guia-opciones/05-*.md` (sección PWA) lo implementado: archivos, estrategia de caché, qué no se intercepta y cómo revertir; verificar que los nombres de archivo citados existen

## 6. Verificación integral

- [x] 6.1 `npm run build:all && npm start` y en Edge: manifest sin errores, service worker activo, opción «Instalar app» disponible; en Network, las llamadas a `/api/` no muestran «(ServiceWorker)»
- [x] 6.2 Modo sin conexión en DevTools: recargar `/analisis/AAPL` carga la cáscara y muestra el aviso; al reconectar el aviso desaparece
- [x] 6.3 Recompilar con un cambio visible y recargar: aparece «Hay una versión nueva», «Recargar» activa la versión nueva una sola vez y la caché anterior desaparece; la sesión sigue iniciada
- [x] 6.4 Ejecutar `npm run verificar` y que pase completo (lint + pruebas + build de la web)

## Workflow follow-up

- Revisar los cambios con el usuario y, con su autorización, hacer commit en `version-funcional` y desplegar en Render.
- Comprobar en la URL https de Render la instalación y el aviso de versión nueva.
- Archivar el cambio con `/openspec-archive-change` para que `aplicacion-web-pwa` pase a `openspec/specs/`.
