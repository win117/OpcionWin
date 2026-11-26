# Proposal

## Why

El inciso B pide aplicar técnicas de desarrollo y optimización de microservicios a todas las APIs usando un framework SDD,
y mostrar en qué se distingue lo hecho con IA de lo hecho manualmente. Las APIs actuales se construyeron sin SDD y ya
cubren varias técnicas: paginación, límites de ritmo, trabajos 202, idempotencia, ETag/304, gzip, reintentos con espera
exponencial y apagado ordenado. Faltan tres que afectan a todas las APIs:

- **Fallo rápido ante un proveedor caído.** Hoy, cuando Alpaca, la SEC, Webull o el Tesoro no responden, cada solicitud
  espera hasta 15 s más los reintentos. Las APIs de mercado, análisis, sincronización y órdenes se quedan colgadas en
  cadena.
- **Distinguir «el proceso vive» de «puede atender».** `/health` solo dice que el proceso responde. No sabe si las bases
  de datos están disponibles ni si el servicio se está apagando.
- **No perder trabajos al apagar.** En cada despliegue de Render (SIGTERM), los trabajos 202 en curso se cortan y quedan
  «huérfanos» 15 minutos.

Además, `openspec/config.yaml` pide que, si la estructura actual no es la óptima, la IA proponga la suya. Este cambio la
evalúa y la propone (ver design.md).

## What Changes

- **Circuit breaker por proveedor externo.**
  - Tras 5 fallos seguidos de disponibilidad (red, tiempo agotado o 5xx), el circuito de ese proveedor se abre.
  - Abierto, las solicitudes fallan al instante con 503 y `Retry-After`, en vez de esperar.
  - A los 30 s deja pasar una solicitud de prueba: si funciona, el circuito se cierra; si falla, se vuelve a abrir.
  - Aplica a Alpaca, SEC, Webull y Tesoro, y por lo tanto a todas las APIs que dependen de ellos.
- **Readiness `GET /health/listo`.** Es nuevo, público y está fuera de `/api/v1`, como `/health`. Responde 200 o 503 con
  el estado de las bases de datos configuradas, los circuitos de los proveedores y la cola. `/health` (liveness) no
  cambia y Render lo sigue usando.
- **Drenado al apagar.** Con SIGTERM el servicio deja de aceptar trabajos nuevos (503 con `Retry-After`), espera hasta 8 s
  a que terminen los que están en curso y luego cierra. Mientras tanto, `/health/listo` responde 503.
- **`GET /integraciones/estado`** suma el estado del circuito de cada proveedor. Solo agrega campos; no quita ninguno.
- **Estructura propuesta por la IA:** módulos por dominio en `src/modulos/<dominio>/`. Lo nuevo de este cambio se
  implementa ahí. Las pruebas de estructura se extienden para vigilar también esos módulos. Los módulos existentes no se
  mueven: su migración queda como cambio aparte.
- Sin **BREAKING**: ninguna ruta de `/api/v1` cambia de forma, ni de código de éxito, ni de autenticación.

Fuera del alcance:
- Migrar los 20+ módulos existentes a la estructura por dominio.
- Cola externa (Redis/BullMQ).
- Varias instancias.
- Monitoreo y métricas (inciso C, cambio aparte).
- Cambiar el `healthCheckPath` de Render.

## Capabilities

### New Capabilities
- `resiliencia-proveedores`: comportamiento ante proveedores externos que fallan, con circuito por proveedor (estados,
  umbral, fallo rápido, prueba de recuperación) y cómo se reporta.
- `salud-servicio`: liveness y readiness del servicio, y el ciclo de vida al apagar (drenado de trabajos).

### Modified Capabilities
- `plataforma-seguridad`: requisito nuevo «Módulos por dominio vigilados»: el código en `src/modulos/<dominio>/` cumple
  las mismas reglas de capas y la misma prueba automática que `src/api/v1/`. El requisito existente de capas no cambia.
- `datos-mercado`: «Estado de los proveedores sin revelar claves» incluye el estado del circuito de cada proveedor.
- `ordenes-paper`: «Envío y recuperación de un envío incierto» trata un circuito abierto como «no llegó al broker,
  reintentable», nunca como envío incierto.
- `trabajos-asincronos`: los endpoints 202 responden 503 con `Retry-After` mientras el servicio se apaga.

## Impact

- **Capa integration:** `src/integrations/http.js` (usa el circuito), `src/integrations/errors.js` (código nuevo
  `CIRCUITO_ABIERTO`) e `src/integrations/index.js` (`estado()` con circuitos).
- **Capa service:**
  - `services/broker.service.js`: clasificación del error de envío;
  - `services/sincronizacion.service.js`: aborta con circuito abierto;
  - `services/trabajos.service.js` o el middleware de límites: rechaza trabajos al drenar.
- **Módulos nuevos (estructura por dominio):**
  - `src/modulos/salud/`: definición, ruta, controlador y servicio de `/health/listo`;
  - `src/modulos/compartido/circuito.js`: el circuito, puro y probado sin red.
- **Servidor:**
  - `src/app.js`: monta el módulo de salud y mapea `CIRCUITO_ABIERTO` a 503 con `Retry-After`;
  - `src/index.js`: drenado antes de cerrar;
  - `src/jobs/cola.js`: estado «drenando».
- **Pruebas:**
  - nuevas: `tests/resiliencia.test.cjs`, `tests/salud.test.cjs`;
  - ampliadas: `tests/estructura.test.cjs` (módulos por dominio), `tests/operacion.test.cjs` (circuito al enviar).
- **Documentación:**
  - ADR nueva (estructura por dominio y resiliencia) en `docs/decisiones/README.md`;
  - evidencia IA frente a manual en `docs/guia-opciones/`.
- **Dependencias:** ninguna nueva.
- **Despliegue:** sin cambios en `render.yaml`.
