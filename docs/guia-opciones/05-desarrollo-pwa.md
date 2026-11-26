# 5. Desarrollo de la PWA

> La interfaz web del proyecto: modelo de datos, páginas, integración con la API, implementación y pruebas.
> Código: `web/` (React 18 + Vite 5 + react-router 7 + lightweight-charts). Express la sirve compilada desde `web/dist`.

## 5.1 ¿Qué es una PWA?

Una *Progressive Web App* es una aplicación web que se puede **instalar** como app nativa y funciona aunque la red falle. Requisitos:

| Requisito | Para qué | Estado en el proyecto |
|---|---|---|
| HTTPS | Seguridad; obligatorio para el service worker | ✔ Render sirve con HTTPS |
| Diseño adaptable | Funciona en teléfono y escritorio | ✔ `styles.css` con diseño responsivo |
| SPA con rutas | Navegación sin recargar | ✔ react-router (`App.jsx`) |
| `manifest.webmanifest` | Nombre, íconos, colores, modo `standalone` | ✔ `web/public/manifest.webmanifest` + íconos en `web/public/icons/` |
| Service worker | Caché del *app shell* y modo sin conexión | ✔ `sw.js` generado en cada compilación (paso 5.5) |

La interfaz es una **SPA** instalable como PWA: en Chrome/Edge aparece «Instalar app» y en iPhone «Agregar a inicio».
El cambio se planeó y aplicó con OpenSpec (`openspec/changes/convertir-web-en-pwa/`, capacidad `aplicacion-web-pwa`).

## 5.2 Modelo de datos (lo que consume la interfaz)

Todas las entidades tienen `_id` (UUID), `createdAt`, `updatedAt` y pertenecen a un usuario. Se guardan igual en MongoDB y Supabase.

```
Empresa 1─* DatoMercado (vela | cotizacion | snapshot_opcion)
Empresa 1─* ContratoOpcion 1─* DatoMercado(snapshot_opcion: bid, ask, IV, griegas)
Empresa 1─* Fundamental · ReporteInstitucional · Noticia
Empresa 1─* Evaluacion (por core) *─1 Confluencia *─1 Seleccion
Estrategia 1─* Configuracion (componentes: contratoId, accion, cantidad)
Configuracion 1─* Orden (idempotencyKey, estado, eventos) ─ ConexionBroker ─ Broker
ConexionBroker 1─* Posicion
PerfilAnalisis (cores, parámetros, reglas) · Sincronizacion (trabajos) · Sesion · EventoAuditoria
```

| Entidad | Campos que muestra la interfaz |
|---|---|
| Empresa | símbolo, nombre, CIK, activo |
| DatoMercado | OHLCV, bid/ask, IV, griegas |
| Evaluacion | core, puntaje, sesgo, confianza, motivos, datosFaltantes |
| Confluencia / Seleccion | puntaje por estrategia, cobertura, ponderaciones efectivas |
| Orden | tipo, vigencia, precio, estado, eventos |
| Posicion | lado, cantidad, precio promedio, P/L |

## 5.3 Páginas

| Ruta | Página | Qué hace |
|---|---|---|
| `/login` | Login | Correo, contraseña y **base de datos** (MongoDB/Supabase) |
| `/` | Inicio | Mercado hoy (SPY, QQQ, DIA, IWM), estado del mercado, Top 5 por estrategia, cartera paper |
| `/analisis/:simbolo` | Análisis | Buscador, gráfica de velas con SMA, cadena de opciones con griegas, fundamentales, 13F, noticias, lectura de los 5 cores y **Operar** |
| `/posiciones` | Posiciones | Posiciones abiertas con P/L; cerrar una o el grupo |
| `/ordenes` | Órdenes | Historial y seguimiento en vivo |
| `/glosario` | Glosario | Términos de opciones e inversión |
| `/configuracion/*` | Configuración | Perfiles, estrategias, configuraciones, empresas, conexiones de broker, sincronizaciones, auditoría, evaluar cores, selección, mercado |

Componentes clave: `TicketOrden` (editar → revisar → enviado), `BotonOperar`, `CandleChart`, `PayoffChart`, `Gauge`,
`BrokerSelector`, `MercadoEstado`, `ResourceManager` + `SchemaForm` (CRUD genérico).

## 5.4 Integración con la API — paso a paso

1. **Una sola puerta:** `web/src/api/client.js → request()` agrega `Authorization: Bearer <token>` y convierte errores en `ApiError`.
2. **Sesión:** `AuthContext` guarda el token en `sessionStorage`; un 401 borra la sesión y emite `opciones:sesion-expirada`.
3. **Funciones por recurso:** `web/src/api/resources.js` (`mercado.panorama`, `acciones.sincronizar`, `operacion.ticket`, …).
4. **Trabajos largos (202):** `useJob` consulta el trabajo hasta `completada` o `fallida`.
5. **Tiempo real:** `useSeguimientoOrden` lee Server-Sent Events con `fetch` en streaming (el token va en la cabecera);
   `useSondeo` cotiza cada 5–10 s solo con el mercado abierto.
6. **Idempotencia:** el ticket genera un UUID al confirmar y lo reutiliza en «Reintentar envío».
7. **Desarrollo:** `npm run dev` (API) y `npm run dev:web` (Vite con proxy a `/api`).

