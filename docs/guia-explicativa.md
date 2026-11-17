# Guía explicativa del proyecto (para defender el código ante un revisor)

Fecha: 2026-11-17. Fuente de verdad: el código en `src/` y `web/src/`. Todo número, constante, peso, archivo y función de esta guía
se tomó del código (versiones `tecnico@1.1.0`, `indicadores@1.1.0`, `fundamental@1.1.0`, `institucional@1.1.0`, `noticias@1.1.0`,
`confluencia@1.1.0`, `estrategias@1.1.0`, `blackscholes@1.0.0`, `reglas@1.0.0`, `lexico@1.1.0`). Los ejemplos numéricos marcados
«(verificado)» se ejecutaron con `node` sobre `dist/` el 2026-11-17, después de `npm.cmd test` (116 pruebas aprobadas).
Cuando algo **no** se pudo verificar en el código, se dice explícitamente.

Documentos complementarios: `docs/version-funcional/cores-inventario.md` (inventario exacto), `docs/decisiones/README.md` (ADR-001…012),
`docs/version-funcional/contratos.md` (contratos), `docs/version-funcional/plan.md` (bitácora).

---

## Índice
1. Resumen en una página
2. Glosario de inversiones para programadores
3. Fundamentos matemáticos usados
4. Contrato común de un core (ADR-001)
5. Los cinco cores (técnico, indicadores, fundamental, institucional, noticias)
6. Confluencia y selección (ADR-002, ADR-012)
7. Evaluación de configuraciones (estrategias + Black-Scholes)
8. De la recomendación a la orden paper
9. Fijo vs variable (tabla consolidada)
10. Limitaciones y decisiones abiertas
11. Preguntas probables del revisor
12. Mapa de archivos y cómo ejecutar pruebas

---

## 1. Resumen en una página

**Qué hace.** Es una API REST (Express) con interfaz web (React + Vite) que, para una acción de EE. UU.:
1. **Sincroniza datos reales** de Alpaca (velas diarias, cotización, cadena de opciones con IV y griegas, noticias) y de la SEC
   (estados financieros XBRL y tenencias 13F) y los guarda en la base elegida en la sesión (MongoDB o Supabase).
2. Ejecuta **5 cores de análisis** (funciones puras): técnico, indicadores, fundamental, institucional y noticias. Cada uno devuelve
   un **sesgo** direccional en [−1, 1], una **confianza** en [0, 1], una **cobertura** y un **puntaje = 50 + 50·sesgo**.
3. La **confluencia** combina los cores y calcula la **compatibilidad (0–100)** con tres estrategias de opciones:
   Long Call (alcista), Long Put (bajista) e Iron Condor (neutral).
4. La **selección** ordena empresas/estrategias por esa compatibilidad.
5. El usuario puede armar una **configuración** con contratos reales y evaluarla (payoff, breakevens, Black-Scholes, probabilidad de ganancia).
6. El botón **«Operar»** arma las patas, muestra un **ticket** y envía la orden a **Alpaca paper** (dinero simulado; live bloqueado en código).

**No es una recomendación de inversión**: los pesos son heurísticos, no hay backtesting y las probabilidades son neutrales al riesgo.

### Flujo completo
```
Sincronización (proveedores → base)            Análisis (base → cores puros)                       Operación (paper)
──────────────────────────────────            ───────────────────────────────                     ─────────────────
Alpaca /v2/stocks/bars (IEX) ──► datos-mercado(vela) ──┐
Alpaca options contracts+snapshots ► contratos +       ├─► insumos() ─► tecnico.evaluar()     ─┐
   datos-mercado(snapshot_opcion)                      │             indicadores.evaluar() ─┤
Alpaca /v1beta1/news ──────────► noticias ─────────────┤             fundamental.evaluar() ─┼─► confluencia.evaluar(estrategia)
SEC companyfacts (XBRL) ───────► fundamentales ────────┤             institucional.evaluar()┤      × {LONG_CALL, LONG_PUT, IRON_CONDOR}
SEC 13F-HR (9 filers) ─────────► institucional ────────┘             noticias.evaluar()    ─┘              │
                                                                                                           ▼
                                                    selección: orden por puntaje desc. (desempate cobertura)
                                                                                                           │
                         configuración con contratos reales ◄── «Operar» (estrategiasOrden.js) ◄───────────┘
                         estrategias.evaluarConfiguracion() + blackscholes.js
                                          │
                                          ▼
                         POST /ordenes/ticket (Idempotency-Key) ─► Alpaca paper POST /v2/orders ─► sincronizar órdenes/posiciones
```

### Arquitectura
```
┌──────────────────────────── Navegador ────────────────────────────┐
│ React + Vite (web/src)  · páginas Analizar, Mercado, Broker, ...  │
│ utils/estrategiasOrden.js (arma patas)  · TicketOrden.jsx         │
└──────────────▲──────────────────────────────────────┬─────────────┘
               │ JSON  (Authorization: Bearer)         │
┌──────────────┴──────────────────────────────────────▼─────────────┐
│ API Express  /api/v1  (src/app.js, src/api/v1/routes, controllers)│
│  services: analisis · sincronizacion · operacion · broker · CRUD  │
│  cola de trabajos en memoria (src/jobs/cola.js, concurrencia 2)   │
│   POST → 202 + registro "pendiente" → sondeo GET (ADR-003)        │
│  src/cores/*.js  (funciones puras: sin red, sin BD, sin reloj)    │
└──────┬───────────────────────────────┬──────────────────┬─────────┘
       │ repositorios (src/repositories)│                  │ adaptadores (src/integrations)
┌──────▼──────────┐   ┌────────────────▼──┐   ┌───────────▼───────────────────────────────┐
│ MongoDB         │ o │ Supabase (Postgres│   │ alpaca.client.js: data.alpaca.markets      │
│ (mongoose)      │   │ tablas api_*)     │   │   + paper-api.alpaca.markets (solo paper)  │
└─────────────────┘   └───────────────────┘   │ sec.client.js: data.sec.gov / www.sec.gov  │
                                              │ institucionales.js: 9 filers 13F           │
                                              └────────────────────────────────────────────┘
```

---

## 2. Glosario de inversiones para programadores

| Término | Definición | Ejemplo numérico |
|---|---|---|
| Acción | Parte de la propiedad de una empresa que cotiza en bolsa. | 10 acciones de AAPL a 230 USD = 2 300 USD. |
| Ticker / símbolo | Código corto de un valor. En el código `empresa.simbolo`. | `AAPL`, `NVDA`, `MSFT`. |
| Vela OHLCV | Resumen de un intervalo: apertura (Open), máximo (High), mínimo (Low), cierre (Close), volumen. En el código: `{fecha, apertura, maximo, minimo, cierre, volumen}`. Intervalo usado: diario (`1Day`). | O=100, H=103, L=99, C=102, V=1.2 M. |
| Volumen | Número de acciones negociadas en el intervalo. Con feed IEX es el volumen de **un solo mercado**. | Volumen 1 400 vs promedio 1 200 → volumen relativo 1.17. |
| Opción | Contrato que da el **derecho** (no la obligación) a comprar o vender el subyacente a un precio fijo hasta una fecha. | — |
| Call | Derecho a **comprar** a K. Gana si el precio sube. | Call K=100; al vencimiento S=110 → vale 10 por acción. |
| Put | Derecho a **vender** a K. Gana si el precio baja. | Put K=100; S=92 → vale 8. |
| Strike (K) | Precio de ejercicio. En el código `contrato.strike`. | 100. |
| Vencimiento | Fecha en que expira el contrato. El código asume cierre a las 20:00 UTC (`HORA_VENCIMIENTO_UTC`). | `2026-12-18`. |
| Prima | Precio de la opción **por acción**. En el código `precio` (en la app = mid del snapshot). | 3.60. |
| Contrato ×100 | Un contrato de acciones de EE. UU. cubre 100 acciones (`multiplicador = 100`). | Prima 3.60 → cuesta 360 USD. |
| Bid / Ask | Mejor precio de compra (bid) y de venta (ask) publicados. | bid 5.80, ask 6.75. |
| Spread | ask − bid; costo implícito de entrar y salir. | 0.95 (caso real del smoke de ejecución: −80 USD al comprar y vender). |
| Mid | (bid + ask)/2; precio de referencia (`mid()` en `estrategiasOrden.js`, `(s.bid + s.ask)/2` en `analisis.service.js`). | (5.80+6.75)/2 = 6.275. |
| ITM / ATM / OTM | Dentro / en / fuera del dinero. Call ITM si S > K; put ITM si S < K; ATM si S ≈ K. | S=100: call K=95 ITM, K=100 ATM, K=105 OTM. |
| Valor intrínseco | Lo que valdría ejercer ya: call `max(0, S − K)`, put `max(0, K − S)` (`valorIntrinseco` en `estrategias.core.js`). | Call K=95, S=100 → 5. |
| Valor extrínseco | Prima − intrínseco (valor tiempo + volatilidad). | Prima 6.20 − 5 = 1.20. |
| Volatilidad histórica (HV) | Desviación estándar anualizada de los retornos **pasados** (`volatilidadHistorica` en `util.js`). | σ diaria 2 % → 2 %·√252 = 31.7 % anual. |
| Volatilidad implícita (IV) | Volatilidad que, metida en Black-Scholes, reproduce la prima de mercado; es la expectativa del mercado. Viene de Alpaca (`impliedVolatility`, fracción anual). | IV 0.30 = 30 % anual. |
| Delta (Δ) | Cambio de la prima por 1 USD del subyacente; aprox. "acciones equivalentes" por acción. Call 0..1, put −1..0. | Δ 0.53 → 1 contrato ≈ 53 acciones. |
| Gamma (Γ) | Cambio de delta por 1 USD del subyacente. | Γ 0.0188 (ejemplo de libro). |
| Theta (Θ) | Pérdida de valor por paso del tiempo; en el código **por día natural** (anual/365). | Θ −0.0176 USD/día por acción (ejemplo de libro). |
| Vega | Cambio de la prima por **1 punto** de volatilidad (anual/100). | Vega 0.375 → si IV sube de 20 % a 21 %, la prima sube ≈ 0.375. |
| Rho | Cambio de la prima por 1 punto porcentual de tasa. | Rho 0.532 (ejemplo de libro). |
| Long Call | Comprar 1 call. Pérdida máx. = prima; ganancia ilimitada; breakeven `K + prima`. | K=100, prima 3.60 → pérdida máx 360 USD, breakeven 103.60. |
| Long Put | Comprar 1 put. Pérdida máx. = prima; ganancia máx. `(K − prima)·100`; breakeven `K − prima`. | K=100, prima 3 → ganancia máx 9 700, breakeven 97. |
| Iron Condor | 4 patas, mismo vencimiento: **compra put K1 < vende put K2 < vende call K3 < compra call K4**. Cobra un crédito; gana si el precio se queda entre K2 y K3. Ancho de alas = `max(K2−K1, K4−K3)`. Ganancia máx = crédito; pérdida máx = ancho − crédito; breakevens `K2 − crédito` y `K3 + crédito`. | 90/95/105/110 con crédito 1.80 → gana máx 180, pierde máx 320, breakevens 93.20 y 106.80 (verificado). |
| Orden market | Se ejecuta al mejor precio disponible; sin control de precio. | Compra market ejecutada a 6.65 (smoke real). |
| Orden limit | Solo se ejecuta a `limit_price` o mejor. | Limit 0.01 en un call de 6 USD: no se ejecuta (smoke de orden). |
| day / gtc | Vigencia (`time_in_force`): `day` expira al cierre de la sesión; `gtc` hasta cancelar. | `vigencia` por defecto `day`. |
| Multi-pata (mleg) | Una sola orden con varias patas que se ejecutan juntas (`order_class: 'mleg'`). | Iron Condor = 4 patas en una orden. |
| Débito / crédito | Débito: pagas prima neta (compras). Crédito: recibes prima neta (vendes más de lo que compras). En `estrategias.core.js`: `prima_neta > 0` = crédito. | Long Call: prima_neta −360 (débito). IC: +180 (crédito). |
| buy_to_open / sell_to_open / buy_to_close / sell_to_close | Intención de la pata (`position_intent`): abrir o cerrar una posición comprando o vendiendo. | Cerrar un long call → `sell_to_close`. |
| Posición long / short | Long = compraste (ganas si sube el valor del contrato). Short = vendiste (ganas si baja). | Vender un put abre un short put. |
| Paper trading | Cuenta simulada del broker: órdenes reales contra el mercado, dinero ficticio. | URL fija `https://paper-api.alpaca.markets`. |
| 10-K / 10-Q | Informes anuales / trimestrales presentados a la SEC. El código acepta `10-K`, `10-Q`, `10-K/A`, `10-Q/A`. | — |
| XBRL | Formato estructurado (etiquetas) de los estados financieros; la SEC lo publica en `companyfacts`. | — |
| us-gaap | Taxonomía de conceptos contables de EE. UU. dentro del XBRL. | `Revenues`, `NetIncomeLoss`, `Liabilities`. |
| Formulario 13F (13F-HR) | Informe trimestral de tenencias de grandes gestores institucionales; se presenta hasta 45 días después del cierre del trimestre. | Corte 2026-06-30, presentado 2026-08-10. |
| CIK | Identificador de 10 dígitos de un registrante en la SEC (`formatearCik`). | BlackRock, Inc. = `0002012383`. |
| CUSIP | Identificador de 9 caracteres de un valor. El adaptador acepta `cusip`, pero **la sincronización no lo envía**: coincide por nombre de emisor. | — |
| Sentimiento | Tono positivo/negativo de un texto; aquí, léxico propio (`lexico.js`). | "beats" +1.5, "plunge" −2. |
| Sesgo | Dirección estimada por un core: −1 bajista, 0 neutral, +1 alcista. | 0.79 = claramente alcista. |
| Look-ahead bias | Usar información que **no se conocía** en la fecha simulada (p. ej. un 10-Q presentado después). Invalida un análisis histórico. | Usar el cierre de mañana para decidir hoy. |

