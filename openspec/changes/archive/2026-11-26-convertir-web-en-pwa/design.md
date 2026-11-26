# Design

## Context

Estado actual relevante (ver proposal.md para la motivación):

- **Web (capa `web`).**
  - Vite 5 + React 18 en `web/`, sin carpeta `web/public/`.
  - `index.html` trae el favicon como SVG en línea (`data:`) y el título «WinOpciones».
  - `main.jsx` ya recarga una vez ante `vite:preloadError`: una pestaña vieja pide chunks que ya no existen.
- **Sesión.**
  - El token vive en `sessionStorage` y viaja en la cabecera `Authorization`.
  - El seguimiento de órdenes es SSE leído con `fetch`.
- **Servidor (`src/app.js`, fuera de las capas de la API).**
  - `/assets` se sirve con caché de 1 año e inmutable.
  - Los demás archivos de `web/dist` se sirven con `express.static` y `maxAge: 1h`.
  - `.html` se sirve con `no-cache`.
  - El respaldo SPA entrega `index.html` a toda ruta que no sea `/api/`, `/health` ni `/assets/`.
- **Seguridad.**
  - La CSP (`cabeceras.handler.js`) es `default-src 'self'; script-src 'self'; connect-src 'self'`. Eso ya permite un
    manifest y un service worker del mismo origen (`worker-src` y `manifest-src` heredan de `script-src`/`default-src`).
  - Express 5 (`mime-types`) ya responde `.webmanifest` como `application/manifest+json`.
- **Despliegue.** Render ejecuta `npm run build:all`. Vite copia `web/public/` tal cual a `web/dist/`.

## Goals / Non-Goals

**Goals:**
- PWA instalable que pasa los criterios de Chrome/Edge (manifest + service worker con manejador `fetch`) y se ve bien
  en iOS.
- Cero riesgo para la API: el service worker es «transparente» para todo lo que no sea la cáscara estática.
- Actualizaciones predecibles en cada despliegue de Render, sin pestañas atrapadas en versiones viejas.
- Reversa posible en un solo despliegue.

**Non-Goals:**
- Workbox / `vite-plugin-pwa`.
- Caché de datos de la API.
- Push o sincronización en segundo plano.
- Cambios en la CSP, en las rutas de `/api/v1` o en la autenticación.

## Decisions

### 1. Service worker escrito a mano, sin `vite-plugin-pwa`
- **Elección:** un `sw.js` de unas 80 líneas.
- **Por qué:**
  - Las reglas que importan aquí (no tocar `/api/`, SSE ni otros métodos) quedan explícitas y se prueban como funciones
    puras.
  - No agrega dependencias a `web/package.json`.
  - Es fácil de explicar en la guía.
- **Alternativa:** `vite-plugin-pwa` (Workbox). Genera el precache solo, pero agrega varias dependencias y una
  configuración que oculta el comportamiento. Para una cáscara pequeña no compensa.

### 2. Lista de precarga y versión generadas en la compilación
- **Elección:** un plugin mínimo de Vite, dentro de `web/vite.config.js` (capa `web`), en el hook `generateBundle`:
  - lee la plantilla `web/src/pwa/sw.plantilla.js`;
  - reemplaza `__PRECACHE__` por la lista de archivos emitidos (`index.html` + `/assets/*`);
  - reemplaza `__VERSION__` por un hash corto de esa lista;
  - emite `sw.js` en la raíz de `dist/`.
- **Por qué:**
  - Cada despliegue produce un `sw.js` con bytes distintos, así que el navegador detecta la actualización.
  - El nombre de la caché (`winopciones-<versión>`) permite borrar las anteriores al activarse.
- **Alternativa:** un `sw.js` fijo en `public/` con caché en tiempo de ejecución. Su contenido no cambiaría entre
  despliegues (no se detectarían versiones) y la caché crecería sin control.

### 3. Lógica de decisión separada y probada
- **Elección:** las reglas «¿intercepto esta solicitud?» y «¿con qué estrategia?» van en `web/src/pwa/reglas.js`, como
  funciones puras (URL, método, cabecera `Accept` y modo → `null | 'cascara' | 'navegacion'`).
- **Cómo se usa:** el plugin las incrusta en el `sw.js` y una prueba nueva (`tests/pwa.test.cjs`) las importa
  directamente.
- **Por qué:** sigue el estilo del proyecto (cores puros y probados sin red) y blinda el requisito «la API nunca se
  intercepta».
- **Alternativa:** probar el service worker en un navegador con Playwright. Es más lento y frágil para la verificación
  de cada cambio, así que se deja como comprobación manual.

### 4. Estrategias de caché
- **`/assets/*`, caché primero:** los nombres llevan hash y nunca cambian de contenido.
- **Navegaciones, red primero:** el usuario siempre ve el `index.html` publicado. Si la red falla, se usa el
  `index.html` precargado.
- **Todo lo demás:** el service worker no llama a `respondWith`; el navegador lo maneja como si no existiera.
- **Alternativa descartada:** *stale-while-revalidate* para la navegación. Mostraría por un momento una versión vieja
  tras cada despliegue y competiría con el aviso de actualización.