```js
// Ejemplo: lanzar el análisis de un símbolo
const t = await request('/selecciones/ejecuciones', { method: 'POST',
  body: { modo: 'empresa', empresaId, coresSeleccionados: ['tecnico','indicadores','fundamental','institucional','noticias'] } });
// 202 → la página consulta GET /selecciones/:id con useJob hasta «completada»
```

## 5.5 Implementación — paso a paso

1. **Crear el proyecto:** `npm create vite@latest web -- --template react`; instalar `react-router-dom` y `lightweight-charts`.
2. **Rutas protegidas:** `RequireAuth` envuelve `Layout`; `/login` es pública.
3. **Contextos:** `AuthContext` (sesión) y `BrokerContext` (broker elegido: Alpaca o Webull).
4. **Páginas y componentes** de la tabla 5.3; utilidades puras en `web/src/utils` (`estrategiasOrden.js`, `velas.js`, `indicadores.js`).
5. **Compilar y servir:** `npm run build:all`; Express entrega `web/dist` con respaldo SPA (excepto `/api`, `/health`, `/assets`).
6. **Volverla PWA (hecho):**
   - **Manifest e íconos:** `web/public/manifest.webmanifest` (`name` WinOpciones, `start_url`/`scope` `/`, `display: standalone`,
     `theme_color #3550b8`) con íconos 192, 512 y 512 *maskable*, más `apple-touch-icon` de 180 para iOS. Los PNG salen del
     logotipo (`web/public/icons/icon.svg`) con `python scripts/generar-iconos-pwa.py` y se guardan en el repositorio.
     `web/index.html` enlaza el manifest, `theme-color` y el ícono de iOS.
   - **Reglas del service worker:** `web/src/pwa/reglas.js → decidirSolicitud()`, función pura que decide qué hacer con cada
     solicitud. **Nunca** intercepta `/api/`, `/health`, la documentación, el seguimiento en vivo (`text/event-stream`), otros
     orígenes ni métodos distintos de GET: esas van a la red como si no hubiera service worker.
   - **Service worker:** `web/src/pwa/sw.plantilla.js`. Al instalarse precarga la cáscara (`index.html` + `/assets/*` de esa
     compilación) en la caché `winopciones-<versión>`; `/assets` con hash se sirve **caché primero**; las páginas, **red
     primero** con el `index.html` guardado como respaldo sin conexión; al activarse borra las cachés de versiones anteriores.
   - **Generación en cada compilación:** el plugin de `web/vite.config.js` usa `web/src/pwa/generar-sw.js` para emitir
     `dist/sw.js` con la lista de precarga y una versión (hash de esa lista, del `index.html`, de las reglas y de la plantilla).
     Cada despliegue con cambios produce otro `sw.js` y el navegador detecta la actualización.
   - **Registro:** `web/src/pwa/registrar.js`, llamado desde `main.jsx` **solo en producción** y en contexto seguro (en
     `npm run dev:web` no hay service worker). Busca actualizaciones cada hora y al volver a la pestaña.
   - **Avisos:** `web/src/components/AvisosPwa.jsx` (en `Layout`) muestra «Hay una versión nueva · Recargar» —nunca recarga solo,
     para no perder un ticket a medio llenar— y «Sin conexión» mientras no hay red.
   - **Servidor:** `src/app.js` sirve `sw.js` con `Cache-Control: no-cache` (igual que `index.html`); Express ya entrega el
     manifest como `application/manifest+json`. La CSP (`default-src 'self'`) ya permitía ambos: no cambió.
   - **Revertir:** quitar el registro no basta (el service worker instalado sigue activo). Se publica un `sw.js` que en
     `activate` borra las cachés `winopciones-*`, llama a `self.registration.unregister()` y recarga las pestañas.
7. **Desplegar** en Render (`render.yaml`): build, `npm start`, health check `/health`.

## 5.6 Pruebas

| Tipo | Herramienta / archivo | Qué comprueba |
|---|---|---|
| Unitarias de utilidades | `tests/analisis-pagina.test.cjs`, `grafica-tecnica.test.cjs`, `graficas-busqueda.test.cjs`, `estrategias-orden.test.cjs` | Armado de patas, indicadores y gráficas |
| Integración HTTP | `tests/http.test.cjs`, `tests/acciones.test.cjs` | Flujo completo: sincronizar → cores → selección → configuración → orden |
| Estructura | `tests/estructura.test.cjs` | Rutas documentadas, capas respetadas |
| PWA | `tests/pwa.test.cjs` | Qué intercepta el service worker (nunca la API ni SSE), `sw.js` generado sin marcadores y con la precarga completa |
| Servidor PWA | `tests/plataforma.test.cjs` | `sw.js` sin caché y manifest con su tipo |
| Compilación | `npm --prefix web run build` | La página compila sin errores y genera `sw.js` |
| E2E en navegador | Playwright (`webapp-testing`) | Login, análisis y ticket con capturas |
| Humo real | `scripts/smoke-*.cjs` | Órdenes paper reales con el mercado abierto |
| CI | `.github/workflows/pruebas.yml` | `npm run verificar` en cada subida; Render publica solo si pasa |

**Paso a paso para verificar un cambio:** `npm run lint` → `npm test` → `npm --prefix web run build` (todo junto: `npm run verificar`).

## Resumen
La interfaz es una SPA en React que habla con la API por una sola puerta, maneja trabajos asíncronos y seguimiento en vivo, y
se prueba desde las utilidades hasta el flujo completo. Es instalable como PWA: carga sin red desde la caché, avisa de
versiones nuevas y nunca guarda datos de la API.