---

## 3. Fundamentos matemáticos usados

| Concepto | Fórmula | Dónde | Por qué se usa |
|---|---|---|---|
| Media simple (SMA) | `SMA_n = (1/n)·Σ_{i=t−n+1..t} x_i` | `util.sma`, `util.smaSerie` | Tendencia (SMA50/200), media de Bollinger. |
| Media exponencial (EMA) | `e_t = α·x_t + (1 − α)·e_{t−1}`, `α = 2/(n+1)`, semilla = SMA de los primeros n | `util.emaSerie`, `util.ema` | MACD (EMA12, EMA26, EMA9). Ej.: n=12 → α = 0.1538. |
| Suavizado de Wilder | `m_t = (m_{t−1}·(n−1) + x_t)/n` (equivale a EMA con `α = 1/n`), semilla = promedio simple de los primeros n | `util.rsi`, `util.atr` | Definición original de RSI y ATR (Wilder 1978). n=14 → α = 0.0714. |
| Retorno logarítmico | `r_t = ln(C_t / C_{t−1})` | `util.volatilidadHistorica` | Aditivo en el tiempo y coherente con el modelo lognormal de Black-Scholes. |
| Desviación estándar | Poblacional `√(Σ(x−x̄)²/n)`; muestral `√(Σ(x−x̄)²/(n−1))` | `util.desviacion(valores, muestral)` | Bollinger usa la **poblacional** (definición de Bollinger); HV usa la **muestral** (estimador estadístico). |
| Anualización √252 | `σ_anual = σ_diaria·√252` | `volatilidadHistorica(…, anual = 252)` | Si los retornos diarios son independientes, la varianza escala con el tiempo; 252 ≈ sesiones bursátiles por año (NYSE). √252 = 15.87. |
| Regresión lineal (pendiente) | `b = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)²`, con `x = 0..n−1` | `util.pendienteRegresion` | Dirección de 20 cierres sin depender de un solo día. |
| Acotación (clamp) | `clamp(x, a, b) = min(b, max(a, x))`, por defecto [−1, 1] | `util.clamp` | Mapeos lineales que deben saturar (cruce, deuda/capital, %B, razón corriente). |
| Tangente hiperbólica | `tanh(x/escala)` ∈ (−1, 1); `tanh(1) = 0.7616`, `tanh(2) = 0.9640` | cores técnico, indicadores, fundamental, institucional | Mapeo suave y simétrico a [−1, 1] que satura: con x = escala la señal vale 0.76. |
| Media ponderada | `x̄_w = Σ w_i x_i / Σ w_i` | `util.combinar`, `confluencia.estadisticos`, noticias | Sesgo de un core (pesos = pesoBase) y de la confluencia (pesos = peso·confianza). |
| Desviación estándar ponderada | `D = √(Σ w_i (x_i − x̄_w)² / Σ w_i)` | `confluencia.estadisticos` | Medir el **desacuerdo** entre cores (ADR-012). Como `s ∈ [−1, 1]`, D ∈ [0, 1]. |
| Decaimiento exponencial con vida media | `peso(edad) = 0.5^(edad/h) = e^(−λ·edad)`, `λ = ln2/h` | `noticias.core.js` | Una noticia de hace h días pesa la mitad. h = 3 → λ = 0.2310/día; 1 día → 0.7937; 2 días → 0.6300. |
| Saturación exponencial | `1 − e^(−x/2)` | confianza de noticias | Más peso efectivo → más confianza, con techo 1. |
| Distribución lognormal | `ln S_T ~ N(ln S + (r − q − σ²/2)T, σ²T)` | supuesto de Black-Scholes | Precios positivos y retornos log normales; base de `probabilidadSobre`. |
| Black-Scholes-Merton | Ver abajo | `src/cores/blackscholes.js` | Verificar griegas/IV de Alpaca y estimar probabilidad de ganancia. |

### Black-Scholes en detalle (`src/cores/blackscholes.js`)

**Supuestos**: opción europea (solo se ejerce al vencimiento), volatilidad σ y tasa r constantes, sin costos ni spreads,
precio lognormal (movimiento browniano geométrico), dividendo continuo q (el código usa q = 0).

- `d1 = [ln(S/K) + (r − q + σ²/2)·T] / (σ·√T)`, `d2 = d1 − σ·√T` (`d1d2`; exige S, K, T, σ > 0, si no devuelve `null`).
- Call `= S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2)`; Put `= K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)` (`opcion`).
- **N(x)**: aproximación de **Abramowitz & Stegun 26.2.17** (`cdf`):
  `t = 1/(1 + 0.2316419·|x|)`,
  `1 − N(|x|) = φ(|x|)·t·(0.319381530 + t(−0.356563782 + t(1.781477937 + t(−1.821255978 + 1.330274429·t))))`,
  error absoluto < 7.5·10⁻⁸; para x < 0 se usa simetría. `φ(x) = e^(−x²/2)/√(2π)` (`pdf`).
  Comprobación: `cdf(0) = 0.5000000005`, `cdf(1.96) = 0.97500217` (verificado).
- Griegas (`opcion`): delta call `e^(−qT)N(d1)`, put `e^(−qT)(N(d1) − 1)`; gamma `e^(−qT)φ(d1)/(Sσ√T)`;
  theta **por día** = θ_anual/365 con θ_anual call `−Sφ(d1)σe^(−qT)/(2√T) − rKe^(−rT)N(d2) + qSe^(−qT)N(d1)`;
  vega **por punto** = `S·e^(−qT)·φ(d1)·√T/100`; rho por punto = `K·T·e^(−rT)·N(d2)/100` (put con signo y N(−d2)).
- **N(d2) = probabilidad neutral al riesgo** de terminar ITM (call): P[S_T > K] bajo una deriva igual a r, no la deriva real
  (`probabilidadITM`, `probabilidadSobre`).
- IV inversa (`volatilidadImplicita`): bisección en [0.0001, 5] hasta |precio − objetivo| < 1e-6, máx. 200 iteraciones; `null` si
  el precio está fuera de los límites sin arbitraje.

**Ejemplo de libro (verificado, y es una prueba en `tests/cores.test.cjs`)**: S = 100, K = 100, T = 1, r = 0.05, σ = 0.20 →
d1 = 0.35, d2 = 0.15; **call 10.4506**, **put 5.5735**, **Δ call 0.6368** (put −0.3632), N(d2) = 0.5596, gamma 0.018762,
vega 0.3752/punto, theta −0.01757/día, rho 0.5323/punto; la IV recuperada desde 10.4506 es 0.2000.
Paridad put-call: 10.4506 − 5.5735 = 4.8771 = 100 − 100·e^(−0.05) ✓.

---

## 4. Contrato común de un core (ADR-001)

**Pureza (ADR-001).** Cada core es `evaluar(input) → resultado`, síncrono, sin red, sin base, sin `Date.now()`, sin azar.
"Hoy" es `input.fechaReferencia` (el servicio pasa `new Date().toISOString()`). Mismo input → mismo output.

Cada core exporta:
| Export | Qué es |
|---|---|
| `VERSION` | `core@semver`; se guarda en la Evaluación como `versionAlgoritmo`. |
| `REQUIERE` | Insumos que necesita (`'x?'` = opcional). El servicio solo carga esos. |
| `SENALES` | Catálogo `[{nombre, etiqueta, descripcion, pesoBase}]`, publicado en `GET /cores/catalogo` (ADR-010). |
| `evaluar(input)` | Devuelve `{ sesgo, confianza, puntaje, cobertura, metricas, motivos, datosFaltantes, reglas }`. |

**Entrada** (`contratos.md` §1): `{ simbolo, fechaReferencia, velas[], fundamentales[], reportes[], noticias[], opciones[], parametros, reglas[] }`.

**Salida**:
| Campo | Rango | Significado |
|---|---|---|
| `sesgo` | [−1, 1] o `null` | Dirección (null = sin datos suficientes). |
| `confianza` | [0, 1] | Fuerza y consistencia de la señal, ya multiplicada por la cobertura. |
| `cobertura` | [0, 1] | Fracción de sub-señales calculables. |
| `puntaje` | [0, 100] o `null` | `round(50 + 50·sesgo, 2)` **después** de reglas. Índice direccional, NO compatibilidad. |
| `metricas` | `[{nombre, valor, unidad, periodo?}]` | Valores finitos redondeados a 4 decimales; incluye `sesgo`, `confianza`, `cobertura`. |
| `motivos` | texto | Explicaciones en español. |
| `datosFaltantes` | texto | P. ej. `velas<200`, `fundamentales.periodo_comparable_yoy`. |
| `reglas` | `[{criterio, cumplida, valor}]` | Evaluación de reglas del perfil. |

