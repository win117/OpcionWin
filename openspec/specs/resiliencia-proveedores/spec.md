# resiliencia-proveedores Specification

## Purpose

Evitar que un proveedor externo caído (Alpaca, SEC, Webull o Tesoro) arrastre a las APIs que dependen de él: cada
proveedor tiene un circuito que, tras fallos repetidos, responde al instante con un error claro y se recupera solo.

## Requirements

### Requirement: Circuito por proveedor
Cada proveedor externo SHALL tener su propio circuito con tres estados: `cerrado` (las solicitudes pasan), `abierto`
(fallan al instante) y `semiabierto` (pasa una sola solicitud de prueba). El estado de un proveedor MUST NOT afectar a
los demás.

#### Scenario: Un proveedor caído no afecta a otro
- **WHEN** el circuito de la SEC está abierto
- **THEN** las solicitudes a Alpaca siguen pasando con normalidad

### Requirement: Apertura por fallos de disponibilidad
El circuito SHALL abrirse tras 5 fallos de disponibilidad consecutivos del mismo proveedor. Solo cuentan como fallo de
disponibilidad el error de red, el tiempo de espera agotado y las respuestas 5xx (después de los reintentos). Un éxito
MUST reiniciar la cuenta. Los 4xx, incluido el 429, MUST NOT abrir el circuito.

#### Scenario: Cinco caídas seguidas
- **WHEN** Alpaca agota el tiempo de espera en 5 solicitudes seguidas
- **THEN** el circuito de Alpaca queda `abierto`

#### Scenario: Errores del cliente no abren el circuito
- **WHEN** Alpaca responde 404 o 422 a 10 solicitudes seguidas
- **THEN** el circuito de Alpaca sigue `cerrado`

#### Scenario: Un éxito reinicia la cuenta
- **WHEN** hay 4 fallos de disponibilidad, luego un éxito y luego 4 fallos más
- **THEN** el circuito sigue `cerrado`

### Requirement: Fallo rápido con el circuito abierto
Con el circuito abierto, toda solicitud a ese proveedor SHALL fallar sin contactar la red con el código
`CIRCUITO_ABIERTO`. La API MUST traducirlo a 503 con la cabecera `Retry-After` (segundos que faltan para la prueba) y un
mensaje en español que nombra al proveedor, sin revelar credenciales.

#### Scenario: Consulta con Alpaca caído
- **WHEN** el circuito de Alpaca está abierto y se pide `GET /api/v1/mercado/cotizaciones/AAPL/en-vivo`
- **THEN** responde 503 en menos de 100 ms
- **AND** incluye `Retry-After` y un mensaje que menciona a Alpaca

### Requirement: Recuperación con solicitud de prueba
A los 30 segundos de abrirse, el circuito SHALL pasar a `semiabierto` y dejar pasar una sola solicitud de prueba
mientras las demás siguen fallando rápido. Si la prueba tiene éxito, MUST cerrarse; si falla por disponibilidad, MUST
abrirse de nuevo otros 30 segundos.

#### Scenario: El proveedor vuelve
- **WHEN** pasan 30 s con el circuito abierto y la solicitud de prueba responde 200
- **THEN** el circuito queda `cerrado` y las siguientes solicitudes pasan

#### Scenario: El proveedor sigue caído
- **WHEN** la solicitud de prueba vuelve a agotar el tiempo de espera
- **THEN** el circuito queda `abierto` otros 30 s

### Requirement: Un circuito abierto no es un envío incierto
Si al enviar una orden el circuito del broker está abierto, la orden MUST quedar pendiente y reintentable (no llegó al
broker), igual que ante un fallo de credenciales o de límite. Una sincronización en curso MUST detenerse e informar el
error, igual que ante un fallo de red.

#### Scenario: Ticket con Webull caído
- **WHEN** el circuito de Webull está abierto y se confirma un ticket
- **THEN** la orden queda pendiente con un error previo al envío y no como envío incierto
- **AND** al reintentar se aplica la misma consulta previa al broker que en cualquier otro reintento
