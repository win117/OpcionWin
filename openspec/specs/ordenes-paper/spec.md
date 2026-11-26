# ordenes-paper

## Purpose
Llevar una estrategia del análisis a una orden simulada: el ticket crea la configuración y la orden en un paso, la
envía al broker paper con idempotencia, y permite seguirla en vivo, actualizarla y cancelarla (ADR-011).
Implementación: `services/operacion.service.js`, `services/ordenes.service.js`, `services/seguimiento.service.js`,
`controllers/operacion.controller.js`, `routes/operacion.routes.js`.

## Requirements

### Requirement: Ticket en un paso
`POST /ordenes/ticket` SHALL recibir broker (`alpaca` por defecto o `webull`), `empresaId`, `estrategiaCodigo`, tipo
(`market` o `limit`), `precioLimite` (obligatorio y positivo en `limit`), vigencia (`day` o `gtc`), `credito` (solo
varias patas), cantidad (1–100) y componentes, y SHALL crear la configuración y la orden y enviarla al broker.

#### Scenario: Long Call límite
- **WHEN** se envía un ticket LONG_CALL de 1 contrato con límite 3.60
- **THEN** se crean la configuración y la orden, y el broker recibe una compra `buy_to_open` a 3.60

#### Scenario: Límite sin precio
- **WHEN** `tipo: "limit"` llega sin `precioLimite`
- **THEN** responde 400

### Requirement: Idempotencia con Idempotency-Key
El ticket, el envío y los cierres SHALL exigir la cabecera `Idempotency-Key`, que se usa como `client_order_id`. Repetir
la clave con los mismos datos MUST devolver 200 con la orden existente; con datos distintos, 409. Dos tickets
simultáneos con la misma clave MUST crear una sola orden.

#### Scenario: Doble clic
- **WHEN** el usuario confirma dos veces con la misma clave
- **THEN** existe una sola orden en la base y en el broker

### Requirement: Envío y recuperación de un envío incierto
`POST /ordenes/:id/envio` SHALL enviar una orden pendiente. Si el envío anterior quedó incierto (sin respuesta), el
sistema MUST buscar la orden en el broker por `client_order_id`: si existe la adopta y, si no, la reenvía. Un rechazo
definitivo (4xx) MUST marcarla `rechazada`. Un fallo de credenciales o de límite la deja pendiente y reintentable.

#### Scenario: Se cortó la red tras enviar
- **WHEN** el broker aceptó la orden pero la respuesta no llegó
- **THEN** al reintentar se adopta la orden del broker en lugar de duplicarla

### Requirement: Cancelación
`POST /ordenes/:id/cancelacion` SHALL cancelar la orden en el broker y MUST responder 409 si ya terminó. Si la orden no
tiene id externo, MUST consultar antes al broker.

#### Scenario: Orden ya ejecutada
- **WHEN** se cancela una orden en estado `ejecutada`
- **THEN** responde 409 «La orden ya terminó»

### Requirement: Actualización del estado
`POST /ordenes/:id/actualizacion` SHALL consultar la orden en el broker y guardar su estado, incluida la ejecución
parcial. La sincronización masiva consulta solo las órdenes vivas, y un fallo en una orden MUST NOT detener a las demás.

#### Scenario: Ejecución parcial
- **WHEN** el broker reporta 1 de 3 contratos ejecutados
- **THEN** la orden queda `parcial` con la cantidad ejecutada

### Requirement: Seguimiento en vivo por Server-Sent Events
`GET /ordenes/:id/seguimiento` SHALL abrir un flujo SSE que emite un evento `orden` en cada cambio y `fin` al terminar.
Con Alpaca MUST usar una sola conexión WebSocket `trade_updates` que reparte los avisos al instante. Sin avisos (Webull),
MUST consultar periódicamente tolerando fallos. Hay un tope de tiempo y de seguimientos simultáneos (429). Sin sesión
no se abre, y al desconectarse el cliente se deja de consultar.

#### Scenario: Aviso de ejecución en Alpaca
- **WHEN** Alpaca emite `fill` por WebSocket
- **THEN** el cliente SSE recibe el evento `orden` con estado `ejecutada` sin esperar la consulta periódica

### Requirement: Avisos del ticket
Antes de confirmar, el ticket SHALL advertir del spread mayor al 10 % en órdenes a mercado, del poder de compra
insuficiente, de un análisis de más de 24 h, de cores contradictorios, y de resultados o dividendos que caen antes del
vencimiento y lo afectan. Fuera de horario, la orden MUST explicarse en español y no quedar en duda.

#### Scenario: Reporte antes del vencimiento
- **WHEN** el próximo reporte de resultados cae antes del vencimiento elegido
- **THEN** el ticket muestra el aviso