### `util.combinar(subsenales)` — fórmulas exactas
Entrada: `[{nombre, valor ∈ [−1,1] | null, peso = pesoBase}]`. Sea V las válidas (valor numérico y peso > 0), n el total.
- `cobertura = |V| / n`
- `sesgo = clamp( Σ_V p·v / Σ_V p )`
- `consistencia = |Σ_V p·v| / Σ_V p·|v|` (1 si todas apuntan igual; 0 si se cancelan; 0 si Σp|v| = 0)
- `intensidad = Σ_V p·|v| / Σ_V p` (qué tan lejos de 0 están)
- `confianza = clamp( cobertura · (0.5·consistencia + 0.5·intensidad), 0, 1 )`
- Sin válidas: `sesgo = null`, `confianza = 0`.

### `util.filtrarSenales(lista, parametros)` (ADR-010)
Si `parametros.indicadores` contiene **al menos una** señal de este core, solo esas entran en `combinar` (cobertura y confianza se
calculan sobre la lista reducida) y se agrega el motivo «Señales usadas: … (selección del usuario).». Si no contiene ninguna, se usan todas.
Las métricas se reportan siempre.

### `util.finalizar(...)`
1. Descarta métricas no finitas (`metrica()` devuelve null — "no se inventan datos").
2. Agrega `sesgo` (si no es null), `confianza`, `cobertura` como métricas.
3. `aplicarReglas` (abajo).
4. `sesgo = round(sesgo_tras_reglas, 4)`; `puntaje = round(50 + 50·sesgo, 2)`.

### Reglas del perfil (`src/cores/reglas.js`, `reglas@1.0.0`)
Regla = `{ core, criterio (nombre de una métrica del core), operador, valorReferencia, valorSuperior?, peso ≥ 0, obligatoria, activo }`.

| Operador | Condición (tolerancia 1e-9) |
|---|---|
| `eq` / `ne` | `|v − ref| ≤ 1e-9` / `> 1e-9` |
| `gt` / `gte` | `v > ref` / `v ≥ ref − 1e-9` |
| `lt` / `lte` | `v < ref` / `v ≤ ref + 1e-9` |
| `between` | `ref − 1e-9 ≤ v ≤ sup + 1e-9` (si `sup < ref`, mal formada) |

Efecto (`aplicarReglas`): `puntaje₀ = 50 + 50·sesgo`, dirección `d = signo(sesgo)`.
- No obligatoria evaluable: `puntaje += (cumplida ? +1 : −1)·d·peso`. Con sesgo 0 no hay ajuste. Puede cruzar 50.
- Obligatoria incumplida: al final `puntaje = 50`, `confianza = 0`, motivo «Regla obligatoria incumplida… Resultado forzado a neutral.».
- Métrica inexistente: `cumplida = null` y `metrica:<criterio>` en `datosFaltantes`. Mal formada: se ignora con motivo.
- `puntaje = clamp(puntaje, 0, 100)`; `sesgo_final = (puntaje − 50)/50` (para que `puntaje = 50 + 50·sesgo` siga siendo exacto).

Ejemplo: core técnico con sesgo 0.40 (puntaje 70) y regla no obligatoria del mismo core `precio_vs_sma200 gt 0`, peso 5, cumplida →
puntaje 75 → sesgo 0.50. Si fuera obligatoria e incumplida → puntaje 50, sesgo 0, confianza 0.

---

## 5. Los cinco cores

> Patrón de todos: sub-señales → mapeo a [−1, 1] → `filtrarSenales` → `combinar` → `finalizar`. Todos los `pesoBase`, escalas y
> umbrales son **heurísticas de experto documentadas en el código**, no ajustes estadísticos.

### 5.1 Core técnico — `src/cores/tecnico.core.js` (`tecnico@1.1.0`)

**Objetivo.** ¿La acción está en tendencia alcista o bajista? Solo tendencia y estructura de precio (los osciladores son del core indicadores, para no contar doble).

**Funciones**: `evaluar`; usa `util.limpiarVelas, sma, smaSerie, pendienteRegresion, promedio, clamp, combinar, filtrarSenales, finalizar`.
**Entrada**: `REQUIERE = ['velas']`. Colección `datos-mercado` (`tipo: 'vela'`, `intervalo` = `parametros.intervalo` o `1Day`).
Proveedor: Alpaca `GET /v2/stocks/bars`, `feed=iex`, `adjustment=split`, `sort=asc`; la sincronización trae 420 días por defecto (~290 sesiones).

**Métricas**
| Métrica | Fórmula | Ventana | Unidad |
|---|---|---|---|
| `precio_vs_sma50` | `(C/SMA50 − 1)·100` | 50 | % |
| `precio_vs_sma200` | `(C/SMA200 − 1)·100` | 200 | % |
| `cruce_sma50_200` | estado `signo(SMA50 − SMA200)` | 50/200 | estado ±1 |
| `diferencia_sma50_200` | `(SMA50/SMA200 − 1)·100` | 50/200 | % |
| `pendiente_20` | `pendienteRegresion(últimos 20 cierres) / promedio(esos 20)·100` | 20 | %/vela |
| `posicion_rango_52s` | `clamp((C − mín)/(máx − mín), 0, 1)` con máx/mín **intradía** | hasta 252 (mín. 60) | fracción |
| `distancia_maximo_pct` / `distancia_minimo_pct` | `(máx/C − 1)·100` / `(C/mín − 1)·100` | ídem | % |
| `volumen_relativo_20` | `V_último / promedio(V de las 20 velas previas)` | 20 | razón |

**Señales**
| Señal | Mapeo exacto | pesoBase | Justificación (comentario en el código) |
|---|---|---|---|
| `precio_vs_sma50` | `tanh(%/5)` | 1 | Tendencia de mediano plazo; 5 % es desvío "claro". |
| `precio_vs_sma200` | `tanh(%/10)` | **1.5** | Tendencia de largo plazo, la más persistente; se separa más del precio. |
| `cruce_sma50_200` | `estado·min(1, |dif|/5)` = `clamp(dif/5)` | 1 | Cruce dorado / de la muerte; 5 % de separación satura. |
| `pendiente_20` | `tanh(%/0.5)` | 1 | 0.5 %/vela ≈ 10 % al mes = tendencia fuerte. |
| `posicion_rango_52s` | `2·(pos − 0.5)` (lineal) | 0.75 | Cerca de máximos = fuerza relativa. |
| `volumen_relativo_20` | `signo(C_t − C_{t−1})·clamp(vr − 1, 0, 1)` | **0.5** | Solo confirma la dirección de la última vela; ruidoso (y IEX es parcial). |

**Constantes** (todas **fijas** en código; nadie las cambia desde la API)
| Constante | Valor | Por qué |
|---|---|---|
| `SMA_CORTA` / `SMA_LARGA` | 50 / 200 | Convención estándar de mediano/largo plazo. |
| `ESCALA_SMA50_PCT` / `ESCALA_SMA200_PCT` | 5 / 10 | Desvíos "claros" en gran capitalización (heurística). |
| `ESCALA_CRUCE_PCT` | 5 | Separación que satura el cruce. |
| `VENTANA_CRUCE_RECIENTE` | 20 | ≈ 1 mes bursátil; solo para el motivo de cruce reciente. |
| `VENTANA_PENDIENTE` / `ESCALA_PENDIENTE_PCT` | 20 / 0.5 | 1 mes; 0.5 %/vela es tendencia fuerte. |
| `VENTANA_52S` / `MIN_RANGO` | 252 / 60 | 52 semanas ≈ 252 sesiones; mínimo ~3 meses. |
| `VENTANA_VOLUMEN` | 20 | Promedio de 1 mes **excluyendo** la vela actual. |
| `UMBRAL_VOLUMEN_MOTIVO` | 1.5 | Solo texto del motivo. |

**Casos límite**: sin velas → `velas`; < 50 → `velas<50`; < 200 → `velas<200` (sin SMA200 ni cruce); < 20 → `velas<20`;
< 60 → `velas<60`; entre 60 y 251 → rango con menos velas y `velas<252`; volumen faltante o < 21 velas → `volumen<21`.
Si ninguna señal es calculable: «Sin velas suficientes para evaluar tendencia (mínimo 20).» y sesgo null.
`limpiarVelas` descarta velas con OHLC no finitos o fecha > `fechaReferencia`.

**Versión 1.1.0**: constantes con nombre y justificación; señales `SENALES` con `pesoBase` explícito (catálogo ADR-010).
(El inventario no documenta un cambio de fórmula del técnico en 1.1.0; el cambio fue de explicabilidad.)

**Ejemplo (verificado; serie sintética de las pruebas)**: 260 velas, `cierre_i = 100 + 0.5·i + 0.8·sin(i)`, máx = C + 1, mín = C − 1.
| Señal | Cruda | Valor | Peso |
|---|---|---|---|
| precio_vs_sma50 | 6.0028 % | tanh(1.2006) = 0.8338 | 1 |
| precio_vs_sma200 | 28.1171 % | 0.9928 | 1.5 |
| cruce_sma50_200 | dif 20.862 % | 1.0000 | 1 |
| pendiente_20 | 0.2202 %/vela | 0.4140 | 1 |
| posicion_rango_52s | 0.9922 | 0.9844 | 0.75 |
| volumen_relativo_20 | 1.1667 | 0.1667 | 0.5 |
Σp = 5.75; Σp·v = 4.5587 → **sesgo 0.7928**; consistencia 1, intensidad 0.7928, cobertura 1 → **confianza 0.8964**; **puntaje 89.64**.

**Limitaciones**: la última vela puede ser la sesión en curso (parcial); volumen IEX de un solo mercado; precios ajustados solo por split.

### 5.2 Core indicadores — `src/cores/indicadores.core.js` (`indicadores@1.1.0`)

**Objetivo.** Momentum (osciladores) y régimen de volatilidad. La volatilidad no tiene dirección: solo aporta cobertura y alimenta el ajuste del Iron Condor.

**Funciones**: `evaluar`, `senalOscilador`; usa `util.rsi, macd, estocastico, bollinger, atr, volatilidadHistorica`.
**Entrada**: `REQUIERE = ['velas', 'opciones?']`. Velas como el técnico. Opciones: colección `contratos` + `datos-mercado`
(`tipo: 'snapshot_opcion'`, el más reciente por contrato), **solo strikes a ±5 % del último cierre** (`insumos()` en `analisis.service.js`).
Proveedor: Alpaca `GET /v2/options/contracts` (strikes ±25 % del precio, vencimientos 7–60 días) y
`GET /v1beta1/options/snapshots/{subyacente}` con `feed=indicative` (`impliedVolatility`, `greeks`).

**Mapeo de osciladores `senalOscilador(v, bajo, alto)`** (continuo por tramos; atenúa en extremos, no invierte):
- `bajo ≤ v ≤ alto`: `(v − 50)/(alto − 50)` si v ≥ 50; `(v − 50)/(50 − bajo)` si v < 50.
- `v > alto`: `1 − (v − alto)/(100 − alto)` (de +1 en `alto` a 0 en 100).
- `v < bajo`: `−1 + (bajo − v)/bajo` (de −1 en `bajo` a 0 en 0).
Valores con RSI (30/70) (verificado): 0→0, 20→−0.667, 30→−1, 50→0, 60→0.5, 70→+1, 85→0.5, 100→0.
Interpretación: sobrecompra = momentum alcista **que se agota**; el código no apuesta a la reversión (no la invierte a negativo).

