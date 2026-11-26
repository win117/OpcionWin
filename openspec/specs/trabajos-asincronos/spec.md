# trabajos-asincronos

## Purpose
Ejecutar las operaciones lentas (sincronizar, evaluar cores, confluencia, selección y evaluación de configuraciones) sin
bloquear la solicitud: el POST guarda un registro `pendiente`, responde 202 y el trabajo corre en una cola en memoria del
mismo proceso (ADR-003).
Implementación: `src/jobs/cola.js`, `services/trabajos.service.js`, `services/trabajos-huerfanos.service.js`,
`middlewares/limites.handler.js` (`limiteOperaciones`).

## Requirements

### Requirement: Respuesta 202 y consulta del estado
Los endpoints `POST /sincronizaciones/ejecuciones`, `POST /cores/:core/evaluaciones`, `POST /confluencias/ejecuciones`,
`POST /selecciones/ejecuciones` y `POST /configuraciones/:id/evaluaciones` SHALL crear el registro en estado `pendiente`,
responder 202 con su identificador y ejecutar el trabajo después. El estado MUST avanzar
`pendiente → procesando → completada | fallida` y consultarse con `GET` sobre el recurso correspondiente.

#### Scenario: Sincronización de velas
- **WHEN** se envía `POST /sincronizaciones/ejecuciones` con `recurso: "historicos"` y `simbolos: ["AAPL"]`
- **THEN** responde 202 con el id de la sincronización
- **AND** al consultarla termina en `completada` con las velas guardadas

### Requirement: Concurrencia y tope por usuario
La cola SHALL ejecutar como máximo 2 trabajos a la vez y aceptar hasta 60 trabajos en espera por usuario. El exceso MUST
responder 429 con un mensaje claro y sin crear el registro. El tope MUST NOT bloquear los tickets de órdenes.

#### Scenario: Ráfaga de trabajos
- **WHEN** un usuario tiene 60 trabajos en cola y envía otro
- **THEN** responde 429 y no se crea un registro nuevo
- **AND** otro usuario sí puede encolar

### Requirement: Límite de operaciones costosas
El sistema SHALL limitar a 120 por minuto por usuario las operaciones costosas (POST de acciones). Los GET, el CRUD común
y las solicitudes de otros usuarios MUST NOT contar para ese límite.

#### Scenario: GET no cuenta
- **WHEN** un usuario hace 500 `GET /empresas` en un minuto
- **THEN** ninguno responde 429 por este límite

### Requirement: Trabajos huérfanos
Si el proceso se reinicia, un trabajo que quedó en `procesando` por más de 15 minutos y que ya no está activo en la cola
SHALL marcarse `fallida` al consultarse. Un fallo al escribir esa marca MUST NOT romper la lectura.

#### Scenario: Reinicio a mitad de un trabajo
- **WHEN** se consulta una evaluación que lleva 20 minutos en `procesando` tras un reinicio
- **THEN** se devuelve como `fallida`
