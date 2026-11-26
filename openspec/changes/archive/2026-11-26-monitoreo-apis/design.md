# Design

## Context

- Ya existen `/health` (liveness), `/health/listo` (readiness con circuitos y cola), `requestId` en cada respuesta y
  `registrarError` (bitácora de 500 inesperados sin secretos). La bitácora de solicitudes es `morgan('dev')`, en texto.
- Un solo proceso (ADR-003) en Render, plan gratuito. Render recoge la salida estándar y la deja en su visor de logs.
- La estructura por dominio (`src/modulos/<dominio>/`, ADR-022) es la que se usa para código nuevo.
- Las pruebas de carga mostraron saturación del listado en ~300 usuarios concurrentes, así que conviene medir latencia
  por ruta en producción.

## Goals / Non-Goals

**Goals:**
- Cubrir con código propio, sin dependencias, los siete puntos de monitoreo del inciso C:
  - disponibilidad;
  - APM (latencia por ruta);
  - logs centralizables;
  - errores;
  - métricas con alertas;
  - sintético;
  - analítica de uso.
- Exponerlo en formatos estándar (Prometheus, JSON por línea, *envelopes* de Sentry) para conectar servicios gratuitos
  sin cambiar código.

**Non-Goals:**
- Trazas distribuidas.
- Persistencia de métricas.
- Tableros dentro de la app.

## Decisions

### 1. Módulo `src/modulos/monitoreo/` con un registro de métricas puro
- **Qué:**
  - `metricas.js`: contadores, histogramas y valores calculados (*gauges*), exportados en el formato de texto de
    Prometheus 0.0.4. Es puro y probado sin red.
  - `uso.js` (analítica) y `errores.js` (agrupador): estructuras en memoria acotadas, con un tope de claves para no
    crecer sin límite.
- **Por qué:**
  - `prom-client` sería la opción estándar, pero suma una dependencia para unas 80 líneas.
  - El formato de texto es simple y estable.
- **Alternativa:** OpenTelemetry. Es más completo, pero requiere un colector y varias dependencias.

### 2. Etiqueta `ruta` = patrón registrado
- **Qué:** al terminar la respuesta se usa `req.baseUrl + req.route.path` (p. ej. `/api/v1/empresas/:id`). Sin ruta
  coincidente: `sin_ruta`.
- **Por qué:** la URL real crearía una serie por cada id (explosión de cardinalidad) y filtraría ids.

### 3. Seudónimo de usuario
- **Qué:** `sha256(sal + usuarioId)` recortado a 10 caracteres. La sal es `MONITOREO_SAL` o se genera al arrancar.
- **Por qué:** es estable mientras dura el proceso, permite contar uso por usuario y no revela la identidad. Ni correos
  ni ids reales entran a métricas, logs ni analítica.

### 4. Protección por token de operación
- **Qué:**
  - `/metrics` y `/monitoreo/*` exigen `Bearer MONITOREO_TOKEN`, comparado en tiempo constante.
  - Sin token configurado responden 404, así que en producción no existen salvo que se activen.
- **Por qué no la sesión de usuario:** son datos de operación de todos los usuarios, no de uno, y Grafana Cloud los
  lee con un token fijo.
- Quedan fuera de `/api/v1` y de OpenAPI, como `/health`.

### 5. Instrumentación en un solo middleware
- **Qué:** montado justo después del `requestId`:
  1. toma el tiempo de inicio;
  2. pone `Server-Timing` antes de enviar las cabeceras (con `onHeaders` manual sobre `res.writeHead`);
  3. al `finish` registra la métrica, la analítica y, si `LOG_FORMATO=json`, la línea de log.
- **Captura de errores:** se engancha en el manejador de errores de `app.js`, junto a `registrarError`, para los 500
  inesperados.
- **SSE:** el seguimiento en vivo se mide al cerrar, y cuenta como una solicitud larga.

### 6. Sentry sin SDK
- **Qué:** con `SENTRY_DSN`, se envía un *envelope* (`POST https://<host>/api/<proyecto>/envelope/`, cabecera
  `X-Sentry-Auth`) con el evento.
- **Cómo:** en segundo plano, con un tope de 3 s y como máximo 1 evento por huella cada 60 s. Los errores al enviar se
  ignoran.
- **Alternativa:** `@sentry/node`. Más completo (trazas, *breadcrumbs*), pero pesado.

### 7. Monitoreo sintético en GitHub Actions
- **Qué:**
  - `monitoreo-sintetico.yml` con `schedule: */15 * * * *` y `workflow_dispatch`;
  - ejecuta `node scripts/smoke-despliegue.cjs "$URL"`, donde `URL` es la variable del repositorio `URL_PRODUCCION`;
  - sin la variable, se omite con un aviso.
- **Por qué:**
  - es gratis;
  - corre fuera de Render, así que detecta caídas totales;
  - GitHub notifica por correo cuando falla.

### 8. Servicios gratuitos conectables (los crea el equipo)
- **Grafana Cloud:** su integración *Metrics Endpoint* lee `/metrics` con el token cada minuto. Tablero: solicitudes
  por segundo, tasa de error 5xx, p95 por ruta, memoria, circuitos. Alertas: p95 > 500 ms (5 min), errores 5xx > 5 %
  (5 min), circuito abierto > 2 min, readiness ≠ 1.
- **UptimeRobot:** monitores HTTP a `/health` (cada 5 min) y de palabra clave `"listo"` en `/health/listo`.
- **Sentry:** proyecto Node y su DSN en `SENTRY_DSN` (variable de Render).

## Risks / Trade-offs

- **[Riesgo] Memoria si crecen las claves (rutas o usuarios).**
  Mitigación: las rutas son patrones (unas 200) y hay un tope de 5 000 usuarios y de 200 grupos de errores. Al llegar
  al tope se descarta el más antiguo.
- **[Riesgo] El token de monitoreo se filtra.**
  Solo da acceso a datos de operación sin datos personales; se rota cambiando la variable.
- **[Trade-off] Las métricas se reinician con cada despliegue.**
  Es normal en Prometheus: los contadores se tratan con `rate()`.
- **[Trade-off] El plan gratuito de Render duerme tras 15 min sin tráfico.**
  El monitor sintético cada 15 min lo mantiene despierto. Se documenta.

## Migration Plan

1. Desplegar sin `MONITOREO_TOKEN`: nada cambia salvo `Server-Timing` y la captura interna de errores.
2. Definir en Render `MONITOREO_TOKEN`, `LOG_FORMATO=json` y, si se creó la cuenta, `SENTRY_DSN`.
3. En GitHub: la variable `URL_PRODUCCION` activa el monitor sintético.
4. Conectar Grafana Cloud y UptimeRobot siguiendo la guía 08.
5. Reversa: quitar las variables. El módulo queda inactivo.