**Métricas y señales**
| Señal / métrica | Fórmula | Ventana | Unidad | Mapeo | pesoBase | Mín. velas |
|---|---|---|---|---|---|---|
| `rsi_14` | RSI de Wilder | 14 | índice 0–100 | `senalOscilador(RSI, 30, 70)` | 1 | 15 |
| `macd_hist` | `MACD − señal`, MACD = EMA12 − EMA26, señal = EMA9(MACD) | 12/26/9 | precio | `tanh((hist/C·100)/0.5)` | 1 | 34 |
| `estocastico_k` (+ `estocastico_d`) | `%K = (C − mín14)/(máx14 − mín14)·100` (50 si máx = mín); `%D` = promedio de los últimos 3 %K | 14/3 | índice | `senalOscilador(%K, 20, 80)` | 0.75 | 16 |
| `bollinger_pctb` | `%B = (C − inf)/(sup − inf)`, bandas `SMA20 ± 2σ_pob` | 20, 2 | fracción | `clamp(2·(%B − 0.5))` | 0.75 | 20 |
| `atr_pct` | `ATR14/C·100`, TR = `máx(H−L, |H−C_{t−1}|, |L−C_{t−1}|)` | 14 | % | no direccional | — | 15 |
| `hv_20`, `hv_60` | desv. muestral de retornos log ×√252 | 20 / 60 | fracción anual | no direccional | — | 21 / 61 |
| `iv_promedio` | promedio simple de IV de contratos **no vencidos** (venc ≥ ref − 1 día) con 0 < IV ≤ 5 | — | fracción anual | no direccional | — | — |
| `iv_hv_ratio` | `iv_promedio / hv_20` | — | razón | (alimenta la confluencia) | — | — |

**Cobertura y confianza (distintas de los otros cores)**:
`cobertura = (direccionales calculadas + volatilidades calculadas) / (n_direccionales + 3, o + 4 si hay opciones)`;
`confianza = confianza_combinar · cobertura / cobertura_direccional`; si `HV20/HV60 > 1.5` → `confianza × 0.8` y motivo «Volatilidad en expansión».

**Constantes** (fijas)
| Constante | Valor | Por qué |
|---|---|---|
| `RSI_N` | 14 | Definición de Wilder (1978). |
| `MACD_RAPIDA/LENTA/SENAL` | 12/26/9 | Definición de Appel. |
| `ESTOCASTICO_K/D` | 14/3 | Definición de Lane. |
| `BOLLINGER_N/K` | 20/2 | Definición de Bollinger. |
| `ATR_N` | 14 | Wilder. |
| `HV_CORTA` / `HV_LARGA` | 20 / 60 | ≈ 1 y 3 meses bursátiles. |
| `RSI_BAJO/ALTO`, `ESTOCASTICO_BAJO/ALTO` | 30/70, 20/80 | Zonas clásicas de sobreventa/sobrecompra. |
| `ESCALA_MACD_PCT` | 0.5 | Heurística: histograma de 0.5 % del precio = momentum marcado. |
| `UMBRAL_EXPANSION_HV` / `FACTOR_CONFIANZA_EXPANSION` | 1.5 / 0.8 | Heurística: los osciladores fallan más en rupturas. |
| `IV_MAXIMA` | 5 | IV > 500 % se trata como error del feed indicativo. |

**Casos límite**: `datosFaltantes` posibles `velas`, `velas<15`, `velas<34`, `velas<16`, `velas<20`, `velas<21`, `velas<61`,
`opciones.volatilidadImplicita`. Sin opciones el denominador de cobertura es 4 + 3 (IV no penaliza).

**Versión 1.1.0**: la IV ignora contratos vencidos y valores absurdos (> 5) — antes un contrato vencido o una IV errónea del feed
contaminaba `iv_promedio` (prueba «indicadores 1.1.0: IV ignora contratos vencidos y valores absurdos»).

**Ejemplo (verificado)**: 100 velas bajistas `cierre = 200 − 0.4·i + 0.8·sin(i)`: RSI 11.78 → señal −0.393 (sobreventa extrema
atenuada); MACD hist −0.0527 → ≈ −0.066; %K 13.36 → −0.668; %B 0.0205 → −0.959. Sesgo = (−0.393 − 0.066 − 0.75·0.668 − 0.75·0.959)/3.5
= **−0.4796**; consistencia 1, cobertura 7/7 → **confianza 0.7398**. HV20 0.0531, HV60 0.0503 (sin expansión).

**Limitaciones**: IV indicativa (no OPRA); la IV promedia todos los vencimientos guardados (7–60 días) mientras HV20 mira 20 sesiones
(horizontes distintos); no hay IV Rank porque solo se guarda el último snapshot por contrato.

### 5.3 Core fundamental — `src/cores/fundamental.core.js` (`fundamental@1.1.0`)

> **Aclaración importante: el core fundamental NO usa Black-Scholes.** Analiza estados financieros presentados a la SEC (XBRL us-gaap).
> Black-Scholes solo se usa en `estrategias.core.js` / `blackscholes.js` (evaluación de configuraciones de opciones).

**Objetivo.** ¿La empresa crece, es rentable, está apalancada, tiene liquidez?

**Funciones**: `evaluar`, `tipoPeriodo`; interno `valorDe`.
**Entrada**: `REQUIERE = ['fundamentales']`, colección `fundamentales` (campos que pasa el servicio: `periodoInicio, periodoFin, forma, metricas`).
Proveedor: SEC `GET https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` (`sec.client.js → construirFundamentales`),
formas 10-K, 10-Q, 10-K/A, 10-Q/A; se usan los *frames* calendario de la SEC (`CY2024`, `CY2024Q1`, instantes `CY2024Q1I`) para deduplicar
comparativos; máx. 12 periodos. CIK desde `https://www.sec.gov/files/company_tickers.json`.

**Conceptos us-gaap** (`METRICAS_SEC`, en orden de preferencia)
| Métrica | Tipo | Conceptos |
|---|---|---|
| ingresos | duración | `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, `RevenueFromContractWithCustomerIncludingAssessedTax` |
| utilidad_neta | duración | `NetIncomeLoss`, `ProfitLoss`, `NetIncomeLossAvailableToCommonStockholdersBasic` |
| activos | instante | `Assets` (sincronizado, no usado por el core) |
| pasivos | instante | `Liabilities` |
| capital | instante | `StockholdersEquity`, `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| activo_circulante / pasivo_circulante | instante | `AssetsCurrent` / `LiabilitiesCurrent` |
| flujo_operativo | duración | `NetCashProvidedByUsedInOperatingActivities`, `…ContinuingOperations` |
| eps_diluido | duración | `EarningsPerShareDiluted`, `EarningsPerShareBasicAndDiluted` |

**Selección de periodos**
1. Sin anticipación: cuenta si `fechaPresentacion ≤ ref` o, si no viene, `periodoFin ≤ ref`. **El servicio no pasa `fechaPresentacion`**,
   así que en producción se usa `periodoFin` (sin efecto práctico porque ref = ahora; sí importaría en un backtest).
2. Tipo por duración (`tipoPeriodo`): 330–400 días = anual; 80–100 = trimestral; otro = `otro`; sin fechas → por `forma`.
3. Periodo base = el anual/trimestral más reciente con ingresos.
4. Comparable = mismo tipo con cierre a `365 ± 25` días antes (anual vs anual; trimestre vs mismo trimestre del año previo). Nunca se mezclan duraciones.
5. Saldos (pasivos, capital, circulantes): periodo más reciente que tenga ambos valores.

**Señales**
| Señal | Fórmula | Unidad | Mapeo | pesoBase | Justificación |
|---|---|---|---|---|---|
| `crecimiento_ingresos_yoy` | `(I₀/I₁ − 1)·100`, I₁ > 0 | % | `tanh(g/10)` | **1.5** | Variable fundamental más persistente. |
| `crecimiento_utilidad_yoy` | `(U₀ − U₁)/|U₁|·100`, U₁ ≠ 0 | % | `tanh(g/20)` | 1 | Más volátil → escala mayor; `|U₁|` hace que pasar de pérdida a menor pérdida sea positivo. |
| `margen_neto` | `U₀/I₀·100`, I₀ > 0 | % | `tanh(m/10)` | 1 | 10 % ≈ mediana del S&P 500 (afirmación del comentario del código, no verificada aquí). |
| `deuda_capital` | `pasivos totales / capital`, capital > 0; capital ≤ 0 → −1 | razón | `clamp(1.5 − d)` | 1 | Pasivos ≈ 1.5× capital "típico": d = 0.5 → +1, 1.5 → 0, 2.5 → −1. |
| `razon_corriente` | `AC / PC`, PC > 0 | razón | `clamp(rc − 1)` | 0.75 | rc = 1 neutro; ≥ 2 sólido. |
| `margen_flujo_operativo` | `FO/I₀·100` | % | `tanh(m/15)` | 1 | El flujo suele superar a la utilidad. |
`eps_diluido` se reporta sin señal. Motivo fijo: «Pasivos totales se usan como aproximación de deuda…».

**Constantes** (fijas): `DIAS_ANUAL [330, 400]`, `DIAS_TRIMESTRAL [80, 100]`, `TOLERANCIA_YOY_DIAS 25` (años fiscales de 52/53 semanas),
escalas 10 / 20 / 10 / 15, `DEUDA_CAPITAL_NEUTRA 1.5`, `RAZON_CORRIENTE_NEUTRA 1`.

**Casos límite**: `fundamentales`, `fundamentales.periodo_flujo`, `fundamentales.periodo_comparable_yoy` y el nombre de cada señal no calculable.
El Q4 fiscal no se reporta como trimestre en XBRL (solo el anual) → si el último periodo es anual, se compara anual vs anual.

**Versión 1.1.0**: si el periodo trae `fechaPresentacion` posterior a la referencia, no se usa (anti look-ahead; prueba
«fundamental 1.1.0: un periodo presentado después de la referencia no se usa»).

**Ejemplo (verificado, datos sintéticos)**: Q3-2025 vs Q3-2024: ingresos 120 vs 100 (+20 % → tanh(2) = 0.964), utilidad 18 vs 15
(+20 % → tanh(1) = 0.762), margen neto 15 % (0.905), margen de flujo 20 % (0.871), deuda/capital 1.5 (0), razón corriente 1.5 (0.5).
Sesgo = (1.5·0.964 + 0.762 + 0.905 + 0 + 0.75·0.5 + 0.871)/6.25 = **0.6973**; confianza **0.8486**; puntaje **84.87**.

**Limitaciones**: `deuda_capital` usa pasivos totales (incluye proveedores, impuestos diferidos…), no deuda financiera; empresas con
capital negativo por recompras (p. ej. algunas grandes tecnológicas) reciben −1; no hay valuación (P/E, etc.).

### 5.4 Core institucional — `src/cores/institucional.core.js` (`institucional@1.1.0`)

**Objetivo.** ¿Los grandes gestores aumentaron o redujeron su posición entre los dos últimos trimestres?

**Funciones**: `evaluar`, `detectarSplit`; internos `mediana`, `agregar`.
**Entrada**: `REQUIERE = ['reportes']`, colección `institucional` (`fechaCorte, fechaPublicacion, tenencias`).
Proveedor: SEC `GET data.sec.gov/submissions/CIK##########.json` (2 cortes 13F-HR por filer) + `Archives/edgar/data/{cik}/{accn}/index.json`
→ tabla de información XML (`parsearTabla13F`). Coincidencia por **nombre de emisor normalizado** (`normalizarEmisor`, quita sufijos INC, CORP…;
el nombre viene de la SEC, que coincide mejor que el de Alpaca). Excluye filas `PRN` (bonos) y opciones (`putCall`).
**Filers** (`src/integrations/institucionales.js`, `FILERS_13F`, CIK verificados 2026-11-16): Vanguard Capital Management LLC (0002100119),
Vanguard Portfolio Management LLC (0002100121), BlackRock, Inc. (0002012383), State Street Corp (0000093751), FMR LLC (0000315066),
Berkshire Hathaway Inc (0001067983), Geode Capital Management, LLC (0001214717), Morgan Stanley (0000895421), JPMorgan Chase & Co (0000019617).

