# Spec Delta

## Purpose

Saber en todo momento si las APIs están disponibles, qué tan rápido responden, qué falla y quién las usa, con datos que
pueda leer un sistema de monitoreo externo (Prometheus/Grafana, UptimeRobot, Sentry) sin exponer secretos ni datos
personales.

## ADDED Requirements

### Requirement: Métricas en formato Prometheus
`GET /metrics` SHALL responder en el formato de texto de Prometheus con: `http_solicitudes_total` (por método, ruta,
código), el histograma `http_duracion_segundos` (por método y ruta), métricas del proceso, el estado de cada circuito
de proveedor y los trabajos en la cola. La etiqueta `ruta` MUST ser el patrón registrado (p. ej. `/api/v1/empresas/:id`)
y no la URL real.

#### Scenario: Métricas tras varias solicitudes
- **WHEN** se hacen 3 `GET /api/v1/empresas/<id>` con ids distintos y se pide `/metrics` con el token
- **THEN** `http_solicitudes_total{metodo="GET",ruta="/api/v1/empresas/:id",codigo="200"}` vale 3
- **AND** no aparece ningún id real como etiqueta

#### Scenario: Circuito abierto visible en métricas
- **WHEN** el circuito de Alpaca está abierto
- **THEN** `circuito_abierto{proveedor="alpaca"}` vale 1

### Requirement: Logs estructurados por solicitud
Con `LOG_FORMATO=json`, cada solicitud SHALL producir una línea JSON con `ts`, `nivel`, `requestId`, `metodo`, `ruta`,
`codigo`, `ms` y `usuario` (seudónimo). MUST NOT incluir cuerpos, cabeceras, consulta, tokens ni el id real del usuario.

#### Scenario: Línea de log de una solicitud autenticada
- **WHEN** un usuario autenticado hace `GET /api/v1/empresas?search=x`
- **THEN** la línea JSON trae su `requestId`, `ruta: "/api/v1/empresas"`, código y duración
- **AND** no contiene el token, la consulta `search=x` ni el id del usuario

### Requirement: Errores agrupados
Los errores 500 inesperados SHALL agruparse por huella (tipo + mensaje sin números ni ids + ruta) con conteo, primera y
última vez y un `requestId` de ejemplo, consultables en `GET /monitoreo/errores`. Los mensajes MUST pasar por el mismo
ocultamiento de secretos que la bitácora.

#### Scenario: El mismo error tres veces
- **WHEN** la misma falla ocurre 3 veces en la misma ruta con ids distintos en el mensaje
- **THEN** `/monitoreo/errores` muestra un solo grupo con `conteo: 3`

### Requirement: Envío opcional a Sentry
Si `SENTRY_DSN` está definido, cada error capturado SHALL enviarse a Sentry por su API HTTP de *envelopes*, sin
bloquear la respuesta. Un fallo al enviar MUST NOT afectar a la solicitud ni lanzar errores.

#### Scenario: Sentry caído
- **WHEN** Sentry no responde al enviar un error
- **THEN** el cliente recibe su 500 normal y el error queda igual en `/monitoreo/errores`

### Requirement: Analítica de uso
`GET /monitoreo/uso` SHALL devolver, desde el arranque del proceso, las solicitudes por endpoint (con p50 y p95 de
latencia), por usuario seudonimizado y los rechazos 429/503 por endpoint, ordenados de mayor a menor.

#### Scenario: Endpoint más usado
- **WHEN** se hacen 5 solicitudes a `/api/v1/empresas` y 2 a `/api/v1/estrategias`
- **THEN** `/monitoreo/uso` lista primero `/api/v1/empresas` con 5

### Requirement: Endpoints de operación protegidos
`/metrics` y `/monitoreo/*` SHALL exigir `Authorization: Bearer <MONITOREO_TOKEN>`. Si `MONITOREO_TOKEN` no está
configurado MUST responder 404, como si no existieran. Un token incorrecto MUST responder 401.

#### Scenario: Sin token configurado
- **WHEN** el servidor arranca sin `MONITOREO_TOKEN` y se pide `/metrics`
- **THEN** responde 404

#### Scenario: Token incorrecto
- **WHEN** se pide `/monitoreo/uso` con un token distinto
- **THEN** responde 401

### Requirement: Latencia visible en cada respuesta
Toda respuesta SHALL incluir la cabecera `Server-Timing: app;dur=<ms>` con la duración medida por el servidor.

#### Scenario: Cabecera presente
- **WHEN** se pide `GET /health`
- **THEN** la respuesta trae `Server-Timing` con `app;dur=`

### Requirement: Monitoreo sintético
Un flujo programado SHALL ejecutar el smoke post-despliegue contra la URL publicada al menos cada 15 minutos y fallar
(lo que dispara el aviso de GitHub) si alguna comprobación esencial falla. Sin URL configurada MUST omitirse sin fallar.

#### Scenario: Render caído
- **WHEN** la URL publicada no responde `/health` durante una ejecución programada
- **THEN** el flujo termina en falla y queda registrado en GitHub Actions
