# 1. Introducción a Inversiones

> Guía paso a paso · Equipo 9 · Estrategias asignadas: **Long Call, Long Put e Iron Condor**.
> Esta sección da el vocabulario mínimo para entender el resto de la guía y el proyecto AppRESTOpciones.

## 1.1 ¿Qué es invertir?

Invertir es entregar dinero hoy a cambio de la expectativa de recibir más en el futuro, aceptando un **riesgo** (la posibilidad
de recibir menos). Toda decisión de inversión responde tres preguntas:

1. **¿Cuánto espero ganar?** (rendimiento esperado)
2. **¿Cuánto puedo perder y con qué probabilidad?** (riesgo)
3. **¿Cuándo puedo recuperar mi dinero?** (liquidez y horizonte)

## 1.2 Tipos de inversión

| Tipo | Qué compras | Riesgo | Ejemplo | ¿Se usa en el proyecto? |
|---|---|---|---|---|
| Renta fija | Un préstamo a un gobierno o empresa (bonos, CETES, T-Bills) | Bajo | Letra del Tesoro de EE. UU. a 3 meses | Sí: su tasa es la **tasa libre de riesgo** de Black-Scholes (`tesoro.client.js`) |
| Renta variable | Una parte de una empresa (acción) | Medio–alto | 1 acción de AAPL | Sí: es el **subyacente** de las opciones |
| Fondos / ETF | Una canasta de activos que cotiza como acción | Medio | SPY (S&P 500), QQQ (Nasdaq 100) | Sí: tablero «Mercado hoy» (SPY, QQQ, DIA, IWM) |
| Derivados: **opciones** | Un contrato que da el derecho de comprar (call) o vender (put) una acción a un precio fijo | Alto (apalancado) | Call de AAPL con strike 230 | **Sí: es lo que analiza y opera el proyecto** |
| Derivados: futuros | Un contrato con la *obligación* de comprar o vender | Alto | Futuro del petróleo | No |
| Divisas / materias primas | Monedas, oro, petróleo | Variable | USD/MXN | No |

**Paso a paso para clasificar un activo:** identifica qué compras realmente (deuda, propiedad o contrato) → de quién depende su
valor → cuál es la pérdida máxima posible → con qué rapidez lo puedes vender.

## 1.3 Conceptos de mercado

| Concepto | Definición corta | Dónde aparece en la app |
|---|---|---|
| **Bolsa** (NYSE, Nasdaq) | Mercado organizado donde se compran y venden valores | Origen de los precios que entrega Alpaca |
| **Ticker** | Código de la acción: `AAPL`, `MSFT`, `TSLA` | Buscador de Análisis |
| **Vela OHLCV** | Resumen de un día: apertura, máximo, mínimo, cierre, volumen | `datos-mercado` con `tipo: 'vela'` |
| **Bid / Ask** | Mejor precio de compra / de venta | Cadena de opciones y ticket |
| **Spread** | `ask − bid`: costo de entrar y salir | Aviso si el spread > 10 % en una orden a mercado |
| **Liquidez** | Facilidad para operar sin mover el precio | Interés abierto y volumen de cada contrato |
| **Volatilidad** | Cuánto se mueve el precio (desviación estándar anualizada) | `hv_20`, `hv_60`, `iv_promedio` |
| **Horario** | NYSE: 9:30–16:00 hora de Nueva York | `GET /mercado/estado`; con el mercado cerrado no se envían órdenes |
| **Long / Short** | Comprar (ganas si sube) / vender (ganas si baja) | `lado` de cada posición |
| **Paper trading** | Cuenta simulada: precios reales, dinero ficticio | Todas las órdenes del proyecto |

### Ejemplo numérico de una vela
O = 100, H = 103, L = 99, C = 102, V = 1.2 M → abrió en 100, llegó a 103, bajó a 99 y cerró en 102 (vela **verde**, porque C > O).