**Algoritmo**
1. Solo reportes con `fechaPublicacion ≤ ref` (si falta, `fechaCorte`). Reportes con igual `fechaCorte` se combinan.
2. Acciones por institución = suma por `identificadorInstitucion` (CIK).
3. Compara los dos cortes más recientes A (reciente) y B (previo); con < 2 → `reportes<2` / `reportes`, sin sesgo.
4. **Panel balanceado**: solo instituciones presentes en A y en B (comunes). Las nuevas/salen se informan pero no entran en la señal.
5. **Split**: razones `A_i/B_i` de las comunes; si hay ≥ 3 y la mediana está a ±5 % de f ∈ {2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50} (o 1/f), `B_i ← B_i·f`.

**Señales**
| Señal | Fórmula | Mapeo | pesoBase |
|---|---|---|---|
| `cambio_acciones_pct` | `(Σ_comunes A_i / Σ_comunes B_i·f − 1)·100` | `tanh(%/10)` | **1.5** |
| `amplitud_instituciones` | `(aumentan − disminuyen)/comunes` | identidad (ya en [−1, 1]) | 1 |
Métricas extra: `instituciones_aumentan/disminuyen/nuevas/salen/comunes/reportadas`, `factor_split`, `dias_desde_corte`.
`confianza = confianza_combinar × (dias_desde_corte > 135 ? 0.5 : 1)`.

**Constantes** (fijas): `DIAS_VIGENCIA 135` (45 días de plazo + 90 de trimestre), `FACTOR_CONFIANZA_ANTIGUO 0.5`, `ESCALA_CAMBIO_PCT 10`
(±10 % entre trimestres → ±0.76; los grandes indexados rara vez mueven más), `FACTORES_SPLIT`, `TOLERANCIA_SPLIT 0.05`,
`MIN_INSTITUCIONES_SPLIT 3` (con 1–2 una compra ×2 se confundiría con un split).

**Versión 1.1.0 y por qué**: (a) panel balanceado: antes, una institución que aún no presentaba su 13F del último corte (hasta 45 días)
se contaba como "sale" → sesgo bajista artificial; (b) detección de split: el 13F reporta acciones sin ajustar, un split 10:1 parecía
compra masiva (prueba «institucional 1.1.0: split 10:1…»).

**Ejemplo (verificado, sintético)**: A = {A:110, B:95, C:200, N:50}, B = {A:100, B:100, C:190, S:30}. Comunes A, B, C: 405 vs 390 →
+3.846 % → tanh(0.3846) = 0.367; amplitud (2 − 1)/3 = 0.333. Sesgo = (1.5·0.367 + 0.333)/2.5 = **0.3534**, confianza **0.6767**,
puntaje 67.67; nuevas 1, salen 1 (no cuentan), `dias_desde_corte` 46.

**Limitaciones**: solo 9 filers; coincidencia por nombre (puede fallar; CUSIP mejoraría); rezago de hasta 45 días (posiciones pasadas);
no distingue salida real de presentación pendiente; la sincronización es lenta (tablas grandes, p. ej. BlackRock ~23 MB); la interfaz
omite el core si no hay 13F.

### 5.5 Core noticias — `src/cores/noticias.core.js` + `src/cores/lexico.js` (`noticias@1.1.0`, `lexico@1.1.0`)

**Objetivo.** Tono reciente de las noticias de la empresa, dando más peso a lo reciente.

**Funciones**: `evaluar`, `puntuarTexto`, `tokenizar`, `normalizarTexto`.
**Entrada**: `REQUIERE = ['noticias']`, colección `noticias` filtrada por `simbolos` que contienen el símbolo; campos `titulo, resumen, publicadaEn`.
Proveedor: Alpaca `GET /v1beta1/news` (contenido Benzinga); la sincronización trae **14 días**, máx. 50 noticias.

**Texto → tokens**: minúsculas, sin acentos, sin apóstrofos; tokens `[a-z0-9]+`.
**Léxico** (`LEXICO`): **287 términos** (contados en `dist`) inglés/español con valor −2..+2 asignado a mano:
±2 eventos extremos (fraud, bankruptcy, plunge, surge), ±1.5 resultados/calificaciones (beat, miss, upgrade, downgrade),
±1 movimientos/tono, ±0.5 términos débiles (risk, buy, higher).
**Modificadores**: negadores (`not, no, never, without, fails, unable, sin, nunca…`) invierten el signo de los términos en las 3 palabras
siguientes (`VENTANA_NEGACION 3`); intensificadores (`sharply, significantly, massive…`) ×1.5 y atenuadores (`slightly, modestly…`) ×0.5
al siguiente término dentro de 2 palabras (`VENTANA_INTENSIDAD 2`).

**Por noticia** (`puntuarTexto(título + " " + resumen)`): `pos = Σ aportes > 0`, `neg = Σ |aportes < 0|`;
polaridad `p = (pos − neg)/(pos + neg)`; fuerza `f = min(1, (pos + neg)/2)`. Sin términos → sin polaridad.

**Agregado** (noticias con fecha ≤ ref, dentro de `ventanaDias`, titulares deduplicados, solo las que tienen polaridad):
| Magnitud | Fórmula |
|---|---|
| peso | `w_i = 0.5^(edad_i/vidaMedia)·f_i` (edad en días) |
| sesgo = `sentimiento_promedio` | `Σ w_i p_i / Σ w_i` |
| consistencia | `|Σ w p| / Σ w |p|` |
| confianza | `(1 − e^(−Σw/2))·consistencia` |
| cobertura | noticias con polaridad / noticias analizadas |
Señal única `sentimiento_promedio` (pesoBase 1). Métricas: `sentimiento_sin_decaimiento`, `noticias_positivas/negativas` (p > 0.1 / < −0.1),
`noticias_con_terminos`, `noticias_analizadas`, `consistencia_noticias`, `peso_efectivo`.
Nota: este core **no** usa `combinar` ni `filtrarSenales` (tiene una sola señal); calcula sesgo/confianza/cobertura propios y llama a `finalizar`.

**Constantes**
| Constante | Valor | Fija/variable | Por qué |
|---|---|---|---|
| `VIDA_MEDIA_DIAS` | 3 | **Variable** por perfil o ejecución: `parametros.vidaMediaDias` (0.25–365) | El efecto de una noticia se disipa en pocas sesiones (heurística). |
| `VENTANA_DIAS` | 30 | Ídem `parametros.ventanaDias` | ≈ un vencimiento mensual. |
| `UMBRAL_POLARIDAD` | 0.1 | fija | Solo para conteos. |
| `FUERZA_REFERENCIA` | 2 | fija | Un término fuerte (±2) o dos moderados = fuerza 1. |
| `SATURACION_PESO` | 2 | fija | Σw = 2 → 63 % de la confianza máxima. |
| `VENTANA_NEGACION` / `VENTANA_INTENSIDAD` | 3 / 2 | fija | Alcance típico en titulares cortos. |
| `FACTOR_INTENSIFICADOR` / `FACTOR_ATENUADOR` | 1.5 / 0.5 | fija | Convención (VADER usa ajuste aditivo; aquí multiplicativo). |

**Casos límite**: sin noticias → `noticias`; ninguna con términos → `noticias.terminos_lexico` y sesgo null; sin `fechaReferencia` →
peso uniforme y `fechaReferencia` en datosFaltantes.

**Versión 1.1.0 y por qué**: antes los titulares sin términos contaban como neutros (0) y diluían el promedio hacia 0 (causa probable del
0.00 de MSFT en datos reales); ahora solo bajan la cobertura. Se añadieron polaridad por noticia, intensificadores, más negadores y ~60 términos.

**Ejemplo (verificado)**: referencia 2026-11-15. «Company beats estimates, shares rise» (hace 1 día: beats 1.5 + rise 1 → p = +1, f = 1),
«Analyst warns of slowing demand» (hace 2 días: −1 −1 → p = −1, f = 1), «Company to host investor day» (sin términos).
Pesos 0.7937 y 0.6300 → sesgo = (0.7937 − 0.6300)/1.4237 = **0.115**; consistencia 0.115; confianza (1 − e^(−0.7119))·0.115 = **0.0586**;
cobertura 2/3.

**Limitaciones**: palabras sueltas (sin frases, sarcasmo ni contexto: "beats" de un competidor cuenta igual); léxico **no validado con
titulares etiquetados**; la sincronización trae 14 días aunque la ventana sea 30.

---

## 6. Confluencia y selección (`src/cores/confluencia.core.js`, `confluencia@1.1.0`; ADR-002, ADR-012)

**Entrada**: `{ estrategia, evaluaciones:[{core, sesgo, confianza}], ponderaciones:[{core, peso ≥ 0}], coresSeleccionados, volatilidad?:{ivActual, hv20, ivRank} }`.
El servicio (`analisis.service.js → combinar`) toma `sesgo` y `confianza` de las **métricas guardadas** de cada evaluación (4 decimales) y
`volatilidad = { ivActual: iv_promedio, hv20: hv_20 }` del core indicadores. Ponderaciones del usuario; por defecto peso 1.

Por core i seleccionado con sesgo numérico: `s_i`, `c_i = clamp(confianza, 0, 1)`, `w_i` = ponderación, **`e_i = w_i·c_i`**
(la cobertura del core no se multiplica aparte: ya está dentro de c_i).

| Magnitud | Fórmula |
|---|---|
| Sesgo combinado | `s̄ = clamp(Σ e_i s_i / Σ e_i)` |
| Dispersión | `D = √(Σ e_i (s_i − s̄)² / Σ e_i)` ∈ [0, 1] (desviación estándar ponderada; un core → 0) |
| Acuerdo | `A = clamp(1 − D, 0, 1)` |
| Neutralidad media | `N̄ = Σ e_i (1 − |s_i|) / Σ e_i` |
| Cobertura | cores con resultado / cores seleccionados |
| Confianza | `(Σ w_i c_i / Σ w_i)·cobertura·A` |
| **LONG_CALL** | `clamp(50 + 50·s̄·A, 0, 100)` |
| **LONG_PUT** | `clamp(50 − 50·s̄·A, 0, 100)` |
| **IRON_CONDOR** | `clamp(100·N̄ + ajuste, 0, 100)` — promedio de neutralidades, **no** neutralidad del promedio |
| Ponderaciones efectivas | `e_i / Σ e` (suman 1; 0 si el core no tuvo resultado) |

Un core sin resultado (sesgo null) **no** es una evaluación negativa: se excluye y baja la cobertura. Sin cores con resultado o Σe = 0 →
puntaje 50, confianza 0, `sesgoCombinado null` (la selección lo registra con puntaje 0 y cobertura 0).

**¿Por qué la desviación estándar ponderada?** Mide cuánto se alejan los sesgos del consenso, ponderando cada core por lo que pesa en
ese consenso (un core con baja confianza influye poco). Alternativas descartadas en ADR-012: rango máx − mín (sensible a un solo core
extremo con poca confianza) y entropía de signos (ignora magnitudes).

