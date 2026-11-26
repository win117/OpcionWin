# 2. Inversión con Opciones

> Estrategias asignadas al equipo: **Long Call** (alcista), **Long Put** (bajista) e **Iron Condor** (neutral).
> Se explican a fondo; el resto del catálogo se resume para saber cuándo conviene cada una.
> Implementación: `src/cores/blackscholes.js` y `src/cores/estrategias.core.js`.

## 2.1 Fundamentos

| Término | Definición | Ejemplo |
|---|---|---|
| **Call** | Derecho (no obligación) a **comprar** el subyacente al strike K hasta el vencimiento | Call AAPL K = 230 |
| **Put** | Derecho a **vender** al strike K | Put TSLA K = 350 |
| **Prima** | Precio de la opción, cotizado por acción | 3.60 |
| **Multiplicador** | 1 contrato = 100 acciones | 3.60 × 100 = **360 USD** |
| **Vencimiento** | Fecha en que expira (el código usa 20:00 UTC = 16:00 NY) | 2026-12-18 |
| **Símbolo OCC** | Subyacente + AAMMDD + C/P + strike × 1000 | `TSLA261201P00352500` |
| **Intrínseco** | Lo que vale ejercer ya: call `max(0, S−K)`, put `max(0, K−S)` | S = 105, K = 100 → 5 |
| **Extrínseco** | Prima − intrínseco (valor del tiempo) | 6.645 − 5 = 1.645 |
| **ITM / ATM / OTM** | Con valor intrínseco / S ≈ K / sin valor intrínseco | — |
| **Débito / Crédito** | Pagas al abrir / cobras al abrir | Long Call = débito; Iron Condor = crédito |

### Payoff al vencimiento (por acción)
- Long Call: `max(0, S_T − K) − prima`
- Long Put: `max(0, K − S_T) − prima`

## 2.2 Black-Scholes paso a paso

**Supuestos:** opción europea, volatilidad σ y tasa r constantes, precio lognormal, sin costos. (Las opciones de acciones de
EE. UU. son americanas; para calls sin dividendos el valor coincide, para puts es una aproximación).

```
d1 = [ ln(S/K) + (r − q + σ²/2)·T ] / (σ·√T)        d2 = d1 − σ·√T
Call = S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2)
Put  = K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)
```

**Paso 1.** Reunir datos: S = 100, K = 100, T = 1 año, r = 5 %, σ = 20 %, q = 0.
**Paso 2.** `d1 = (0 + (0.05 + 0.02)·1)/0.20 = 0.35`; `d2 = 0.15`.
**Paso 3.** `N(0.35) = 0.6368`, `N(0.15) = 0.5596` (aproximación Abramowitz & Stegun 26.2.17, error < 7.5·10⁻⁸).
**Paso 4.** `Call = 100·0.6368 − 100·e^(−0.05)·0.5596 = 10.4506`; `Put = 5.5735`.
**Paso 5.** Verificar la **paridad put-call**: `C − P = S − K·e^(−rT)` → `4.8771 = 4.8771` ✔.

Estos mismos valores están en la prueba `tests/cores.test.cjs → 'blackscholes: valores de libro'`.

**En la app:** T se mide en días naturales / 365; r se obtiene de las letras del Tesoro (`tesoro.client.js`, ADR-016);
la **volatilidad implícita** se recupera invirtiendo la fórmula por bisección en [0.0001, 5].

## 2.3 Las griegas

| Griega | Mide | Fórmula (call) | Lectura práctica |
|---|---|---|---|
| **Delta Δ** | ∂V/∂S | `N(d1)` (put `N(d1) − 1`) | Δ 0.53 ≈ tener 53 acciones por contrato |
| **Gamma Γ** | ∂²V/∂S² | `φ(d1)/(S·σ·√T)` | Qué tan rápido cambia la delta |
| **Theta Θ** | ∂V/∂t | `−S·φ(d1)·σ/(2√T) − r·K·e^(−rT)·N(d2)` | Pérdida diaria por el paso del tiempo |
| **Vega** | ∂V/∂σ | `S·φ(d1)·√T` | Ganancia por +1 punto de volatilidad |
| **Rho** | ∂V/∂r | `K·T·e^(−rT)·N(d2)` | Sensibilidad a la tasa |

