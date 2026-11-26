# Proposal

## Why

La guía (punto 5 del inciso A) presenta la PWA como la forma de llevar la app al teléfono y al escritorio, pero la web
de `web/` aún no lo es: no tiene manifest, iconos ni service worker, así que no se puede instalar y se ve en blanco sin
red. Convertirla ahora cierra esa brecha entre lo documentado y lo implementado. Es un cambio aislado del backend y
sirve como primer cambio guiado con OpenSpec.

## What Changes

- Agregar un **manifest web** (`manifest.webmanifest`) con nombre «WinOpciones», colores, `display: standalone`,
  `start_url` y `scope` en `/`, más iconos PNG de 192 y 512 px (incluido uno *maskable*) y un `apple-touch-icon`.
  Todo se genera a partir del logotipo actual.
- Agregar un **service worker** propio (`sw.js`, sin dependencias nuevas). Precarga la cáscara de la app (el
  `index.html` y los archivos con hash de `/assets/` de esa compilación), responde las navegaciones con red primero y
  la cáscara como respaldo sin conexión, y **nunca intercepta** `/api/`, `/health`, la documentación ni el seguimiento
  en vivo (SSE).
- Registrar el service worker **solo en producción** y solo en contexto seguro (https o localhost). En
  `npm run dev:web` no se registra, para no interferir con la recarga en caliente de Vite.
- Mostrar un **aviso de versión nueva** («Hay una versión nueva · Recargar») cuando se publica otra versión, y un
  **aviso sin conexión** mientras el navegador está desconectado.
- **Backend (mínimo):** servir `sw.js` con `Cache-Control: no-cache` y el manifest con su tipo
  `application/manifest+json`. No cambia ninguna ruta de `/api/v1`, ni la CSP ni la autenticación.
- Sin cambios que rompan compatibilidad (no hay **BREAKING**).

Fuera del alcance:
- Notificaciones push.
- Sincronización en segundo plano.
- Guardar respuestas de la API para usarlas sin conexión: los datos de mercado y las órdenes deben ser siempre frescos,
  y la API está autenticada.
- Operar o ver datos sin conexión. Sin red solo se ve la cáscara con el aviso.

## Capabilities

### New Capabilities
- `aplicacion-web-pwa`: instalación de la web como PWA (manifest e iconos), ciclo de vida del service worker
  (precarga, actualización y limpieza de versiones), qué solicitudes intercepta y cuáles no, y el comportamiento sin
  conexión.

### Modified Capabilities
- `plataforma-seguridad`: el requisito «Compresión y caché» suma las reglas de caché del service worker y del manifest
  (`sw.js` sin caché y el manifest con su tipo MIME), sin cambiar las de `/assets` e `index.html`.

## Impact

- **Frontend (`web/`):**
  - nuevos `web/public/manifest.webmanifest`, `web/public/icons/*` y la plantilla del service worker;
  - un pequeño plugin en `web/vite.config.js` que genera `sw.js` con la lista de precarga y la versión de cada
    compilación;
  - `web/index.html` (enlaces al manifest, `theme-color` y `apple-touch-icon`);
  - `web/src/main.jsx` (registro);
  - un componente de avisos dentro de `Layout`.
- **Backend:** `src/app.js`, en la configuración de `express.static` para la raíz de `web/dist` (cabeceras de `sw.js` y
  del manifest).
- **Pruebas:**
  - `tests/plataforma.test.cjs` (cabeceras de `sw.js` y del manifest);
  - una prueba nueva para la lógica pura del service worker (qué intercepta y qué no).
- **Dependencias:** ninguna nueva (los iconos PNG se generan una sola vez y se guardan en el repositorio).
- **Despliegue (Render):** sin cambios en `render.yaml`. `npm run build:all` ya copia `web/public` a `web/dist`.
- **Riesgo principal:** un service worker defectuoso persiste en los navegadores. El diseño incluye un plan de
  reversa: publicar un `sw.js` que se desregistra y borra sus cachés.