### Ajuste de volatilidad del Iron Condor (`ajusteVolatilidad`)
- Con IV y HV20 > 0: `ajuste = clamp((IV/HV20 − 1)/0.2)·15`. Verificado: IV/HV 0.8 → −15; 0.9 → −7.5; 1.0 → 0; 1.1 → +7.5; 1.2 → +15; 1.3 → +15 (satura).
- Si no, con `ivRank` ∈ [0, 100] (≤ 1 se lee como fracción): `clamp((rank − 50)/30)·15`. **El servicio nunca envía IV Rank** (no hay histórico de IV).
- Sin datos: sin ajuste y motivo «Sin datos de IV/HV…».
- Razón: IV alta frente a la volatilidad realizada favorece **vender** prima (lo que hace el Iron Condor).
- Constantes (heurísticas ADR-002): `AJUSTE_IV_MAX 15` (permite desempatar pero no supera a la estructura direccional, que aporta hasta 100),
  `SENSIBILIDAD_IV_HV 0.2`, `IV_RANK_CENTRO 50`, `IV_RANK_ESCALA 30`; `UMBRAL_DIRECCION 0.1` y `UMBRAL_CONTRADICCION 0.35` solo afectan textos.
- **Limitación honesta**: la prima de riesgo de varianza hace que IV/HV ≈ 1.1–1.2 sea lo habitual (afirmación documentada en ADR-012,
  no medida con datos del proyecto); centrar en 1.0 suma típicamente +7.5 a +15 al Iron Condor. Además IV (promedio de contratos ±5 % de
  todos los vencimientos 7–60 días) y HV20 tienen horizontes distintos.

### Caso NVDA antes/después (ADR-012; reproducido en la prueba «caso NVDA», confianzas iguales 0.8, sin ajuste IV)
Sesgos: fundamental +1.0, técnico −0.6, indicadores −0.8, noticias 0.
- s̄ = (1 − 0.6 − 0.8 + 0)/4 = **−0.1**; D = √((1.1² + 0.5² + 0.7² + 0.1²)/4) = **0.7** → A = **0.3**.
- **Antes (1.0.0)**: IC = 100·(1 − |s̄|) = **90**; Long Put = 50 + 50·0.1 = **55**. El IC ganaba aunque ningún core indicaba lateralidad.
- **Después (1.1.0)**: IC = 100·(0 + 0.4 + 0.2 + 1)/4 = **40**; Long Put = 50 + 50·0.1·0.3 = **51.5**; motivo «Los cores se contradicen (dispersión 0.70)…».
(Con confianzas reales distintas los números cambian; el documento no guarda las confianzas exactas de la ejecución real de NVDA.)

### Ejemplo con 3 cores (verificado)
Técnico (s 0.7928, c 0.8964) + indicadores (−0.4796, 0.7398) + noticias (0.115, 0.0586), pesos 1:
e = 0.8964 / 0.7398 / 0.0586 (efectivas 0.5289 / 0.4365 / 0.0346); s̄ = **0.2139**; D = **0.6225**; A = **0.3775**; N̄ = 0.3674; confianza 0.2133.
**LONG_CALL 54.04**, **LONG_PUT 45.96**, **IRON_CONDOR** con IV 0.33 / HV 0.30: 36.74 + 7.5 = **44.24**.

### Selección (`analisis.service.js → ejecutarSeleccion`)
Para cada empresa: **recalcula** cada core seleccionado (crea Evaluaciones nuevas con `parametros = perfil.parametros + filtros`), luego la
confluencia de cada estrategia candidata (crea Confluencias). Resultados: `{empresaId, estrategiaId, confluenciaId, puntaje, cobertura, motivos(≤8)}`.

| Modo (`Seleccion.modo`) | Empresas | Estrategias |
|---|---|---|
| `empresa` | `empresaId` | `estrategiasCandidatas` o las 3 |
| `estrategia` | `empresasCandidatas` o las primeras 25 activas | la de `estrategiaId` |
| `empresa_estrategia` | `empresaId` | la de `estrategiaId` |
En los tres modos el orden es el mismo: `puntaje` descendente, desempate por `cobertura` descendente. La interfaz «Analizar» usa `modo: 'empresa'`.

---

## 7. Evaluación de configuraciones (`src/cores/estrategias.core.js` + `src/cores/blackscholes.js`)

`evaluarConfiguracion` (alias `evaluar`). Entrada: `{ estrategia, componentes:[{tipo, accion, strike, cantidad, vencimiento, precio?,
volatilidadImplicita?, griegas?}], precioSubyacente?, multiplicador = 100, fechaReferencia?, tasaLibreRiesgo = 0.04 }`.
En la app (`analisis.service.js → evaluarConfiguracion`): `precio` = `(bid + ask)/2` del último snapshot (o `ultimo`); IV y griegas del
snapshot de Alpaca (**feed `indicative`**: cotizaciones derivadas/retrasadas, no OPRA); `precioSubyacente` = último cierre guardado
(o el del body); `fechaReferencia` = ahora.

**Validación** (`validar`): LONG_CALL = 1 call buy; LONG_PUT = 1 put buy; IRON_CONDOR = 4 patas, mismo vencimiento, cantidades iguales,
1 put buy, 1 put sell, 1 call sell, 1 call buy con `K1 < K2 < K3 < K4`. Strike > 0, cantidad entera > 0, precio ≥ 0.

**Payoff al vencimiento** (`payoff`): `Σ signo·(intrínseco(S_T) − precio)·cantidad·multiplicador`, signo +1 compra / −1 venta.

| Métrica | LONG_CALL | LONG_PUT | IRON_CONDOR |
|---|---|---|---|
| `prima_neta` (> 0 crédito) | `−P·q·m` | `−P·q·m` | `Σ −signo·P·q·m` |
| `perdida_maxima` (positiva) | `P·q·m` | `P·q·m` | `max(0, ancho − crédito)·q·m`, ancho = `max(K2−K1, K4−K3)` |
| `ganancia_maxima` | null (ilimitada; no se guarda porque las métricas deben ser finitas) | `max(0, K − P)·q·m` | `crédito·q·m` |
| breakeven(s) | `K + P` | `K − P` | `K2 − crédito`, `K3 + crédito` |
| `resultado_vencimiento_precio_actual` | payoff(S actual) | ídem | ídem |
| `delta_neta` | `Σ signo·Δ_Alpaca·q·m` si todas las patas traen delta | ídem | ídem |

**Métricas Black-Scholes** (requieren `precioSubyacente > 0`, `fechaReferencia` y vencimiento futuro;
`T = (vencimiento a las 20:00 UTC − referencia)/365 días`):
- `anos_al_vencimiento`; si todas las patas traen IV: `delta_neta_bs = Σ signo·Δ_BS·q·m` y `prima_neta_teorica_bs`.
- `diferencia_delta_max = máx |Δ_BS(IV de la pata) − Δ_Alpaca|` → **verificación independiente** de la delta indicativa.
- `diferencia_iv_max = máx |IV recalculada desde la prima mid − IV_Alpaca|`.
- `probabilidad_ganancia` (lognormal, **neutral al riesgo**, r = 0.04, q = 0):
  LONG_CALL `P[S_T > K + P]`; LONG_PUT `1 − P[S_T > K − P]`;
  IRON_CONDOR `P[S_T > K2 − crédito; σ del put vendido] − P[S_T > K3 + crédito; σ del call vendido]`, acotado a [0, 1]; crédito ≤ 0 → 0.
  Cada breakeven usa la IV de la pata vendida más cercana (aproxima la sonrisa de volatilidad).

**Supuestos y advertencias**: r fija 4 % (`TASA_LIBRE_RIESGO`, "≈ letras del Tesoro a 3 meses 2025–2026", constante documentada, no dato de
mercado); la deriva es r, no un pronóstico del rendimiento real → **no es una probabilidad del mundo real**; opciones americanas valoradas
como europeas (exacto para calls sin dividendos, aproximado para puts); IV constante hasta el vencimiento; T en días naturales/365.

**Ejemplos (verificados, contratos sintéticos, referencia 2026-11-17 15:00 UTC, vencimiento 2026-12-18 → T = 0.0855)**
- Iron Condor 90/95/105/110, primas 0.60/1.50/1.40/0.50, IV 0.32/0.30/0.27/0.26, S = 100: prima_neta **+180**, ganancia máx **180**,
  pérdida máx **320**, breakevens **93.20 / 106.80**, ancho 5, delta_neta_bs −3.65 acciones, **probabilidad_ganancia 0.584**.
- Long Call K = 100, prima 3.60, IV 0.30, Δ Alpaca 0.53: pérdida máx **360**, breakeven **103.60**, delta_neta_bs 53.30 vs delta_neta 53
  (`diferencia_delta_max` 0.003), **probabilidad_ganancia 0.342**.

---

## 8. De la recomendación a la orden paper

### «Operar» arma las patas (`web/src/utils/estrategiasOrden.js`, usado por `web/src/components/BotonOperar.jsx`)
| Paso | Función | Regla exacta |
|---|---|---|
| Vencimiento | `elegirVencimiento(vencimientos, hoy, minDias = 7)` | El más cercano con ≥ 7 días; si no hay, el futuro más cercano. |
| Long Call / Long Put | `construirPatas` | Comprar el call/put con **strike más cercano al precio** (ATM). |
| Iron Condor: patas cortas | `porDelta(items, tipo, 0.2, fallback)` | Put y call vendidos con **|Δ| más cercano a 0.20** (solo deltas entre 0.02 y 0.98); sin griegas, strike más cercano a `precio·0.95` (put) / `precio·1.05` (call). |
| Iron Condor: alas | `ala(items, tipo, base, dir, precio·0.025)` | Strike del lado exterior cuyo ancho esté más cerca de **2.5 % del precio** (mín. un paso). |
| Precio sugerido | `netoMid` + `redondearPrecio` | Neto = Σ ventas − Σ compras a mid; > 0 = crédito. Redondeo a 0.01 si < 3, a 0.05 si ≥ 3. |
| Riesgo mostrado | `perfilRiesgo` | Long: pérdida = precio·100·q; condor: (ancho − crédito)·100·q, breakevens K2 − crédito, K3 + crédito. |
| Avisos | `contextoAnalisis` | Sin análisis, análisis > 24 h, estrategia que no es la top, y "contradicción" (top = IC con algún core ≥ 70 y otro ≤ 30). |

¿Por qué delta 0.20? Es una convención de mercado para vender opciones OTM: |Δ| ≈ 0.20 equivale aproximadamente a una probabilidad
neutral al riesgo de ~20 % de terminar ITM por cada lado. **El código no documenta un estudio que justifique 0.20 ni 2.5 %; son
heurísticas de la interfaz.**

### Ticket (`web/src/components/TicketOrden.jsx` → `POST /api/v1/ordenes/ticket`, `operacion.service.js → ticket`)
Body: `{ empresaId, estrategiaCodigo?, nombre?, tipo: market|limit, precioLimite?, credito?, vigencia = 'day'|'gtc', cantidad 1–100,
componentes:[{contratoId, accion, intencion?, proporcion?}] (1–4) }`. Validaciones: contratos de la misma empresa, proveedor Alpaca,
no vencidos, sin repetir; `intencion` por defecto `<accion>_to_open`; `credito` solo multi-pata y limit. Crea una **Configuracion `validada`**
y una **Orden `pendiente`** y la envía con `broker.service.js → enviar`.