Ejemplo ATM (S = K = 100, 30 días, σ 30 %, r 4 %): precio 3.5911, Δ 0.5324, Γ 0.0462, Θ −0.0624/día, vega 0.114.
Comprobación: si S pasa de 100 a 101, el precio real sube 0.5553 ≈ Δ + ½Γ.

## 2.4 Estrategias asignadas (detalle paso a paso)

### A) Long Call — expectativa alcista
| Elemento | Valor |
|---|---|
| Patas | 1: **comprar call** (`buy_to_open`) |
| Pérdida máxima | prima × 100 |
| Ganancia máxima | ilimitada |
| Breakeven | K + prima |
| Griegas | Δ +, Θ − (el tiempo juega en contra), vega + |

**Paso a paso:** (1) confirmar sesgo alcista con los cores → (2) elegir vencimiento (la app sugiere el más cercano dentro de
7–60 días) → (3) elegir el strike más cercano al precio (ATM) → (4) orden **límite** a la mid → (5) definir salida.
**Ejemplo:** K = 100, prima 3.60: pérdida máx. 360 USD, breakeven 103.60; con S_T = 110 gana 640 USD.

### B) Long Put — expectativa bajista
| Elemento | Valor |
|---|---|
| Patas | 1: **comprar put** |
| Pérdida máxima | prima × 100 |
| Ganancia máxima | (K − prima) × 100 (si la acción llega a 0) |
| Breakeven | K − prima |

**Ejemplo:** K = 100, prima 3.00: pérdida máx. 300, breakeven 97, ganancia máx. 9 700 USD.

### C) Iron Condor — expectativa neutral (rango)
```
 compra put K1  <  vende put K2  <  vende call K3  <  compra call K4      (mismo vencimiento y cantidad)
```
| Elemento | Fórmula |
|---|---|
| Crédito c | prima(K2) + prima(K3) − prima(K1) − prima(K4) |
| Ganancia máxima | c × 100 (si K2 ≤ S_T ≤ K3) |
| Pérdida máxima | (ancho − c) × 100, ancho = máx(K2 − K1, K4 − K3) |
| Breakevens | K2 − c y K3 + c |
| Griegas | Δ ≈ 0, Θ + (el tiempo juega a favor), vega − |

**Paso a paso (como lo arma la app, `web/src/utils/estrategiasOrden.js`):**
1. Vencimiento: convención 30–45 días (theta apreciable, gamma moderada).
2. Patas cortas: put y call con **|Δ| más cercano a 0.20** (≈ 20 % de quedar ITM cada una).
3. Alas: a ≈ **2.5 % del precio** de la pata corta, hacia fuera.
4. Precio: crédito neto a la mid, redondeado (0.01 si < 3; 0.05 si ≥ 3).
5. Orden multi-pata **límite** con crédito.

**Ejemplo:** 90/95/105/110 con primas 0.60/1.50/1.40/0.50 → c = 1.80, ganancia máx. 180, pérdida máx. 320,
breakevens 93.20 y 106.80. Caso real TSLA: crédito 2.97, ganancia 297, pérdida 703, breakevens 349.53/410.47.

### Probabilidad de ganancia (neutral al riesgo)
`P[S_T > X] = N(d2)` con K = X. Long Call 0.34 · Long Put 0.37 · Iron Condor 0.58 (ejemplo de `scripts/guia/ejemplos.cjs`).
El condor gana más seguido pero poco; los long ganan menos seguido pero mucho. **La probabilidad no incluye el tamaño.**

### Lo que dicen los datos reales (ADR-020)
Backtest con 2 856 casos (100 empresas, 30 vencimientos 2024-04 a 2026-11): Long Call ganó el 38 %, Long Put el 29 %, Iron Condor
el 67 % de las veces; **ningún puntaje anticipó el resultado**. Por eso la app insiste: «no es la probabilidad de ganar».