### Rendimiento y volatilidad, paso a paso
1. Rendimiento logarítmico de un día: `r = ln(C_hoy / C_ayer)`.
2. Desviación estándar muestral de los últimos 20 rendimientos: `σ_d`.
3. Anualizar: `σ_año = σ_d · √252` (252 sesiones por año).
4. Ejemplo: cierres 100, 102, 99, 101, 104, 103 → σ diaria 0.0248 → **39.4 % anual**.

## 1.4 Perfil del inversionista

| Perfil | Tolerancia a pérdidas | Estrategia afín (de las asignadas) |
|---|---|---|
| Conservador | Baja | Ninguna de compra pura; si acaso Iron Condor con alas estrechas (pérdida acotada) |
| Moderado | Media | Iron Condor (gana en rango, pérdida máxima conocida) |
| Agresivo | Alta | Long Call / Long Put (pierde la prima completa con frecuencia, gana mucho cuando acierta) |

## 1.5 Marco regulatorio

| Organismo / norma | País | Qué regula | Relación con el proyecto |
|---|---|---|---|
| **SEC** (Securities and Exchange Commission) | EE. UU. | Mercado de valores; exige reportes 10-K, 10-Q, 8-K y 13F | Fuente de fundamentales y 13F (`sec.client.js`). Exige un `User-Agent` con contacto y ≤ 10 solicitudes/s |
| **FINRA** | EE. UU. | Intermediarios (brokers); niveles de aprobación de opciones | Alpaca exige **nivel 3** para spreads como el Iron Condor |
| **OCC** (Options Clearing Corporation) | EE. UU. | Liquidación de opciones; formato del símbolo | `TSLA261201P00352500` (`parsearOcc`) |
| **Pattern Day Trader** (FINRA 4210) | EE. UU. | Cuentas < 25 000 USD con ≥ 4 operaciones intradía en 5 días | Relevante solo en cuentas reales |
| **CNBV** | México | Mercado de valores mexicano | Un residente en México que opere en EE. UU. lo hace mediante un broker extranjero |
| **Ley Federal de Protección de Datos Personales** | México | Datos personales | El proyecto guarda contraseñas con scrypt, tokens hasheados y nunca expone credenciales |

## 1.6 Marco ético del proyecto

El proyecto es **académico**. Estas reglas están escritas en el código y en las decisiones (ADR):

1. **Solo paper** (ADR-005): la URL de trading de Alpaca está fija a `paper-api.alpaca.markets`; cualquier otra lanza
   `NO_PERMITIDO`. Webull solo acepta su sandbox.
2. **No es asesoría financiera**: el puntaje 0–100 mide qué tan alineados están los factores con una estrategia; **no es la
   probabilidad de ganar** (ADR-014 y ADR-020).
3. **Honestidad con los datos**: el backtest de ADR-020 (2 856 casos reales) mostró que ningún puntaje anticipó la ganancia; se
   documenta en lugar de esconderlo.
4. **No se inventan datos**: si falta un dato, el core lo declara en `datosFaltantes` y baja su cobertura.
5. **Sin sesgo de anticipación**: los cores descartan cualquier dato posterior a `fechaReferencia`.
6. **Credenciales por referencia** (ADR-006): las claves viven en variables del servidor; el navegador nunca las ve.
7. **Uso justo de proveedores**: límites de ritmo (Alpaca ≤ 180 solicitudes/min, SEC ≥ 120 ms entre solicitudes).

## 1.7 Paso a paso: primera visita a la plataforma

1. Entrar a `/login` y elegir la base de datos (MongoDB o Supabase).
2. En **Inicio** revisar «Mercado hoy» (SPY, QQQ, DIA, IWM) y el estado del mercado (abierto/cerrado).
3. Buscar un ticker (ej. `AAPL`) y abrir **Análisis**.
4. Leer gráfica de velas, fundamentales, noticias y la cadena de opciones.
5. Consultar el **Glosario** de la app para cualquier término.

## Resumen
Antes de operar opciones hay que entender qué es una acción, cómo se mide su riesgo (volatilidad), quién regula el mercado y
cuáles son los límites éticos del proyecto: paper trading, transparencia y nada de promesas de ganancia.