### Idempotencia
- La interfaz genera un UUID (`uuid()` en `web/src/utils/objects.js`) y lo reutiliza en los reintentos de la misma confirmación.
- Header `Idempotency-Key` (8–128 caracteres `[\w-]`) → se guarda como `orden.idempotencyKey` y se envía a Alpaca como **`client_order_id`**.
- Si la key ya existe (`existente()`), se devuelve la orden previa con `repetida: true` sin reenviar; `enviar()` no reenvía si ya hay `ordenExternaId`.
- La base lo refuerza: índice único `(usuarioId, conexionId, idempotencyKey)` en el modelo Mongo `Orden` y `api_ordenes_natural` en `database/schema.sql`.
- Alpaca también rechaza un `client_order_id` repetido (comportamiento del proveedor; no verificado en este documento más allá del smoke).
- Verificado en el smoke `smoke:orden`: reenvío con la misma key devuelve la misma orden; key ajena → 409.

### Convención de crédito (`alpaca.client.js → precioLimiteAlpaca`, `construirCuerpoOrden`)
Nuestra API: `precioLimite` **siempre positivo** + `credito: true`. Alpaca (referencia `POST /v2/orders`, `limit_price` en `mleg`):
positivo = débito, **negativo = crédito**. Por eso un Iron Condor a crédito 1.80 se envía como `limit_price: "-1.8"`. Formato: 2 decimales si
|precio| ≥ 1, hasta 4 si < 1. Multi-pata: `order_class: 'mleg'`, `qty` = unidades de estrategia, `legs[{symbol, ratio_qty, side, position_intent}]`.
Verificado en paper (ADR-011): un Iron Condor con limit negativo fue aceptado (`new`) y cancelado.

### Estados de orden (`mapearEstadoOrden`)
| Alpaca | Nuestro estado |
|---|---|
| pending_new, held | enviada |
| accepted, new, accepted_for_bidding, pending_cancel, pending_replace, stopped, suspended, done_for_day | aceptada (`done_for_day` con ejecución > 0 → parcial) |
| partially_filled | parcial |
| filled, calculated | ejecutada |
| canceled, replaced | cancelada |
| rejected | rechazada |
| expired | expirada |
Estado local inicial: `pendiente` (antes de enviar). Desconocido → `enviada`.

### Sincronización y cierre
- `sincronizacion.service.js → ordenes`: consulta cada orden con `ordenExternaId` y, si cambió, actualiza estado y agrega evento con el precio de ejecución.
- `→ posiciones`: guarda las posiciones vivas de Alpaca que tengan contrato sincronizado; las abiertas localmente que el broker ya no reporta pasan a `cerrada`.
- `POST /posiciones/:id/cierre` (`operacion.service.js → cierre`): long → `sell_to_close`, short → `buy_to_close`, cantidad = la de la posición, también con Idempotency-Key.

### Solo paper (ADR-005/006)
`createAlpacaClient` lanza `NO_PERMITIDO` si la URL de trading no es exactamente `https://paper-api.alpaca.markets`; `broker.service.js`
rechaza conexiones con `entorno !== 'paper'` (403); credenciales solo por `credencialRef = 'env:ALPACA'` (variables del servidor, nunca en la base ni en respuestas).

---

## 9. Fijo vs variable (tabla consolidada)

### Variable por el usuario (y efecto real verificado en el código)
| Parámetro | Dónde se fija | Defecto | Efecto | Estado real |
|---|---|---|---|---|
| `coresSeleccionados` | Selección / Perfil / Confluencia | — (obligatorio) | Qué cores se ejecutan y entran en la confluencia | Funciona. La interfaz quita `institucional` si no hay 13F. |
| `ponderaciones [{core, peso ≥ 0}]` | Selección / Confluencia | peso 1 | `w_i` en la confluencia | Funciona (ADR-010). |
| `parametros.indicadores` / `filtros.indicadores` | Perfil / ejecución de core / selección | `[]` = todas | Qué señales entran en `combinar` de cada core | Funciona (no aplica al core noticias, que tiene una sola señal y no llama a `filtrarSenales`). |
| `reglas[]` del perfil | PerfilAnalisis | — | ± peso puntos o neutralización (§4) | Funciona; cada regla debe pertenecer a un core seleccionado. |
| `parametros.intervalo` | Perfil / filtros | `1Day` | Intervalo de velas que lee `insumos()` | **Solo `1Day`**: el esquema rechaza otros valores porque solo se sincronizan velas diarias y todas las ventanas (14, 20, 50, 200, 252) están en días hábiles. |
| `parametros.vidaMediaDias`, `parametros.ventanaDias` | Leídos por `noticias.core.js` | 3 / 30 | Decaimiento y ventana de noticias | **Variables** por perfil o en el cuerpo de la evaluación (`parametrosSchema`: 0.25–365 y 1–365 días). |
| `parametros.periodos` | `parametrosSchema` | 120 | — | **Reservado, sin efecto**: los cores usan toda la serie disponible (lo necesitan para SMA200 y rango de 52 semanas). |
| `desde`, `hasta` de sincronización | `POST /sincronizaciones/ejecuciones` | 420 días velas, 14 días noticias | Rango descargado | Funciona (botón «histórico largo 10 años»). |
| Rango de vencimientos de contratos | `POST /sincronizaciones/ejecuciones` con `diasVencimientoMin/Max` (recurso `contratos`) | 7 / 60 días | Contratos sincronizados | **Variable** por sincronización (modelo `Sincronizacion`, valida mín ≤ máx). |
| 13F on/off | Interfaz (casilla `institucional`) | off | Sincroniza 13F y habilita el core | Funciona. |
| Modo de selección, empresas/estrategias candidatas | Selección | — | Universo a ordenar | Funciona. |
| Orden: tipo, precio límite, vigencia, cantidad (1–100), patas | Ticket | limit, day, 1 | Orden enviada | Funciona. |
| `tasaLibreRiesgo` | Solo API pura de `estrategias.core.js` | 0.04 | r de Black-Scholes | No expuesta en REST. |
| `precioSubyacente` | `POST /configuraciones/:id/evaluaciones` | último cierre | S de Black-Scholes y payoff | Funciona. |

### Fijo en código (resumen)
Ventanas (50/200/20/252/60, 14, 12/26/9, 14/3, 20/2, 20/60), escalas de tanh, umbrales 30/70 y 20/80, `pesoBase` de cada señal,
`DIAS_ANUAL/TRIMESTRAL`, `TOLERANCIA_YOY_DIAS`, `DEUDA_CAPITAL_NEUTRA`, `DIAS_VIGENCIA 135`, factores de split, léxico y modificadores,
`AJUSTE_IV_MAX 15`, `SENSIBILIDAD_IV_HV 0.2`, `TASA_LIBRE_RIESGO 0.04`, `DIAS_ANIO 365`, `HORA_VENCIMIENTO_UTC 20`, `IV_MAXIMA 5`,
±5 % del dinero para la IV, ±25 % de strikes en la sincronización, filers 13F, delta 0.20 y alas 2.5 % de la interfaz.
Los `pesoBase` **no** son editables por el usuario (decisión ADR-010: preservar trazabilidad; queda en debate).

### ¿Cómo se determinó cada peso?
Por **criterio de experto documentado** junto a cada constante: más peso a lo más persistente (SMA200 1.5, crecimiento de ingresos 1.5,
cambio agregado de acciones 13F 1.5), menos a lo ruidoso (volumen 0.5, estocástico y %B 0.75, razón corriente 0.75). No hubo ajuste
estadístico ni backtesting; ADR-002/012 lo dejan como debate abierto ("calibrar con datos").

---

## 10. Limitaciones y decisiones abiertas (honestas)

| Limitación | Detalle | Dónde consta |
|---|---|---|
| Pesos y escalas heurísticos | `pesoBase`, escalas de tanh, umbrales y el ±15 no se ajustaron con datos históricos. | Comentarios en cada core, ADR-002/012 |
| Sin backtesting | No existe registro de evaluaciones + precios posteriores para medir aciertos. | ADR-012 «Debate abierto» |
| Feed IEX | Volumen de un solo mercado (~2–3 % del consolidado según el inventario; el ≈2.5 % no está medido en el proyecto); velas IEX solo desde 2020-07. | `plan.md`, inventario §12 |
| Vela parcial | Si la última vela es la sesión en curso, cierre y volumen son provisionales. | `tecnico.core.js` |
| Precios ajustados solo por split | HV y retornos no incluyen dividendos. | inventario §12 |
| IV indicativa | Feed `indicative` (derivado/retrasado, no OPRA). | ADR-004 |
| Snapshots sin historial | Solo el último snapshot por contrato → sin IV Rank. | `plan.md` |
| Ajuste IV/HV centrado en 1.0 | La IV suele superar a la HV (≈10–20 %, según ADR-012) → sesgo leve a favor del Iron Condor. | ADR-012 |
| Léxico no validado | 287 términos asignados a mano; sin frases ni sarcasmo; sin evaluación con titulares etiquetados. | `lexico.js`, `plan.md` |
| 13F | Rezago hasta 45 días; 9 filers; coincidencia por nombre; no distingue salida real de presentación pendiente. | ADR-004, `plan.md` |
| `deuda_capital` | Usa pasivos totales, no deuda financiera. | `fundamental.core.js` |
| Look-ahead en fundamentales | El servicio no pasa `fechaPresentacion`; en un backtest se usaría `periodoFin` (anticipación de ~1–2 meses). | inventario §4 |
| Black-Scholes | Europeo, r fija 4 %, q = 0, IV constante; probabilidad neutral al riesgo. | `blackscholes.js` |
| Parámetros | `periodos` reservado sin efecto; solo velas diarias (`intervalo` = `1Day`). | §9 |
| Acuerdo lineal | A = 1 − D; podría usarse A² (debate). | ADR-012 |
| Cola en memoria | Una sola instancia; trabajos en curso se pierden al reiniciar. | ADR-003 |
| Configuración por orden | Se crea una Configuracion por cada orden (muchos registros). | ADR-011 |

---

## 11. Preguntas probables del revisor (con respuesta corta)

