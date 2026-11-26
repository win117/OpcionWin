# salud-servicio Specification

## Purpose

Permitir que un orquestador, un monitor de disponibilidad o una persona sepan si el servicio está vivo y si puede atender
solicitudes, y apagarlo sin cortar el trabajo en curso.

## Requirements

### Requirement: Liveness sin dependencias
`GET /health` SHALL seguir respondiendo 200 `{ status: "ok" }` mientras el proceso atienda solicitudes, sin consultar
bases de datos ni proveedores, aunque estén caídos o el servicio se esté apagando.

#### Scenario: Base de datos caída
- **WHEN** MongoDB no responde
- **THEN** `GET /health` sigue respondiendo 200

### Requirement: Readiness con dependencias
`GET /health/listo` SHALL ser público, quedar fuera de `/api/v1` y responder 200 con `estado: "listo"` cuando al menos
una base de datos configurada responde y el servicio no se está apagando; en otro caso, 503 con `estado: "no_listo"` y
un `motivo`. MUST reportar cada base (`ok`, `caido` o `sin_configurar`), los circuitos y la cola, sin revelar
credenciales ni direcciones.

#### Scenario: Todo disponible
- **WHEN** MongoDB responde y el servicio no se está apagando
- **THEN** responde 200 con `estado: "listo"` y `mongodb: { estado: "ok" }`

#### Scenario: Ninguna base disponible
- **WHEN** las bases de datos configuradas no responden
- **THEN** responde 503 con `estado: "no_listo"` y el motivo

#### Scenario: Sin secretos
- **WHEN** se lee la respuesta de `/health/listo`
- **THEN** no contiene la cadena de conexión, la URL ni las claves de ninguna base o proveedor

### Requirement: Proveedor caído degrada pero no tumba
Un circuito de proveedor abierto SHALL reportarse en `/health/listo` como `degradado` sin cambiar por sí solo la
respuesta a 503, porque el servicio sigue atendiendo lo que no depende de ese proveedor.

#### Scenario: Alpaca caído
- **WHEN** el circuito de Alpaca está abierto y MongoDB responde
- **THEN** `/health/listo` responde 200 con `degradado: true` y Alpaca en estado `abierto`

### Requirement: Comprobaciones acotadas
Cada comprobación de base de datos SHALL tener un tiempo máximo de 2 s y el resultado MUST reutilizarse durante 10 s,
para que consultas frecuentes de un monitor no carguen las bases.

#### Scenario: Monitor que consulta cada segundo
- **WHEN** se piden 20 `GET /health/listo` en 10 s
- **THEN** cada base se consulta una sola vez

### Requirement: Drenado al apagar
Al recibir SIGTERM o SIGINT, el servicio SHALL dejar de aceptar trabajos nuevos, esperar hasta 8 s a que terminen los
trabajos en curso y luego cerrar. Durante el drenado, `/health/listo` MUST responder 503 con `motivo: "apagando"`. Si
el tiempo vence, se cierra igual y los trabajos inconclusos quedan para la regla de trabajos huérfanos.

#### Scenario: Despliegue con un trabajo en curso
- **WHEN** llega SIGTERM mientras una sincronización de 3 s está en curso
- **THEN** la sincronización termina y queda `completada` antes de que el proceso cierre
