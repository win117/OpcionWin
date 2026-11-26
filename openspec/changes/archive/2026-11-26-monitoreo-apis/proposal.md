# Proposal

## Why

El inciso C pide monitorear las APIs: disponibilidad, rendimiento (latencia y cuellos de botella), registro centralizado,
captura de errores, métricas con alertas, monitoreo sintético y analítica de uso. Hoy solo existen `/health`,
`/health/listo` y la bitácora `morgan` en texto libre. No hay métricas, ni errores agrupados, ni datos de quién usa qué
endpoint, ni nada que avise cuando la app publicada en Render falla.

## What Changes

- **Métricas Prometheus en `GET /metrics`.**
  - Por solicitud: total por método, ruta (el patrón, no la URL real) y código, y un histograma de duración.
  - Del proceso: memoria, CPU, retraso del event loop y tiempo encendido.
  - De la app: estado de los circuitos por proveedor, trabajos en la cola, rechazos por límite y errores capturados.
  - Protegido con `MONITOREO_TOKEN`; sin el token, el endpoint no existe (404).
- **Logs estructurados (JSON por línea)** de cada solicitud: fecha, `requestId`, método, ruta, código, duración y usuario
  seudonimizado. Se activan con `LOG_FORMATO=json` (Render recoge la salida estándar). En desarrollo sigue `morgan`.
- **Seguimiento de errores propio.**
  - Los errores 500 inesperados se agrupan por huella (tipo + mensaje normalizado + ruta), con conteo, primera y última
    vez y un `requestId` de ejemplo.
  - `GET /monitoreo/errores` los muestra, protegido con el mismo token.
  - Si existe `SENTRY_DSN`, además se envían a Sentry por su API HTTP, sin SDK.
- **Analítica de uso para capacity planning.** `GET /monitoreo/uso`: solicitudes por endpoint y por usuario
  seudonimizado, latencia p50/p95 por endpoint y rechazos 429/503, desde que arrancó el proceso.
- **Cabecera `Server-Timing`** con la duración de cada respuesta, para ver la latencia desde el navegador.
- **Monitoreo sintético en GitHub Actions.** Un flujo programado cada 15 minutos ejecuta el smoke post-despliegue contra
  la URL de Render (variable del repositorio). Si falla, GitHub avisa por correo.
- **Guía de conexión** a servicios gratuitos que crea el equipo:
  - Grafana Cloud: lee `/metrics`, tableros y alertas por umbral;
  - UptimeRobot: `/health` y `/health/listo`;
  - Sentry: errores.
- Sin **BREAKING**. `/api/v1` no cambia, y ningún dato personal ni secreto sale en métricas, logs o analítica.

Fuera del alcance:
- Trazas distribuidas (OpenTelemetry).
- Persistir métricas o analítica en la base (viven en memoria del proceso, como Prometheus espera).
- Crear las cuentas externas (las crea el equipo).

## Capabilities

### New Capabilities
- `monitoreo-servicio`: métricas, logs estructurados, seguimiento de errores, analítica de uso, `Server-Timing` y
  monitoreo sintético, con su protección y privacidad.

### Modified Capabilities
- `plataforma-seguridad`: requisito nuevo: los endpoints de operación (`/metrics`, `/monitoreo/*`) exigen un token
  propio y nunca exponen secretos ni datos personales.

## Impact

- **Módulo nuevo `src/modulos/monitoreo/`** (estructura por dominio, ADR-022):
  - registro de métricas puro;
  - middleware de instrumentación;
  - agrupador de errores;
  - analítica;
  - envío a Sentry;
  - rutas, controlador y servicio.
- **`src/app.js`:** monta el módulo al inicio (después del `requestId`) y engancha la captura de errores donde hoy se
  llama `registrarError`.
- **`src/middlewares/limites.handler.js`:** sin cambios. Los rechazos se cuentan por el código de la respuesta.
- **Nuevo:** `.github/workflows/monitoreo-sintetico.yml`.
- **`.env.example`:** `MONITOREO_TOKEN`, `LOG_FORMATO`, `SENTRY_DSN`.
- **Pruebas:** `tests/monitoreo.test.cjs`.
- **Documentación:** `docs/guia-opciones/08-pruebas-y-monitoreo.md`.
- **Dependencias:** ninguna nueva.
