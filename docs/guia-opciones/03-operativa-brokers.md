# 3. Operativa de estrategias en los brokers

> Cómo se abre una cuenta, qué permisos se necesitan y cómo se envía cada estrategia (Long Call, Long Put, Iron Condor) como
> orden de una o varias patas en **Alpaca y Webull**. Todo en **paper** (ADR-005).
> Implementación: `src/integrations/{alpaca,webull}.client.js` y `contrato-broker.js`.

## 3.1 Conceptos comunes

| Concepto | Qué es | Por qué importa |
|---|---|---|
| **Cuenta cash** | Solo usa el dinero depositado | Permite comprar calls/puts; no permite vender opciones descubiertas |
| **Cuenta de margen** | El broker presta y exige garantía | Necesaria para spreads de crédito como el Iron Condor |
| **Nivel de opciones** | Permiso que otorga el broker según experiencia | Nivel 1: covered calls · Nivel 2: comprar calls/puts · **Nivel 3: spreads (Iron Condor)** |
| **Poder de compra** | Dinero disponible para nuevas órdenes | El ticket lo compara con lo requerido |
| **Margen requerido** | Garantía retenida | Iron Condor: pérdida máxima = (ancho − crédito) × 100 |
| **Paper trading** | Cuenta simulada | Precios reales, dinero ficticio; es lo único habilitado |
| **Orden simple / multi-pata** | 1 contrato / varios que se ejecutan juntos | Long Call/Put = simple; Iron Condor = 4 patas |
| **Market / Limit** | Precio de mercado / precio máximo-mínimo | Para opciones conviene **límite** (spreads amplios) |
| **day / gtc** | Vigente hoy / hasta cancelar | Por defecto `day` |
| **position_intent** | `buy_to_open`, `sell_to_open`, `buy_to_close`, `sell_to_close` | Distingue abrir de cerrar |
| **Idempotencia** | Una clave única por orden | Un reintento no duplica la orden |

### El contrato común de broker
`contrato-broker.js` define los métodos que todo adaptador debe tener; si falta uno, el servidor **no arranca**:
`cuenta`, `enviarOrden`, `consultarOrden`, `consultarPorClientOrderId`, `cancelarOrden`, `ordenesAbiertas`, `posiciones`
(opcionales: `historialCartera`, `suscribirOrdenes`, `avisosActivos`). Además debe declarar `entorno: 'paper'`.

```
            ┌──────────── operacion.service (orden neutral) ────────────┐
            │  {clientOrderId, tipo, vigencia, cantidad, precioLimite,  │
            │   credito, componentes:[{simbolo OCC, accion, intencion}]}│
            └───────┬──────────────────┬──────────────────┬─────────────┘
                         ▼                         ▼
                   alpaca.client              webull.client
                   POST /v2/orders            /openapi/.../order/place
```

## 3.2 Alpaca

### Cuenta y permisos — paso a paso
1. Registrarse en `alpaca.markets` → la cuenta **paper** se crea automáticamente.
2. *Paper → API Keys*: generar claves que empiezan con **`PK`** (las `CK` son de Broker API y devuelven 401).
3. Verificar el **nivel de opciones 3** en la configuración de la cuenta paper.
4. En `.env`: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_DATA_FEED=iex`.

Alpaca da **también los datos de mercado** (velas, cadena de opciones con IV y griegas, noticias). Ritmo: ≤ 180 solicitudes/min
con cubo de fichas (ráfaga de 30).

### Órdenes por estrategia (`construirCuerpoOrden`)
```json
// Long Call — 1 pata (Long Put igual con un contrato P)
{"symbol":"AAPL261218C00230000","qty":"1","side":"buy","type":"limit","limit_price":"3.6",
 "time_in_force":"day","client_order_id":"<key>","position_intent":"buy_to_open"}

// Iron Condor — order_class mleg; limit_price NEGATIVO = crédito
{"type":"limit","time_in_force":"day","client_order_id":"<key>","limit_price":"-2.97","order_class":"mleg","qty":"1",
 "legs":[{"symbol":"TSLA261201P00342500","ratio_qty":"1","side":"buy", "position_intent":"buy_to_open"},
         {"symbol":"TSLA261201P00352500","ratio_qty":"1","side":"sell","position_intent":"sell_to_open"},
         {"symbol":"TSLA261201C00407500","ratio_qty":"1","side":"sell","position_intent":"sell_to_open"},
         {"symbol":"TSLA261201C00417500","ratio_qty":"1","side":"buy", "position_intent":"buy_to_open"}]}
