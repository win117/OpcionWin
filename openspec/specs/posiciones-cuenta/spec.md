# posiciones-cuenta

## Purpose
Mostrar la cuenta simulada (valor, posiciones vivas, últimas órdenes e historial) y cerrar posiciones, solas o en grupo
(las 4 patas de un Iron Condor en una sola orden), sin cerrar dos veces lo mismo.
Implementación: `services/operacion.service.js`, `services/posiciones.service.js`, `routes/operacion.routes.js`,
`routes/posiciones.routes.js`.

## Requirements

### Requirement: Resumen de la cuenta
`GET /broker/paper/resumen` SHALL devolver la cuenta, las posiciones vivas unidas con los contratos y posiciones
guardados, y las últimas órdenes. Debe avisar de las órdenes abiertas que no salieron de esta app y de los fallos de
sincronización. Solo MUST consultar los contratos de las posiciones vivas.

#### Scenario: Orden abierta desde otro sitio
- **WHEN** existe en el broker una orden viva que no está en la base
- **THEN** el resumen la muestra con un aviso

### Requirement: Historial de la cartera
`GET /broker/paper/historial` SHALL devolver `{ disponible, items: [{ fecha, valor }] }`. Con Webull, que no lo ofrece,
`disponible` es `false`.

#### Scenario: Webull
- **WHEN** la conexión activa es Webull
- **THEN** responde `disponible: false` con la lista vacía

### Requirement: Sincronización de posiciones
Al sincronizar posiciones, el sistema SHALL abrir las nuevas, actualizar las existentes y marcar `cerrada` la que el
broker ya no reporta. Una posición sin lado determinable MUST mostrarse y guardarse como no cerrable. Los lados de un
Iron Condor se deducen con evidencia y, si falta, no se suponen.

#### Scenario: Posición cerrada en el broker
- **WHEN** una posición guardada ya no aparece en el broker
- **THEN** queda en estado `cerrada`

### Requirement: Cierre de una posición
`POST /posiciones/:id/cierre` SHALL cerrar con el lado y la cantidad en vivo del broker: una posición long con
`sell_to_close` y una short con `buy_to_close`. Solo cierra posiciones abiertas y es idempotente con `Idempotency-Key`.

#### Scenario: Cerrar un Long Put
- **WHEN** se cierra un long put de 2 contratos
- **THEN** se envía una venta `sell_to_close` de 2 contratos

### Requirement: Cierre en grupo
`POST /posiciones/cierre-grupo` SHALL cerrar de 2 a 4 posiciones con una sola orden de varias patas, con intenciones de
cierre y cantidades en vivo. Si ya existe una orden de cierre viva para esas posiciones, MUST bloquear el duplicado.

#### Scenario: Cerrar un Iron Condor
- **WHEN** se piden cerrar las 4 patas de un Iron Condor
- **THEN** se envía una sola orden de 4 patas con `buy_to_close` en las vendidas y `sell_to_close` en las compradas
