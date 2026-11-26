# brokers-paper

## Purpose
Conectar la app con brokers en modo simulado (paper) detrás de un contrato común, para que el resto del sistema no
dependa del broker. Brokers soportados: Alpaca (paper) y Webull (sandbox). Interactive Brokers está retirado (etiqueta
git `respaldo-ibkr`).
Implementación: `src/integrations/contrato-broker.js`, `alpaca.client.js`, `alpaca.stream.js`, `webull.client.js`,
`services/broker.service.js`, `services/conexiones-broker.service.js`, `routes/operacion.routes.js`.

## Requirements

### Requirement: Contrato común de broker
Todo adaptador SHALL implementar `cuenta`, `enviarOrden`, `consultarOrden`, `consultarPorClientOrderId`, `cancelarOrden`,
`ordenesAbiertas` y `posiciones` (opcionales: `historialCartera`, `suscribirOrdenes`, `avisosActivos`) y declarar
`entorno: 'paper'`. Si a un adaptador le falta un método obligatorio, el servidor MUST NOT arrancar.

#### Scenario: Adaptador incompleto
- **WHEN** se registra un adaptador sin `cancelarOrden`
- **THEN** el arranque falla con un error que nombra el método faltante

### Requirement: Solo entorno paper
El cliente de trading de Alpaca SHALL usar siempre `paper-api.alpaca.markets`, y Webull solo los hosts exactos de su
sandbox. Una URL o un host live MUST rechazarse, y una conexión con `entorno: live` MUST responder 403 al enviar
(ADR-005).

#### Scenario: URL live configurada
- **WHEN** se configura la URL de trading live de Alpaca
- **THEN** el cliente lanza `NO_PERMITIDO` antes de cualquier solicitud

### Requirement: Credenciales por referencia
Las conexiones SHALL guardar solo una referencia (`env:ALPACA` o `env:WEBULL`). Las claves viven en variables del
servidor y MUST NOT guardarse en la base ni devolverse al cliente (ADR-006). Sin credenciales, la conexión responde 503.

#### Scenario: Servidor sin claves de Webull
- **WHEN** se pide `POST /broker/paper/conexion` para Webull sin sus variables
- **THEN** responde 503 «Sin credenciales en el servidor»

### Requirement: Brokers disponibles y conexión idempotente
`GET /brokers/disponibles` SHALL listar Alpaca y Webull con su estado operativo. `POST /broker/paper/conexion` SHALL
asegurar la conexión paper y verificar la cuenta. Las solicitudes simultáneas MUST NOT crear conexiones duplicadas; se
respeta la existente y se reemplaza la revocada. `POST /conexiones-broker/:id/verificacion` verifica y activa una
conexión.

#### Scenario: Dos conexiones a la vez
- **WHEN** llegan dos `POST /broker/paper/conexion` simultáneos para Alpaca
- **THEN** existe una sola conexión

### Requirement: Traducción de órdenes por broker
El servicio SHALL armar una orden neutral y cada adaptador la traduce. En Alpaca una pata es una orden simple y varias
patas usan `order_class: mleg`, con `limit_price` negativo para crédito. En Webull, `option_strategy` se deduce de las
patas (`SINGLE`, `IRON_CONDOR`…) y el crédito es `side: SELL` con precio positivo. Webull MUST rechazar con un mensaje
claro las estructuras de varias patas a mercado.

#### Scenario: Iron Condor en Alpaca
- **WHEN** se envía un Iron Condor de crédito 2.97
- **THEN** Alpaca recibe una orden `mleg` de 4 patas con `limit_price: "-2.97"`

### Requirement: Estados normalizados
Los estados de cada broker SHALL traducirse a `enviada`, `aceptada`, `parcial`, `ejecutada`, `cancelada`, `rechazada` o
`expirada`. Un formato de orden o de posición no reconocido MUST NOT suponerse: se informa.

#### Scenario: Estado de Alpaca
- **WHEN** Alpaca reporta `partially_filled`
- **THEN** la orden queda `parcial`

### Requirement: Firma y reintentos de Webull
El cliente de Webull SHALL firmar con HMAC-SHA1 (verificado con el vector oficial), usar firma y nonce nuevos en cada
intento, y MUST NOT repetir un POST que respondió 5xx. Un `client_order_id` de más de 32 caracteres se reemplaza por su
hash SHA-256 truncado.

#### Scenario: POST con 5xx
- **WHEN** Webull responde 503 al colocar una orden
- **THEN** el cliente no reenvía la orden automáticamente