### 5. Actualización controlada por el usuario
- **Comportamiento:**
  - El service worker nuevo queda en espera (sin `skipWaiting` automático).
  - La web detecta `registration.waiting` y muestra el aviso.
  - Al pulsar «Recargar» envía `{tipo: 'activar'}`; el service worker llama a `skipWaiting()`.
  - En `controllerchange` la página se recarga una sola vez, con una bandera para no entrar en un ciclo.
- **Por qué:** nunca se recarga a mitad de un ticket.
- **Relación con lo existente:** se conserva el manejador `vite:preloadError` como red de seguridad.
- **Alternativa:** `skipWaiting` + `clients.claim()` automáticos. Más simple, pero puede cambiar los chunks debajo de
  una pestaña abierta.

### 6. Iconos generados una vez y versionados
- **Origen:** el logotipo actual (el SVG en línea de `index.html`), exportado a `web/public/icons/icon.svg`.
- **PNG generados:** 192, 512, 512 *maskable* (con margen de seguridad del 20 %) y `apple-touch-icon` 180, creados una
  sola vez con un script de `scripts/` que usa el Edge/Playwright ya disponible en la máquina. Los PNG se guardan en el
  repositorio.
- **Por qué:** Render no necesita herramientas de imagen y la compilación no cambia.

### 7. Backend: solo la cabecera de `sw.js`
- **Dónde:** en `src/app.js`, en el `setHeaders` de `express.static` de la raíz de `web/dist`.
- **Qué:** `sw.js` → `Cache-Control: no-cache`, igual que `.html`.
- **Sin código nuevo:** el manifest ya sale con el tipo correcto y queda con `max-age=3600`, suficiente porque cambia
  poco y el navegador lo revalida.
- **Alcance:** no se toca ninguna capa de la API (routes, controllers, services, repositories).

### 8. Avisos en la interfaz
- **Qué:** un componente `AvisosPwa` en `web/src/components/` (capa `web`), montado en `Layout`, con dos estados:
  actualización disponible y sin conexión (`online`/`offline`).
- **Registro:** un módulo `web/src/pwa/registrar.js` que se llama desde `main.jsx` solo si `import.meta.env.PROD`.

### Estructura
La estructura actual es adecuada para este cambio: todo vive en la capa `web` más una línea del servidor estático. La
única adición es la carpeta `web/src/pwa/` (registro, reglas y plantilla del service worker), que agrupa la PWA en vez
de dispersarla entre `utils/` y `main.jsx`.

## Risks / Trade-offs

- **[Riesgo] Un service worker defectuoso queda instalado en los navegadores aunque se corrija el código.**
  Mitigación: el service worker nunca intercepta la API. Además hay un plan de reversa con un `sw.js` que se
  desinstala solo (ver Migration Plan).
- **[Riesgo] `sw.js` cacheado por el CDN o el navegador retrasa las actualizaciones.**
  Mitigación: `Cache-Control: no-cache` en `sw.js`, más la revalidación propia del navegador (máximo 24 h).
- **[Riesgo] La precarga descarga todos los chunks en la primera visita (más datos en móvil).**
  Mitigación: es una descarga única y en segundo plano tras cargar la página; el tamaño actual de `dist/assets` es
  moderado.
- **[Riesgo] El `index.html` precargado apunta a chunks de su misma versión.**
  Mitigación: precargar `index.html` y `/assets` juntos, en la misma caché versionada, garantiza la coherencia sin
  conexión.
- **[Trade-off] Sin conexión solo se ve la cáscara: no hay datos ni operación.**
  Es intencional, porque los precios viejos inducirían a error y las órdenes deben ser en vivo.
- **[Trade-off] El aviso de actualización depende de que el usuario lo pulse.**
  Si no lo pulsa, la versión nueva entra al cerrar todas las pestañas.

## Migration Plan

**Despliegue:**
1. Verificar localmente:
   - `npm run verificar`;
   - `npm run build:all && npm start`;
   - en Edge: DevTools → Application (manifest válido, service worker activo, la API sin pasar por el service worker);
   - la opción «Instalar app» del navegador.
2. Hacer commit en `version-funcional` (con autorización) y desplegar en Render como siempre. No hay cambios en
   `render.yaml`.
3. Comprobar en la URL de Render (https):
   - que la app se pueda instalar;
   - que el aviso aparezca al desplegar otra vez.

**Reversa** (si algo sale mal en producción):
1. Reemplazar la plantilla por un `sw.js` de baja que en `activate`:
   - borra las cachés `winopciones-*`;
   - llama a `self.registration.unregister()`;
   - recarga a los clientes.
2. Quitar el registro de `main.jsx`.
3. Desplegar. Los navegadores con la versión anterior descargan el `sw.js` de baja (porque se sirve sin caché) y
   quedan limpios.

Quitar solo el registro no basta, porque el service worker ya instalado seguiría activo.