1. **¿Qué hace la herramienta?** Sincroniza datos de Alpaca y la SEC, calcula 5 cores direccionales, los combina en compatibilidad con Long Call, Long Put e Iron Condor, y permite enviar la orden a Alpaca **paper**.
2. **¿Es una recomendación de inversión?** No. Es un sistema de apoyo con pesos heurísticos, sin backtesting y con probabilidades neutrales al riesgo; opera solo en paper.
3. **¿Qué significa puntaje 69 en Long Call?** Compatibilidad 0–100, no probabilidad: 69 = 50 + 50·s̄·A → s̄·A = 0.38 (p. ej. sesgo combinado 0.5 con acuerdo 0.76). 50 = neutral.
4. **¿Y el puntaje de un core?** Índice direccional `50 + 50·sesgo` (0 bajista, 50 neutral, 100 alcista), no compatibilidad (ADR-002).
5. **¿Por qué 14 en el RSI?** Es la definición original de Wilder (1978); constante `RSI_N` fija. No se optimizó.
6. **¿Por qué 252?** Sesiones bursátiles por año (NYSE): se usa para anualizar la HV (`√252`) y como ventana de 52 semanas. Black-Scholes usa en cambio días naturales/365 para T, la convención de la mayoría de proveedores de griegas.
7. **¿Por qué tanh?** Mapea cualquier valor a (−1, 1) de forma suave y simétrica y satura: con x = escala da 0.76. Los mapeos lineales usan `clamp`.
8. **¿Cómo se determinó el peso de cada señal?** Criterio de experto documentado en el código (lo persistente pesa 1.5, lo ruidoso 0.5–0.75). No hubo ajuste estadístico; está declarado como limitación.
9. **¿Qué pasa si un core no tiene datos?** Devuelve `sesgo null`, `confianza 0` y `datosFaltantes`; en la confluencia se excluye (no cuenta como negativo) y baja la cobertura. Si ninguno tiene datos: puntaje 50, confianza 0.
10. **¿Qué pasa si faltan algunas sub-señales?** Se promedian las calculables; la cobertura baja y con ella la confianza (`confianza = cobertura·(…)`).
11. **¿Cómo se calcula la confianza?** `cobertura·(0.5·consistencia + 0.5·intensidad)` en `util.combinar`; indicadores la reescala a su cobertura total y la reduce ×0.8 si HV20 > 1.5·HV60; institucional ×0.5 si el corte tiene > 135 días; noticias `(1 − e^(−Σw/2))·consistencia`.
12. **¿Qué es la dispersión y por qué desviación estándar ponderada?** D = √(Σe(s − s̄)²/Σe): cuánto discrepan los cores del consenso, ponderando por peso·confianza. Rango y entropía se descartaron (ADR-012).
13. **¿Por qué el Iron Condor usa promedio de neutralidades?** Porque un alcista fuerte y un bajista fuerte promedian 0 pero no indican lateralidad. Caso NVDA: 90 → 40.
14. **¿Qué hace el ajuste ±15?** `clamp((IV/HV20 − 1)/0.2)·15`: IV cara frente a la realizada favorece vender prima. Limitación: centrado en 1.0 aunque IV/HV ≈ 1.1–1.2 sea habitual.
15. **¿El fundamental usa Black-Scholes?** No. Usa estados financieros SEC (XBRL us-gaap). Black-Scholes está solo en `blackscholes.js`, usado por `estrategias.core.js`.
16. **¿Para qué Black-Scholes entonces?** Verificar la delta e IV indicativas de Alpaca (`diferencia_delta_max`, `diferencia_iv_max`), prima teórica y probabilidad de ganancia de una configuración.
17. **¿La probabilidad de ganancia es real?** No: lognormal neutral al riesgo (deriva = r = 4 %), IV constante. Sirve para comparar configuraciones, no para pronosticar.
18. **¿Qué aproximación de N(x) usan y qué error tiene?** Abramowitz & Stegun 26.2.17, error < 7.5·10⁻⁸.
19. **¿Cómo evitas look-ahead?** `fechaReferencia` es "hoy": se descartan velas posteriores (`limpiarVelas`), periodos presentados después (`fechaPresentacion`, o `periodoFin`), 13F no publicados (`fechaPublicacion`), noticias futuras y contratos vencidos. Limitación: el servicio no pasa `fechaPresentacion`.
20. **¿Por qué las funciones son puras?** ADR-001: reproducibles y probables sin red; el servicio carga datos y guarda la Evaluación con versión, parámetros, reglas y fuentes.
21. **¿Por qué no se cuenta doble?** El técnico es solo tendencia; indicadores, solo osciladores y volatilidad (tabla de familias en `contratos.md`).
22. **¿Por qué el RSI 85 no da +1?** `senalOscilador` atenúa en sobrecompra (85 → 0.5; 100 → 0): momentum que se agota. No se invierte a negativo para no apostar a reversión.
23. **¿Por qué deuda/capital con pasivos totales?** El XBRL estándar usado no separa deuda financiera de forma homogénea; está declarado en un motivo fijo y como limitación.
24. **¿Cómo comparas periodos fundamentales?** Solo igual duración: anual vs anual o trimestre vs mismo trimestre del año previo (365 ± 25 días).
25. **¿Qué es el panel balanceado del 13F?** Solo instituciones presentes en ambos cortes; evita leer como venta un 13F aún no presentado.
26. **¿Cómo manejas un split en 13F?** Si la mediana de razones nuevas/previas (≥ 3 instituciones) está a ±5 % de un factor típico, se reexpresa el corte previo.
27. **¿Por qué vida media de 3 días?** Heurística: el efecto de una noticia se disipa en pocas sesiones. λ = ln2/3 = 0.231/día. (Hoy no es configurable vía API; ver §9.)
28. **¿Cómo garantizas no duplicar órdenes?** Idempotency-Key = `client_order_id`; la API devuelve la orden existente si la key se repite; índice único en la base; `enviar` no reenvía si ya hay `ordenExternaId`. Verificado con smoke real.
29. **¿Por qué la delta 0.20 para el condor?** Convención de mercado para patas cortas OTM (~20 % de probabilidad neutral al riesgo de terminar ITM por lado). Es heurística de la interfaz; el usuario puede cambiar patas en el ticket.
30. **¿Por qué limit_price negativo?** La referencia de Alpaca para `mleg` define negativo = crédito. Nuestra API expone siempre positivo + `credito: true` y traduce en un solo lugar (`construirCuerpoOrden`).
31. **¿Se puede operar en real?** No: URL de trading fija a paper (`NO_PERMITIDO` si no) y conexiones `live` rechazadas (ADR-005).
32. **¿Dónde están las credenciales?** Variables del servidor referenciadas como `env:ALPACA`; no se guardan en la base ni se devuelven (ADR-006).
33. **¿Cómo probaste que las fórmulas son correctas?** `npm.cmd test`: **116 pruebas** aprobadas (43 en `tests/cores.test.cjs`): valores de libro de Black-Scholes (10.4506 / 5.5735 / Δ 0.6368, IV recuperada 0.2), RSI/EMA/Bollinger/ATR con valores conocidos, caso NVDA, splits, noticias, look-ahead. Además smokes reales con Alpaca paper y SEC (`smoke:real`, `smoke:orden`, `smoke:ejecucion`, `smoke-ticket.cjs`).
34. **¿Qué tan rápido es?** Trabajos asíncronos (202 + sondeo), cola en memoria con concurrencia 2. NVDA completo (sin 13F) ~17 s según la bitácora.
35. **¿Qué pasa si Alpaca falla?** Los adaptadores normalizan errores (`IntegrationError` con códigos SIN_CREDENCIALES, LIMITE, NO_ENCONTRADO, PROVEEDOR, RED); el trabajo queda `fallida` con mensaje seguro (sin secretos).
36. **¿Por qué IV solo de contratos ±5 % del dinero?** La IV de contratos muy ITM/OTM (sonrisa) distorsiona el promedio (`insumos()`).
37. **¿Qué mejorarías primero?** Backtesting para calibrar pesos y A; guardar historial de IV (IV Rank); centrar el ajuste IV/HV en la prima de riesgo típica; CUSIP para 13F; validar el léxico.

---

## 12. Mapa de archivos y cómo ejecutar pruebas

| Ruta | Responsabilidad |
|---|---|
| `src/cores/util.js` | Matemática compartida (SMA, EMA, RSI, MACD, estocástico, Bollinger, ATR, HV, regresión), `combinar`, `filtrarSenales`, `finalizar`. |
| `src/cores/reglas.js` | Motor de reglas del perfil. |
| `src/cores/tecnico.core.js` | Core técnico (tendencia). |
| `src/cores/indicadores.core.js` | Core indicadores (osciladores y volatilidad). |
| `src/cores/fundamental.core.js` | Core fundamental (SEC). |
| `src/cores/institucional.core.js` | Core institucional (13F). |
| `src/cores/noticias.core.js`, `src/cores/lexico.js` | Core noticias y léxico. |
| `src/cores/confluencia.core.js` | Compatibilidad por estrategia (ADR-012). |
| `src/cores/estrategias.core.js`, `src/cores/blackscholes.js` | Validación, payoff y Black-Scholes de configuraciones. |
| `src/cores/index.js`, `src/cores/README.md` | Exportación y resumen de los cores. |
| `src/api/v1/services/analisis.service.js` | `insumos`, `calcular`, `ejecutarCore`, `ejecutarConfluencia`, `ejecutarSeleccion`, `evaluarConfiguracion`. |
| `src/api/v1/services/sincronizacion.service.js` | Descarga y upsert determinista de empresas, velas, cotizaciones, contratos+snapshots, noticias, fundamentales, 13F, órdenes, posiciones. |
| `src/api/v1/services/operacion.service.js` | Conexión paper, resumen, ticket y cierre (ADR-011). |
| `src/api/v1/services/broker.service.js` | Verificar cuenta, enviar/cancelar órdenes, solo paper. |
| `src/api/v1/services/trabajos.service.js`, `src/jobs/cola.js` | Trabajos asíncronos y cola en memoria (ADR-003). |
| `src/api/v1/models/*.js` | Esquemas mongoose (también validan para Supabase): `parametrosSchema`, `Seleccion`, `Orden`, etc. |
| `src/integrations/alpaca.client.js` | Alpaca Market Data y Trading paper; `construirCuerpoOrden`, `mapearEstadoOrden`. |
| `src/integrations/sec.client.js` | SEC: CIK, companyfacts (`METRICAS_SEC`), 13F. |
| `src/integrations/institucionales.js` | Lista de 9 filers 13F. |
| `src/repositories/` + `database/schema.sql` | Repositorios MongoDB y Supabase. |
| `web/src/utils/estrategiasOrden.js` | Armado de patas, mid, neto, perfil de riesgo, contexto del análisis. |
| `web/src/components/BotonOperar.jsx`, `TicketOrden.jsx` | «Operar» y ticket. |
| `web/src/pages/analizar/flujo.js` | Flujo de un clic: sincronizar → cores → selección. |
| `tests/*.cjs`, `scripts/check-models.cjs` | Pruebas (116). |
| `scripts/smoke-*.cjs` | Pruebas reales opt-in (requieren `.env` con claves). |
| `docs/decisiones/README.md`, `docs/version-funcional/*.md` | ADR, contratos, plan, inventario. |

**Comandos (PowerShell en Windows; usar `npm.cmd`)**
| Comando | Qué hace |
|---|---|
| `npm.cmd test` | Compila a `dist/` y ejecuta las 116 pruebas sin red. |
| `npm.cmd run build` | Solo compila `src/` → `dist/`. |
| `npm.cmd run smoke:real -- mongodb AAPL --institucional` | Flujo completo real (Alpaca + SEC + base), usuario temporal, limpia al final, no envía órdenes. |
| `npm.cmd run smoke:orden -- mongodb` | Ciclo de orden paper: limit a 0.01 (no se ejecuta), reenvío idempotente, cancelación. |
| `npm.cmd run smoke:ejecucion -- mongodb` | Compra y venta market reales en paper (requiere mercado abierto). |
| `node scripts/smoke-ticket.cjs mongodb` (tras build) | Ticket de Iron Condor a crédito lejos del precio y cancelación. |
| `npm.cmd run dev` + `npm.cmd run dev:web` | Desarrollo (API + Vite con proxy). |
| `npm.cmd run build:all` y `npm.cmd start` | Producción local; interfaz en `/`, Swagger en `/api/v1/api-docs`. |

Verificación rápida de Black-Scholes:
```
node -e "const bs=require('./dist/cores/blackscholes.js'); console.log(bs.opcion({tipo:'call',S:100,K:100,T:1,r:0.05,sigma:0.2}))"
```
→ precio 10.4506, delta 0.6368, gamma 0.018762, vega 0.3752, probabilidadITM 0.5596.
