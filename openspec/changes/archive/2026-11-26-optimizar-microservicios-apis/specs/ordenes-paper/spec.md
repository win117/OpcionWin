# Spec Delta

## MODIFIED Requirements

### Requirement: Envío y recuperación de un envío incierto
`POST /ordenes/:id/envio` SHALL enviar una orden pendiente. Si el envío anterior quedó incierto (sin respuesta), el
sistema MUST buscar la orden en el broker por `client_order_id`: si existe la adopta y, si no, la reenvía. Un rechazo
definitivo (4xx) MUST marcarla `rechazada`. Un fallo de credenciales, de límite o con el circuito del broker abierto la
deja pendiente y reintentable.

#### Scenario: Se cortó la red tras enviar
- **WHEN** el broker aceptó la orden pero la respuesta no llegó
- **THEN** al reintentar se adopta la orden del broker en lugar de duplicarla

#### Scenario: Circuito del broker abierto
- **WHEN** se envía una orden con el circuito de Alpaca abierto
- **THEN** la orden queda pendiente con un error previo al envío y la respuesta es 503 con `Retry-After`