```
Estados: `pending_new → enviada`, `new/accepted → aceptada`, `partially_filled → parcial`, `filled → ejecutada`,
`canceled → cancelada`, `rejected → rechazada`, `expired → expirada`. Avisos en vivo por WebSocket `trade_updates` (ADR-018).

## 3.3 Webull

### Cuenta y permisos — paso a paso
1. Solicitar acceso a **Webull OpenAPI** y obtener `AppKey` y `AppSecret` del **sandbox** (`api.sandbox.webull.com`).
2. Activar opciones en la cuenta de pruebas.
3. En `.env` las credenciales de Webull; en la cabecera elegir **Webull paper**.

Firma: HMAC-SHA1 con clave `AppSecret&` (verificada con el vector oficial). Webull **no** da datos de mercado al proyecto (siguen de Alpaca).

### Órdenes por estrategia (`webull.client.js`)
```json
// Long Put — option_strategy SINGLE
{"new_orders":[{"client_order_id":"<key≤32>","combo_type":"NORMAL","order_type":"LIMIT","limit_price":"3.00",
  "time_in_force":"DAY","instrument_type":"OPTION","market":"US","symbol":"AAPL","option_strategy":"SINGLE",
  "side":"BUY","quantity":"1","position_intent":"BUY_TO_OPEN",
  "legs":[{"side":"BUY","quantity":"1","symbol":"AAPL","strike_price":"230","option_expire_date":"2026-12-18","option_type":"PUT"}]}]}

// Iron Condor — la estrategia se deduce de las patas (2 tipos y 4 strikes → IRON_CONDOR); crédito = side SELL
{"new_orders":[{ ..., "option_strategy":"IRON_CONDOR","side":"SELL","limit_price":"2.97","quantity":"1","legs":[ 4 patas ]}]}
```
Reglas: horario 9:30–16:00 NY; las de varias patas **solo con límite** (a mercado responde «No matching options strategy
found»); `client_order_id` alfanumérico ≤ 32 (si no, se usa el hash SHA-256 truncado de la clave). Sin avisos en vivo: el
servidor consulta cada 3 s.

## 3.4 Tabla comparativa

| | Alpaca | Webull |
|---|---|---|
| Acceso | Claves API `PK` | AppKey/AppSecret sandbox |
| Datos de mercado | **Sí** (fuente principal) | No |
| Multi-pata | `order_class: mleg` | `option_strategy` deducida |
| Crédito | `limit_price` negativo | `side: SELL` con precio positivo |
| Multi-pata a mercado | Sí | **No** |
| Idempotencia | `client_order_id` | `client_order_id` (≤ 32) |
| Avisos en vivo | WebSocket | Consulta cada 3 s |
| Funciona en Render | Sí | Sí |

## 3.5 Paso a paso: generar una orden desde la app

1. **Análisis** del ticker → ver la estrategia mejor clasificada.
2. Pulsar **Operar**: `construirPatas` arma las patas (ATM para Long; |Δ| ≈ 0.20 y alas 2.5 % para Iron Condor).
3. En el **ticket** revisar vencimiento, patas, cantidad, tipo (límite), precio (mid), vigencia y broker.
4. Leer el riesgo: pérdida/ganancia máxima, breakevens y avisos (spread > 10 %, poder de compra, análisis > 24 h, cores contradictorios).
5. **Revisar → Confirmar**: `POST /api/v1/ordenes/ticket` con `Idempotency-Key`.
6. Seguir la orden en vivo (`GET /ordenes/:id/seguimiento`, Server-Sent Events) hasta *ejecutada* o *cancelada*.
7. Cerrar: `POST /posiciones/:id/cierre` (long → `sell_to_close`, short → `buy_to_close`) o `POST /posiciones/cierre-grupo`
   para cerrar las 4 patas del condor juntas.

## Resumen
Los dos brokers piden cuenta, permisos de opciones y credenciales distintas, pero la app los oculta tras un **contrato común**:
el servicio arma una orden neutral y cada adaptador la traduce (Alpaca `mleg`, Webull `option_strategy`), siempre
en paper y con idempotencia.

> Interactive Brokers se retiró del proyecto por ahora (etiqueta git `respaldo-ibkr` para recuperarlo en el futuro).