## 2.5 Catálogo completo de estrategias

| Estrategia | Patas | Vista | Débito/Crédito | Pérdida máx. | Régimen de IV ideal |
|---|---|---|---|---|---|
| **Long Call** ★ | +C | Alcista fuerte | Débito | Prima | IV baja |
| **Long Put** ★ | +P | Bajista fuerte | Débito | Prima | IV baja |
| **Iron Condor** ★ | +P −P −C +C | Neutral (rango) | Crédito | Ancho − crédito | IV alta |
| Bull Call / Bear Put Spread | +C −C / +P −P | Alcista / bajista moderada | Débito | Débito pagado | Media |
| Bull Put / Bear Call Spread | −P +P / −C +C | Alcista / bajista moderada | Crédito | Ancho − crédito | Alta |
| Iron Butterfly | +P −P −C +C (cortas al mismo strike ATM) | Neutral, precio fijo | Crédito | Ancho − crédito | Alta |
| Butterfly | +1 −2 +1 (mismo tipo) | Neutral en un punto | Débito | Débito | Media–alta |
| Condor | +1 −1 −1 +1 (mismo tipo) | Neutral en un rango | Débito | Débito | Media–alta |
| Long Straddle / Strangle | +C +P (mismo / distinto strike) | Gran movimiento, sin dirección | Débito | Primas | IV baja (antes de un evento) |
| Short Straddle / Strangle | −C −P | Calma total | Crédito | **Ilimitada** | IV muy alta |
| Calendar | −corto plazo +largo plazo, mismo strike | Neutral; aprovecha theta | Débito | Débito | IV baja a largo plazo |
| Diagonal | Calendar con strikes distintos | Direccional suave | Débito | Débito | Media |
| Protective Put | +100 acciones +P | Seguro de una posición | Débito | Acotada | Baja |
| Collar | +acciones +P −C | Cobertura con costo ≈ 0 | ≈ 0 | Acotada | Cualquiera |
| Covered Straddle / Strangle | +acciones −C −P | Ingreso extra | Crédito | Alta | Alta |
| **Wheel** | Vender put garantizado → si asignan, covered call | Ingreso repetitivo | Crédito | Alta (acciones) | Alta |

★ = asignadas al equipo e implementadas en `ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']`.
Los adaptadores de Webull ya reconocen VERTICAL, STRADDLE, STRANGLE, CALENDAR, DIAGONAL, BUTTERFLY, CONDOR, IRON_BUTTERFLY e
IRON_CONDOR, lo que facilita agregar más estrategias en el futuro.

## 2.6 Selección por régimen de volatilidad

**Paso 1.** Medir la volatilidad histórica `HV20` (core indicadores).
**Paso 2.** Medir la volatilidad implícita `IV` promedio de contratos a ±5 % del dinero.
**Paso 3.** Calcular `IV/HV20`:

| IV/HV20 | Lectura | Estrategias favorecidas | Ajuste que aplica la app al Iron Condor |
|---|---|---|---|
| < 0.9 | Opciones «baratas» | Comprar: Long Call / Long Put / Straddle | −7.5 a −15 |
| 0.9 – 1.1 | Normal | Spreads de débito o crédito | ≈ 0 |
| > 1.1 | Opciones «caras» | Vender prima: Iron Condor, spreads de crédito | +7.5 a +15 |

Fórmula: `ajuste = clamp((IV/HV20 − 1)/0.2, −1, 1) · 15` (`confluencia.core.js`).
**Paso 4.** Combinar con la dirección de los cores (sección 4): sesgo alcista → Long Call; bajista → Long Put; neutral y IV alta → Iron Condor.

## Resumen
Una opción es un derecho con precio (prima) que depende de S, K, T, σ y r. Black-Scholes y las griegas explican ese precio. Long
Call y Long Put apuestan por dirección con pérdida limitada a la prima; el Iron Condor cobra un crédito si el precio se queda en un
rango. La relación IV/HV indica si conviene comprar o vender prima.
