# Guía explicativa del proyecto: entender y defender AppRESTOpciones

Fecha: 2026-11-17. **Fuente de verdad: el código** (`src/`, `web/src/`, `tests/`, `render.yaml`). Todo número, constante, peso,
archivo y función de esta guía se tomó del código. Los ejemplos marcados **(ejecutado)** salen de correr el código real compilado
con el script `scripts/guia/ejemplos.cjs` (ver §0.3). Cuando algo no se pudo comprobar en el código, se dice explícitamente.

Versiones de los algoritmos descritos: `tecnico@1.1.0`, `indicadores@1.1.0`, `fundamental@1.1.0`, `institucional@1.1.0`,
`noticias@1.1.0`, `lexico@1.1.0`, `confluencia@1.1.0`, `estrategias@1.1.0`, `blackscholes@1.0.0`, `reglas@1.0.0`.

> Esta herramienta **no es una recomendación de inversión**. Los pesos son heurísticos (no calibrados con datos históricos),
> las probabilidades son "neutrales al riesgo" y las órdenes van solo a una cuenta **simulada** (Alpaca paper).

---

## 0. Cómo usar esta guía

### 0.1 Ruta de estudio

| Tiempo | Qué leer | Qué debes poder decir al terminar |
|---|---|---|
| **30 min** | §A (mapa mental), §B.1–B.4 y B.10–B.13 (acción, retornos, volatilidad, opciones, payoff), §C.1–C.2 (componentes y login), §E.1 (confluencia en una página), §K "Arquitectura" y "Confluencia" | Qué problema resuelve, las 4 etapas, qué es un call/put/iron condor, cómo se elige Mongo/Supabase, qué es "compatibilidad 65" |
| **2 h** | Todo lo anterior + §B completo, §C completo, §D.0 (contrato común) y un core completo (recomendado: técnico §D.1), §E completo, §F, §G, §H | Explicar cualquier fórmula con un ejemplo, el recorrido de una orden de punta a punta y qué es fijo/variable |
| **Antes del examen** | §D (los 5 cores), §I, §J y el banco de preguntas §K completo; repetir los ejemplos con el script | Responder sin mirar las 69 preguntas de §K |

### 0.2 Índice

- **A.** Mapa mental en una página
- **B.** Fundamentos de inversión desde cero (B.1–B.20)
- **C.** Arquitectura explicada como recorrido (componentes, 4 secuencias, modelo de datos, repositorio dual, frontend, configuración y despliegue, seguridad)
- **D.** Lógica de los cores (contrato común + técnico, indicadores, fundamental, institucional, noticias)
- **E.** Confluencia y selección paso a paso
- **F.** Evaluación de configuraciones y Black-Scholes en el código
- **G.** De la recomendación a la orden
- **H.** Qué es fijo y qué es variable
- **I.** Pruebas, verificación y despliegue
- **J.** Limitaciones honestas y mejoras posibles
- **K.** Banco de preguntas del revisor (69 preguntas)
- **L.** Glosario alfabético

### 0.3 Cómo reproducir los números de esta guía

```powershell
npm.cmd run build                         # compila src/ → dist/
node scripts/guia/ejemplos.cjs            # todas las secciones
node scripts/guia/ejemplos.cjs tecnico    # una sección: basicos, tecnico, indicadores, fundamental,
                                          # institucional, noticias, confluencia, bs, estrategias, orden
```

El script no usa red, base de datos ni reloj: carga `dist/cores/*`, `dist/integrations/alpaca.client.js` y
`web/src/utils/estrategiasOrden.js`, y les pasa datos sintéticos fijos con fecha de referencia **2026-11-17 15:00 UTC**.
La empresa ficticia se llama **DEMO**. Si cambias el código, vuelve a ejecutarlo: los números de esta guía deberían cambiar igual.

---

## A. Mapa mental en una página

### A.1 El problema

Quieres operar **opciones** sobre una acción de EE. UU. (por ejemplo TSLA). Hay tres apuestas básicas:

- **Long Call**: ganas si la acción **sube** bastante.
- **Long Put**: ganas si la acción **baja** bastante.
- **Iron Condor**: ganas si la acción **se queda quieta** dentro de un rango.

La pregunta es: *con los datos de hoy, ¿cuál de las tres apuestas es más coherente con lo que dicen el precio, los estados
financieros, los grandes inversionistas y las noticias?* La herramienta responde con una **compatibilidad 0–100** por
estrategia, explica por qué, y permite enviar la orden a una cuenta simulada.

### A.2 El pipeline de 4 etapas

```
 ① SINCRONIZAR            ② ANALIZAR (5 cores)            ③ COMBINAR                 ④ OPERAR (paper)
 proveedores → base        base → funciones puras           confluencia + selección    ticket → Alpaca paper
──────────────────────    ────────────────────────────    ───────────────────────    ──────────────────────────
 Alpaca: velas,           técnico     → sesgo, confianza   s̄ = promedio ponderado     «Operar» arma las patas
   cotización, opciones   indicadores → sesgo, confianza   D = desacuerdo             (ATM, |Δ|≈0.20, alas 2.5 %)
   (IV + griegas),        fundamental → sesgo, confianza   A = 1 − D                  ticket: límite, vigencia,
   noticias               institucional→ sesgo, confianza  LONG_CALL  = 50+50·s̄·A     cantidad, Idempotency-Key
 SEC: XBRL (10-K/10-Q),   noticias    → sesgo, confianza   LONG_PUT   = 50−50·s̄·A     POST /v2/orders (paper)
   13F-HR (9 gestores)                                     IRON_CONDOR= 100·N̄ ± 15    sincronizar estado, cerrar
        │                          │                              │                         │
   MongoDB o Supabase      Evaluacion (por core)          Confluencia + Seleccion     Configuracion + Orden
```

Cada etapa **guarda** su resultado en la base que el usuario eligió al iniciar sesión, de modo que todo es trazable
(qué datos, qué versión del algoritmo, qué parámetros).

### A.3 Cinco ideas que lo explican todo

1. **Sesgo ∈ [−1, 1]**: cada core dice "bajista (−1) … neutral (0) … alcista (+1)". **Confianza ∈ [0, 1]**: qué tan
   sólido es ese juicio.
2. Cada core convierte varias **señales** (p. ej. "precio 7 % sobre la media de 200 días") a [−1, 1] con `tanh` o `clamp`,
   y las promedia con **pesos base** fijos (`pesoBase`).
3. La **confluencia** promedia los sesgos de los cores ponderando por `peso del usuario × confianza`, y **castiga el
   desacuerdo** (desviación estándar ponderada).
4. Un **Iron Condor** necesita que cada core por separado sea neutral (promedio de neutralidades), no que los cores se
   cancelen entre sí (caso NVDA).
5. Las órdenes van **solo a paper**, con **idempotencia** (un reintento no duplica la orden) y credenciales que nunca salen
   del servidor.

---

## B. Fundamentos de inversión desde cero

Cada concepto: **intuición → definición → ejemplo numérico → dónde aparece en la app**.

### B.1 Acción, ticker y vela OHLCV

- **Intuición.** Una acción es un pedacito de una empresa. Su precio cambia segundo a segundo; para analizarlo se resume
  cada día en una "vela".
- **Definición.** Una vela diaria tiene **O**pen (apertura), **H**igh (máximo), **L**ow (mínimo), **C**lose (cierre) y
  **V**olume (acciones negociadas). El **ticker** es el código de la acción (`AAPL`, `TSLA`).
- **Ejemplo.** O = 100, H = 103, L = 99, C = 102, V = 1.2 millones: abrió en 100, llegó a 103, bajó hasta 99 y cerró en 102.
  "Vela verde" (C > O).
- **En la app.** `datos-mercado` con `tipo: 'vela'`, campos `{apertura, maximo, minimo, cierre, volumen, intervalo:'1Day'}`
  (`src/api/v1/models/DatoMercado.js`, que valida `maximo ≥ max(apertura, cierre)` y `minimo ≤ min(...)`). Vienen de
  Alpaca `GET /v2/stocks/bars` con `feed=iex`, `adjustment=split` (`alpaca.client.js → velas`).
  Ojo: **IEX es un solo mercado** (no el volumen consolidado de toda la bolsa) y sus datos empiezan en 2020-07.

### B.2 Retorno simple vs logarítmico

- **Intuición.** "¿Cuánto gané?" Se puede medir en porcentaje simple o en logaritmos. Los logaritmos tienen una propiedad
  cómoda: **se suman** en el tiempo.
- **Definición.** Simple: `R = C_t/C_{t−1} − 1`. Logarítmico: `r = ln(C_t/C_{t−1})`. Para movimientos pequeños `r ≈ R`.
- **Ejemplo (ejecutado).** Cierres 100, 102, 99, 101, 104, 103:

  | Día | Simple | Log |
  |---|---|---|
  | 100→102 | 0.0200 | 0.0198 |
  | 102→99 | −0.0294 | −0.0299 |
  | 99→101 | 0.0202 | 0.0200 |
  | 101→104 | 0.0297 | 0.0293 |
  | 104→103 | −0.0096 | −0.0097 |
  | **Suma** | 0.0309 (≠ 3 % real) | **0.0296 = ln(103/100)** exacto |

  La suma de retornos simples (3.09 %) no da el resultado real (3 %); la suma de logaritmos sí da `ln(1.03)`.
- **En la app.** `util.volatilidadHistorica` usa retornos **log** porque (1) son aditivos y (2) Black-Scholes supone que el
  log del precio sigue una distribución normal, así que la volatilidad histórica y la implícita miden la misma cosa.

### B.3 Volatilidad, desviación estándar y por qué √252

- **Intuición.** Volatilidad = cuánto "salta" el precio. Una acción que se mueve ±3 % diario es más volátil que una que se
  mueve ±0.5 %.
- **Definición.** Desviación estándar de los retornos: `σ = √( Σ(r − r̄)² / (n − 1) )` (muestral). Se **anualiza**
  multiplicando por `√252` (252 ≈ sesiones bursátiles por año).
- **¿Por qué raíz y no 252?** Si los retornos diarios son independientes, las **varianzas** se suman:
  `Var(año) = Var(d1) + … + Var(d252) = 252·σ_d²`. La desviación estándar es la raíz de la varianza:
  `σ_año = √(252·σ_d²) = σ_d·√252`. El ruido se acumula como un paseo aleatorio: crece con la raíz del tiempo, no
  linealmente (subidas y bajadas se cancelan parcialmente).
- **Ejemplo (ejecutado).** Con los 5 retornos log anteriores: media 0.0059, σ diaria **0.0248** → anual
  `0.0248 × 15.8745 = 0.3936` (39.4 %). `util.volatilidadHistorica([100,102,99,101,104,103], 5)` devuelve exactamente
  **0.3936**. Al revés: una IV de 30 % anual equivale a `0.30/√252 = 1.89 %` diario.
- **Muestral vs poblacional.** HV usa la **muestral** (n − 1, estimador estadístico de una muestra); Bollinger usa la
  **poblacional** (n, definición original de John Bollinger). Ambas están en `util.desviacion(valores, muestral)`.
- **En la app.** `hv_20` y `hv_60` del core indicadores (`HV_CORTA = 20`, `HV_LARGA = 60`) y el ajuste IV/HV del Iron
  Condor en la confluencia.

### B.4 Tendencia y medias móviles

- **Intuición.** Para ver la dirección sin el ruido diario se promedian los últimos N cierres. Si el precio está por encima
  de su promedio, la tendencia reciente es alcista.
- **Definiciones.**
  - **SMA** (media simple): `SMA_n = (C_t + … + C_{t−n+1}) / n` (`util.sma`, `util.smaSerie`).
  - **EMA** (media exponencial): `e_t = α·C_t + (1 − α)·e_{t−1}`, `α = 2/(n+1)`, semilla = SMA de los primeros n
    (`util.emaSerie`). Da más peso a lo reciente.
  - **Pendiente de regresión**: recta de mínimos cuadrados sobre los últimos n cierres con x = 0…n−1:
    `b = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)²` (`util.pendienteRegresion`).
  - **Cruce dorado / de la muerte**: la SMA50 cruza por encima / por debajo de la SMA200.
- **Ejemplo (ejecutado).** Cierres 100, 102, 99, 101, 104, 103: SMA3 = —, —, 100.33, 100.67, 101.33, 102.67;
  EMA3 (α = 0.5) = —, —, 100.33, 100.67, 102.33, 102.67 (reacciona antes al salto a 104); pendiente = **0.657 USD por día**.
- **En la app.** Core técnico (§D.1): `precio_vs_sma50`, `precio_vs_sma200`, `cruce_sma50_200`, `pendiente_20`.
  La EMA se usa en el MACD (core indicadores). El gráfico de la interfaz dibuja SMA 20/50/200 (`web/src/utils/velas.js → sma`).

### B.5 Momentum y osciladores

- **Intuición.** La tendencia dice "hacia dónde"; el momentum dice "con qué fuerza, y si se está agotando". Los
  osciladores viven en una escala fija (0–100) con zonas de "sobrecompra" y "sobreventa".
- **Definiciones** (todas en `src/cores/util.js`):
  - **RSI de Wilder (14)**: promedio de subidas `G` y de bajadas `P` con suavizado de Wilder `m_t = (m_{t−1}·13 + x_t)/14`;
    `RSI = 100 − 100/(1 + G/P)`. Sobre 70 = sobrecompra, bajo 30 = sobreventa.
  - **MACD (12, 26, 9)**: `MACD = EMA12 − EMA26`; `señal = EMA9(MACD)`; `histograma = MACD − señal`. Histograma
    positivo = momentum alcista acelerando.
  - **Estocástico %K (14) y %D (3)**: `%K = (C − mín14)/(máx14 − mín14)·100` (dónde cerró dentro del rango de 14 días);
    `%D` = promedio de los últimos 3 %K. Zonas 20/80.
  - **Bandas de Bollinger (20, 2)**: `media = SMA20`, bandas `media ± 2σ_pob`; `%B = (C − inferior)/(superior − inferior)`
    (0 = en la banda inferior, 1 = en la superior).
  - **ATR (14)**: rango verdadero `TR = máx(H − L, |H − C_{t−1}|, |L − C_{t−1}|)` suavizado con Wilder; mide volatilidad en dólares.
- **Ejemplo (ejecutado).** Cierres 100, 102, 99, 101, 104, 103 → RSI(5) = **63.64** (más subidas que bajadas). En la
  serie DEMO de §D.2: RSI14 40.50, MACD −0.9355, señal −0.2134, histograma −0.7221, %K 6.52, %B 0.0184, ATR14 3.43.
- **En la app.** Core indicadores (§D.2).

### B.6 Estados financieros

- **Intuición.** El precio refleja expectativas; los estados financieros dicen cómo le va realmente al negocio.
- **Definiciones.**

  | Concepto | Qué es | Ejemplo |
  |---|---|---|
  | Ingresos (revenue) | Ventas del periodo | 12 000 M USD en el trimestre |
  | Utilidad neta | Lo que queda tras costos, intereses e impuestos | 1 800 M |
  | Margen neto | Utilidad / ingresos | 1 800/12 000 = 15 % |
  | Pasivos | Lo que la empresa debe (deuda, proveedores, impuestos diferidos…) | 30 000 M |
  | Capital contable (equity) | Activos − pasivos: lo que es de los accionistas | 20 000 M |
  | Apalancamiento | Pasivos / capital | 1.5 |
  | Liquidez (razón corriente) | Activo circulante / pasivo circulante (¿paga lo de corto plazo?) | 15 000/10 000 = 1.5 |
  | Flujo operativo | Efectivo generado por la operación (no es lo mismo que utilidad) | 2 600 M → margen 21.7 % |
  | YoY (year over year) | Comparar con el **mismo periodo del año anterior** | Q3-2026 vs Q3-2025 |
  | 10-K / 10-Q | Informe anual / trimestral presentado a la SEC | — |
  | XBRL / us-gaap | Formato etiquetado de esos informes / catálogo de etiquetas (`Revenues`, `NetIncomeLoss`…) | — |

- **¿Por qué YoY y no trimestre contra trimestre anterior?** Por la estacionalidad: un minorista vende más en el cuarto
  trimestre; comparar Q4 con Q3 confundiría temporada con crecimiento.
- **En la app.** Core fundamental (§D.3) con datos de SEC `companyfacts` (`sec.client.js → construirFundamentales`).

### B.7 Formulario 13F

- **Intuición.** Los grandes gestores (Vanguard, BlackRock…) deben declarar cada trimestre qué acciones tienen. Si en
  conjunto **aumentan** su posición en una empresa, es una señal (débil y tardía) de interés institucional.
- **Definición.** El **13F-HR** es un informe trimestral obligatorio para gestores con más de 100 M USD en ciertos valores;
  se presenta **hasta 45 días** después del cierre del trimestre. Contiene una "tabla de información" con
  `nameOfIssuer`, `cusip`, `value`, `sshPrnamt` (cantidad) y `sshPrnamtType` (`SH` = acciones, `PRN` = principal de bonos).
- **Ejemplo.** Corte 2026-09-30, presentado 2026-11-13: refleja lo que tenían el 30 de septiembre, no hoy.
- **En la app.** Core institucional (§D.4); fuente SEC EDGAR, 9 gestores fijos en `src/integrations/institucionales.js`.

### B.8 Sentimiento de noticias

- **Intuición.** Titulares como "beats estimates" o "plunges" mueven el precio a corto plazo, y su efecto se desvanece en
  pocos días.
- **Definición.** Un **léxico** asigna un valor a cada palabra (−2 … +2); se suman los aportes de un texto y se convierte a
  una **polaridad** en [−1, 1]. Las noticias viejas pesan menos (**decaimiento exponencial**).
- **Ejemplo (ejecutado).** "DEMO significantly beats estimates as cloud revenue surges": `beats` +1.5 × 1.5 (por
  `significantly`) + `surges` +2 = +4.25 → polaridad +1.
- **En la app.** Core noticias (§D.5), noticias de Alpaca (contenido Benzinga), `src/cores/lexico.js` (287 términos).

### B.9 Opciones: call, put, strike, prima, ×100

- **Intuición.** Una opción es un **contrato de derecho, no de obligación**. Un call es como un "vale para comprar a precio
  fijo"; un put es como un "seguro que te deja vender a precio fijo".
- **Definiciones.**
  - **Call**: derecho a **comprar** el subyacente al **strike K** hasta el vencimiento.
  - **Put**: derecho a **vender** al strike K.
  - **Prima**: precio de la opción, cotizado **por acción**.
  - **Multiplicador ×100**: un contrato de acciones de EE. UU. cubre 100 acciones. Prima 3.60 → el contrato cuesta 360 USD.
  - **Vencimiento**: fecha en que expira. El código supone cierre a las **20:00 UTC** (`HORA_VENCIMIENTO_UTC` en
    `estrategias.core.js`; 16:00 hora de Nueva York en horario de verano).
  - **Símbolo OCC**: `TSLA261201P00352500` = TSLA, 2026-12-01, **P**ut, strike 352.500 (`operacion.service.js → parsearOcc`).
- **En la app.** `contratos` (`ContratoOpcion`: `tipo`, `strike`, `vencimiento`, `multiplicador`) y snapshots
  `datos-mercado` `tipo: 'snapshot_opcion'` con `bid`, `ask`, `ultimo`, `volatilidadImplicita` y `griegas`.

### B.10 Valor intrínseco y extrínseco; ITM, ATM, OTM

- **Definiciones.** Intrínseco = lo que vale ejercer **ya**: call `max(0, S − K)`, put `max(0, K − S)`
  (`estrategias.core.js → valorIntrinseco`). Extrínseco = prima − intrínseco (valor del tiempo y de la incertidumbre).
  **ITM** (in the money) si el intrínseco > 0, **ATM** si S ≈ K, **OTM** si el intrínseco = 0.
- **Ejemplo (ejecutado con Black-Scholes, S = 100, 30 días, σ 30 %, r 4 %).**

  | K | Call | Intrínseco | Extrínseco | Estado del call | Put | Estado del put |
  |---|---|---|---|---|---|---|
  | 90 | 10.696 | 10 | 0.696 | ITM | 0.401 | OTM |
  | 95 | 6.645 | 5 | 1.645 | ITM | 1.333 | OTM |
  | 100 | 3.591 | 0 | 3.591 | ATM | 3.263 | ATM |
  | 105 | 1.662 | 0 | 1.662 | OTM | 6.317 | ITM |
  | 110 | 0.655 | 0 | 0.655 | OTM | 10.294 | ITM |

  El extrínseco es máximo en ATM: ahí la incertidumbre sobre si terminará ITM es mayor.

### B.11 Bid, ask, mid y spread

- **Definiciones.** **Bid** = mejor precio al que alguien compra; **ask** = mejor precio al que alguien vende;
  **mid** = `(bid + ask)/2`; **spread** = `ask − bid` (costo de entrar y salir).
- **Ejemplo.** bid 5.80, ask 6.75 → mid 6.275, spread 0.95 = 15 % del mid. Comprar y vender de inmediato cuesta
  ≈ 0.95 × 100 = 95 USD por contrato.
- **En la app.** `mid()` y `spreadPct()` en `web/src/utils/estrategiasOrden.js` (si no hay bid/ask válidos usa `ultimo`);
  `analisis.service.js → evaluarConfiguracion` usa `(bid + ask)/2` como `precio`. El ticket advierte si una orden
  **market** tiene alguna pata con spread > 10 % del mid. La sincronización descarta un `ask < bid` (cotización cruzada).

### B.12 Payoff al vencimiento de un call y un put

- **Fórmula (por acción).** Long call: `max(0, S_T − K) − prima`. Long put: `max(0, K − S_T) − prima`.
  En dinero: × cantidad × 100 (`estrategias.core.js → payoff`).
- **Ejemplo (ejecutado).** Long Call K = 100, prima 3.60; Long Put K = 100, prima 3.00 (1 contrato, USD):

  | S_T | 80 | 85 | 90 | 95 | 100 | 105 | 110 | 115 | 120 |
  |---|---|---|---|---|---|---|---|---|---|
  | Long Call | −360 | −360 | −360 | −360 | −360 | 140 | 640 | 1 140 | 1 640 |
  | Long Put | 1 700 | 1 200 | 700 | 200 | −300 | −300 | −300 | −300 | −300 |

  Breakeven del call = `K + prima = 103.60`; del put = `K − prima = 97`. Pérdida máxima = prima × 100 (360 y 300).
  Ganancia máxima del call: ilimitada; del put: `(K − prima)·100 = 9 700` (si la acción va a 0).

```
 Ganancia                Long Call (K=100, 3.60)        Ganancia             Long Put (K=100, 3.00)
   +1640 |                          /                     +1700 |\
         |                        /                             |  \
       0 |-------------------- /------ S_T                     0 |-----\------------------ S_T
    −360 |___________________/  103.6                       −300 |    97 \_________________
         80        100       120                                 80       100        120
```

### B.13 Volatilidad implícita vs histórica

- **Intuición.** La **histórica (HV)** mira hacia atrás: cuánto se movió el precio. La **implícita (IV)** mira hacia
  adelante: cuánta volatilidad está "cobrando" el mercado en el precio de las opciones.
- **Definición.** IV = la σ que, metida en Black-Scholes, reproduce la prima de mercado. Se obtiene invirtiendo la fórmula
  (`blackscholes.js → volatilidadImplicita`, bisección en [0.0001, 5]).
- **Ejemplo (ejecutado).** Un call de libro cuesta 10.4506 (S = K = 100, T = 1, r = 5 %); la bisección recupera **σ = 0.2000**.
  En la serie DEMO: IV promedio 0.25 y HV20 0.2267 → `IV/HV = 1.10` (el mercado cobra un 10 % más de volatilidad de la que
  se ha visto).
- **Por qué importa.** Si IV > HV, las opciones están "caras": favorece **vender** prima (Iron Condor). Si IV < HV, favorece
  comprar. Habitualmente IV > HV (la "prima de riesgo de varianza"), dato que el ADR-012 cita como ≈ 1.1–1.2; **no está medido
  con datos del proyecto**.
- **En la app.** Core indicadores (`iv_promedio`, `hv_20`, `iv_hv_ratio`) y `confluencia.ajusteVolatilidad` (±15).
  IV y griegas vienen del snapshot de Alpaca con `feed=indicative` (cotizaciones derivadas/retrasadas, no OPRA).

### B.14 Las griegas como derivadas

Una griega es la **derivada parcial** del precio de la opción `V(S, σ, t, r)` respecto a una variable. En
`blackscholes.js → opcion` (con q = 0):

| Griega | Derivada | Fórmula (call) | Unidad en el código | Lectura |
|---|---|---|---|---|
| Delta Δ | ∂V/∂S | `N(d1)` (put: `N(d1) − 1`) | por 1 USD de S | "acciones equivalentes" por acción |
| Gamma Γ | ∂²V/∂S² | `φ(d1)/(S·σ·√T)` | por 1 USD | cuánto cambia la delta |
| Theta Θ | ∂V/∂t | `−S·φ(d1)·σ/(2√T) − r·K·e^(−rT)·N(d2)` | **por día natural** (anual/365) | pérdida diaria por el paso del tiempo |
| Vega | ∂V/∂σ | `S·φ(d1)·√T` | **por 1 punto** de volatilidad (/100) | sensibilidad a la IV |
| Rho | ∂V/∂r | `K·T·e^(−rT)·N(d2)` | por 1 punto porcentual (/100) | sensibilidad a la tasa |

**Ejemplo (ejecutado) que muestra que son derivadas.** Call ATM, S = K = 100, 30 días, σ = 30 %, r = 4 %: precio 3.5911,
Δ 0.5324, Γ 0.0462, Θ −0.0624/día, vega 0.114, rho 0.0408. Comprobación con diferencias finitas:

| Cambio | Predicción con la griega | Cambio real (recalculando) |
|---|---|---|
| S de 100 a 101 | Δ ≈ +0.532 (más ½Γ ≈ +0.023) | **+0.5553** |
| Δ cuando S pasa a 101 | Γ ≈ +0.0462 | **+0.0457** |
| σ de 30 % a 31 % | vega ≈ +0.114 | **+0.1140** |
| Un día menos (30 → 29) | Θ ≈ −0.0624 | **−0.0629** |

Put del mismo ejemplo: Δ −0.4676, Θ −0.0515/día. Delta de un contrato = Δ × 100: comprar 1 call ATM ≈ tener 53 acciones.

### B.15 Black-Scholes: intuición y fórmula

**Intuición.** El precio de un call es el **valor esperado descontado** de su pago `max(0, S_T − K)`, suponiendo que el
precio futuro sigue una distribución **lognormal** (su logaritmo es normal) con volatilidad σ. Es "lo que costaría
fabricar el call" comprando y vendiendo la acción continuamente (cobertura delta).

**Supuestos** (`blackscholes.js`, comentario de cabecera): opción **europea** (solo se ejerce al vencimiento), σ y r
constantes, sin costos ni spreads, precio lognormal (movimiento browniano geométrico), dividendo continuo q (el código usa
q = 0), negociación continua.

**Fórmulas (`d1d2`, `opcion`).**

```
d1 = [ ln(S/K) + (r − q + σ²/2)·T ] / (σ·√T)        d2 = d1 − σ·√T
Call = S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2)
Put  = K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)
```

- `N(x)` = probabilidad de que una normal estándar sea ≤ x. Se aproxima con **Abramowitz & Stegun 26.2.17** (`cdf`):
  `t = 1/(1 + 0.2316419·|x|)`, `1 − N(|x|) = φ(|x|)·t·(0.319381530 − 0.356563782t + 1.781477937t² − 1.821255978t³ + 1.330274429t⁴)`,
  error < 7.5·10⁻⁸; para x < 0 se usa `N(x) = 1 − N(−x)`. `φ(x) = e^(−x²/2)/√(2π)` (`pdf`).
  Valores (ejecutado): N(0) = 0.5000000, N(1) = 0.8413447, N(1.645) = 0.9500151, N(1.96) = 0.9750022.
- `T` = años, en **días naturales / 365** (`DIAS_ANIO = 365`), mientras que la HV se anualiza con 252 sesiones. Son
  convenciones distintas para cosas distintas: T mide tiempo de calendario (la mayoría de proveedores de griegas lo hace así);
  √252 escala la varianza de las sesiones de negociación.

**Por qué N(d2) es una probabilidad "neutral al riesgo".** Bajo la medida neutral al riesgo, `ln S_T ~ Normal(ln S + (r − σ²/2)T, σ²T)`.
Entonces `P[S_T > K] = P[Z > (ln(K/S) − (r − σ²/2)T)/(σ√T)] = N(d2)`. Es la probabilidad de terminar ITM **si la deriva
de la acción fuera la tasa libre de riesgo r**, no su rendimiento real esperado (que incluye prima de riesgo). Por eso el
código la llama "neutral al riesgo" y advierte que no es una probabilidad del mundo real (`probabilidadSobre`,
`probabilidadITM`). `N(d1)`, en cambio, es la delta.

**Ejemplo de libro (ejecutado; también es una prueba en `tests/cores.test.cjs`).** S = 100, K = 100, T = 1, r = 0.05, σ = 0.20:

```
d1 = [ln(1) + (0.05 + 0.02)·1] / 0.20 = 0.35        d2 = 0.35 − 0.20 = 0.15
N(d1) = 0.6368   N(d2) = 0.5596
Call = 100·0.6368 − 100·e^(−0.05)·0.5596 = 10.4506
Put  = 5.5735     Δ call 0.6368 / put −0.3632   Γ 0.018762   vega 0.3752/punto   Θ −0.01757/día   rho 0.5323/punto
```

**Paridad put-call.** `C − P = S − K·e^(−rT)`: un call comprado + un put vendido con el mismo K replican un forward.
Comprobación (ejecutado): `10.4506 − 5.5735 = 4.8771 = 100 − 100·e^(−0.05)`. Sirve para detectar errores de fórmula: si
no se cumpliera, habría un arbitraje.

**¿Y las opciones americanas?** Las de acciones de EE. UU. se pueden ejercer antes. Para un call sin dividendos el valor
coincide con el europeo; para puts Black-Scholes es una aproximación (subestima levemente). Está documentado en el código.

### B.16 Las tres estrategias, con tabla de payoff

**Long Call** (alcista) y **Long Put** (bajista): ver B.12.

**Iron Condor** (neutral): cuatro patas, mismo vencimiento y cantidad:

```
 compra put K1  <  vende put K2  <  vende call K3  <  compra call K4
   (ala)            (pata corta)      (pata corta)        (ala)
```

Cobras un **crédito** neto. Ganas el crédito completo si al vencimiento K2 ≤ S_T ≤ K3. Las alas limitan la pérdida.

- Crédito por acción `c = prima(K2) + prima(K3) − prima(K1) − prima(K4)`.
- Ganancia máxima = `c × 100`. Ancho = `max(K2 − K1, K4 − K3)`. Pérdida máxima = `(ancho − c) × 100`.
- Breakevens: `K2 − c` y `K3 + c`.

**Ejemplo (ejecutado).** 90/95/105/110 con primas 0.60/1.50/1.40/0.50 → `c = 1.50 + 1.40 − 0.60 − 0.50 = 1.80`.
Ganancia máxima 180, ancho 5, pérdida máxima `(5 − 1.80)·100 = 320`, breakevens **93.20** y **106.80**.

| S_T | 80 | 85 | 90 | 93.20 | 95 | 100 | 105 | 106.80 | 110 | 115 | 120 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Iron Condor | −320 | −320 | −320 | 0 | 180 | 180 | 180 | 0 | −320 | −320 | −320 |

```
 Ganancia      Iron Condor 90/95/105/110, crédito 1.80
   +180 |              ___________________
        |             /                   \
      0 |-----------/-93.2-----------106.8-\----------- S_T
   −320 |__________/                         \__________
        80   90   95        100        105   110      120
```

### B.17 Crédito vs débito

- **Débito**: pagas al abrir (compras más de lo que vendes). Long Call/Put son débitos.
- **Crédito**: cobras al abrir (vendes más de lo que compras). El Iron Condor es crédito.
- **Convención del código.** `estrategias.core.js`: `prima_neta = Σ −signo·precio·cantidad·100`, con signo +1 compra y −1
  venta; **`prima_neta > 0` = crédito**. Long Call de 3.60 → `prima_neta = −360` (débito); Iron Condor → `+180` (crédito).
  En la interfaz: `netoMid` = Σ ventas − Σ compras a mid; > 0 = crédito.
- **Convención de Alpaca** para órdenes multi-pata: `limit_price` positivo = débito, **negativo = crédito** (ver §G.5).

### B.18 Órdenes: market, limit, day, gtc, multi-pata, paper

| Término | Qué es | En la app |
|---|---|---|
| Market | Se ejecuta ya al mejor precio disponible; sin control de precio | `tipo: 'market'` (no lleva `precioLimite`) |
| Limit | Solo se ejecuta a `limit_price` o mejor | `tipo: 'limit'` + `precioLimite > 0`; es el **defecto del ticket** |
| day | Expira al cierre de la sesión | `vigencia: 'day'` (defecto) |
| gtc | "Good till canceled": vigente hasta cancelar | `vigencia: 'gtc'` |
| Multi-pata (`mleg`) | Una orden con varias patas que se ejecutan juntas | `order_class: 'mleg'` con `legs[]` |
| `position_intent` | Abrir o cerrar: `buy_to_open`, `sell_to_open`, `buy_to_close`, `sell_to_close` | `intencion` de cada pata |
| Paper trading | Cuenta simulada: precios reales, dinero ficticio | URL fija `https://paper-api.alpaca.markets` |

### B.19 Posición long y short

Long = compraste (ganas si el contrato sube de valor). Short = vendiste (ganas si baja). Cerrar un long = `sell_to_close`;
cerrar un short = `buy_to_close` (`operacion.service.js → cierre`).

### B.20 Look-ahead bias (sesgo de anticipación)

Usar información que **no se conocía** en la fecha que se simula. Ejemplo: decidir "hoy" usando un 10-Q que se presentó un
mes después. Los cores reciben `fechaReferencia` ("hoy") y descartan todo lo posterior (§D.0).

---

## C. Arquitectura explicada como recorrido

### C.1 Componentes

```
┌──────────────────────────────── Navegador ───────────────────────────────────┐
│ React 18 + Vite (web/src)                                                     │
│  pages/ (Analizar, Mercado, Broker, Seleccion, Perfiles, Configuraciones…)    │
│  components/ (TicketOrden, BotonOperar, CandleChart, Sparkline, PayoffChart…) │
│  api/client.js: fetch + "Authorization: Bearer <token>" (token en sessionStorage)
└───────────────▲──────────────────────────────────────────────┬────────────────┘
                │ JSON                                          │ /api/v1/...
┌───────────────┴──────────────────────────────────────────────▼────────────────┐
│ Express 5 (src/app.js) · /health · /api/v1 · Swagger /api/v1/api-docs · web/dist │
│  routes/index.js → /sesiones (pública) │ resto protegido por authenticate()     │
│  routes/acciones.routes.js: sincronizar, evaluar cores, selección, ticket…      │
│  services/: sesiones · sincronizacion · analisis · operacion · broker · crud    │
│  jobs/cola.js: cola en memoria, concurrencia 2  (POST → 202 → sondeo GET)       │
│  cores/: funciones puras (sin red, sin base, sin reloj)                         │
└──────┬───────────────────────────────────┬───────────────────────┬────────────┘
       │ repositories/index.js             │                       │ integrations/
┌──────▼──────────┐  o  ┌──────────────────▼──┐   ┌────────────────▼──────────────────────┐
│ MongoDB         │     │ Supabase (Postgres)  │   │ alpaca.client.js  data.alpaca.markets  │
│ colecciones     │     │ tablas api_* vía     │   │                   paper-api (solo paper)│
│ api_* (document,│     │ REST /rest/v1        │   │ sec.client.js     data.sec.gov,         │
│ owner_id,       │     │ (service role)       │   │                   www.sec.gov           │
│ revision)       │     │                      │   │ institucionales.js 9 filers 13F         │
└─────────────────┘     └──────────────────────┘   └────────────────────────────────────────┘
```

**Capas y responsabilidades.**

| Capa | Archivos | Regla |
|---|---|---|
| Rutas | `src/api/v1/routes/*.routes.js` | Solo HTTP: leer body/params/headers, llamar al servicio, responder |
| Controladores CRUD | `controllers/crud.controller.js` | Paginación, `ETag`/`If-Match` (control optimista con `_revision`) |
| Servicios | `services/*.service.js` | Orquestan: validan, leen/escriben en el repositorio, llaman a integraciones y cores |
| Cores | `src/cores/*.js` | **Puros** (ADR-001): mismo input → mismo output |
| Repositorios | `src/repositories/` | Persistencia; **siempre filtran por dueño** (`owner_id`) |
| Integraciones | `src/integrations/` | Hablan con proveedores; normalizan datos y errores (`IntegrationError`) |
| Modelos | `src/api/v1/models/*.js` | Esquemas mongoose `strict: 'throw'`; validan **también para Supabase** |

### C.2 Secuencia 1: inicio de sesión y elección de base

```
Login.jsx           AuthContext.login     POST /api/v1/sesiones          sesiones.service.login            repositorio
   │ select baseDatos   │                    │ loginLimit (10/min/IP)          │                                 │
   │ (mongodb|supabase) │──────────────────► │───────────────────────────────►│ valida email/password/baseDatos │
   │                    │                    │                                 │ users() ← AUTH_USERS_JSON o     │
   │                    │                    │                                 │   private/users.json            │
   │                    │                    │                                 │ scrypt(password, salt, 64)      │
   │                    │                    │                                 │ timingSafeEqual(hash, derivado) │
   │                    │                    │                                 │ token = baseDatos.userId.       │
   │                    │                    │                                 │   sesionId.random(32 bytes hex) │
   │                    │                    │                                 │ guarda {tokenHash: sha256(token),│
   │                    │                    │                                 │   expiraEn: ahora+3600 s} ─────►│ repository('sesiones',
   │ ◄──────────────────│◄───────────────────│◄────────────────────────────────│   {userId, database})           │   ctx)
   │ token en sessionStorage ('opciones.sesion')
   ▼
Cada petición: Authorization: Bearer <token>
   │
   ▼
auth.handler.js → authenticate(service): regex "Bearer (\S+)" → sesiones.service.authenticate(token)
   · separa las 4 partes, valida formato (baseDatos ∈ {mongodb,supabase}, 2 UUID, 64 hex)
   · lee la sesión en la base indicada por la PRIMERA parte del token
   · rechaza si no existe, revocada, expirada, baseDatos distinta o sha256(token) ≠ tokenHash
   · req.context = { database, userId, sessionId }
   ▼
Servicios → repositories/index.js → repository(name, context):
   context.database === 'mongodb'  → mongoRepository(name, userId)
   context.database === 'supabase' → supabaseRepository(name, userId)
```

Puntos finos para defender:

- **Por qué la base va dentro del token.** Así cada petición sabe a qué base ir sin estado en memoria del servidor; el token
  no sirve en la otra base porque la sesión solo existe en una y `baseDatos` debe coincidir.
- **Por qué se guarda `sha256(token)` y no el token.** Si alguien lee la base, no obtiene tokens utilizables.
- **Por qué `timingSafeEqual` y un salt falso cuando el usuario no existe.** Comparación en tiempo constante y mismo costo
  de scrypt exista o no el usuario: no se filtra por tiempo si un correo está registrado.
- **Usuarios.** No hay tabla de usuarios: vienen de `AUTH_USERS_JSON` (despliegue) o `AUTH_USERS_FILE`
  (`./private/users.json` por defecto). Se crean con `scripts/create-user.cjs` (scrypt, salt aleatorio de 16 bytes, contraseña
  ≥ 12 caracteres) y se exportan con `npm.cmd run exportar:usuarios`.
- **Cierre de sesión.** `DELETE /sesiones/actual` marca `revocadaEn`. El TTL (`SESSION_TTL_SECONDS`, 60–86400, defecto 3600)
  se valida al crear la app. Como `autoIndex` está desactivado y los documentos viven bajo `document.`, el índice del esquema
  `Sesion` no se crea solo: el repositorio de MongoDB crea el índice TTL `document.expiraEn` (`expireAfterSeconds: 0`) una vez por
  proceso en el primer acceso a `sesiones` (y `scripts/setup-mongodb.cjs` también lo crea). En Supabase no hay TTL: la expiración
  se hace cumplir en `authenticate` (`expiraEn` ≤ ahora → 401) y, además, el login purga las sesiones expiradas (mejor esfuerzo).

### C.3 Secuencia 2: sincronización (202 + cola + upsert determinista)

```
flujo.js / SyncButton      POST /sincronizaciones/ejecuciones            trabajos.service.iniciarTrabajo        cola.js
  {recurso, simbolos[],  ─► acciones.routes.js: valida recurso,       ─► crea registro "pendiente" ─────────► encolar(id, tarea)
   desde?, hasta?,           ≤ 25 símbolos, regex de símbolo             responde 202 con el registro          (concurrencia 2)
   diasVencimientoMin/Max?}                                                                                      │
  ◄─── 202 {_id, estado:'pendiente'}                                                                             ▼
  sondeo GET /sincronizaciones/:id cada 1.5 s (flujo.js → esperar)                  tarea: parchar "procesando" →
                                                                                     sincronizacion.service.ejecutar(ctx, registro)
                                                                                     → porSimbolo[recurso] o porConexion[recurso]
                                                                                     → parchar "completada" {procesados, fallidos}
                                                                                       o "fallida" {error: mensajeSeguro(e)}
```

Qué hace cada recurso (`src/api/v1/services/sincronizacion.service.js`):

| Recurso | Proveedor | Rango por defecto | Guarda |
|---|---|---|---|
| `empresas` | Alpaca `/v2/assets/{s}` + SEC `company_tickers.json` | — | `empresas` (nombre de la SEC, que coincide mejor con 13F, y `cik`) |
| `historicos` | Alpaca `/v2/stocks/bars` | **420 días** atrás (≈ 290 sesiones) o `desde`; hasta 10 000 velas | `datos-mercado` velas `1Day` |
| `cotizaciones` | Alpaca `/v2/stocks/snapshots` | — | `datos-mercado` `cotizacion` |
| `contratos` | Alpaca `/v2/options/contracts` + `/v1beta1/options/snapshots/{s}` | vencimientos **7–60 días** (`diasVencimientoMin ?? 7`, `diasVencimientoMax ?? 60`), strikes **±25 %** del precio | `contratos` + un `snapshot_opcion` por contrato |
| `noticias` | Alpaca `/v1beta1/news` | **14 días**, máx. 50 | `noticias` |
| `fundamentales` | SEC `companyfacts` | máx. 12 periodos | `fundamentales` |
| `institucional` | SEC `submissions` + `Archives/.../index.json` + XML | 2 cortes por gestor | `institucional` |
| `ordenes`, `posiciones` | Alpaca paper | requieren `conexionId` | estado de órdenes / posiciones |

**Upsert determinista.** `registros.js → idDeterminista(...partes)` = SHA-256 de las partes unidas por `|`, formateado
como UUID. La misma vela (`empresaId | 'vela' | '1Day' | fecha`) siempre produce el mismo `_id`, así que repetir una
sincronización **reemplaza en vez de duplicar**. `guardarLote` valida cada documento con el modelo y llama a
`repo.upsertMany` (Mongo: `bulkWrite` con `upsert: true` en lotes de 500; Supabase: `POST ... on_conflict=id` con
`resolution=merge-duplicates` en lotes de 100, rechazando ids que pertenezcan a otro dueño).

**Por qué 202 + cola.** Sincronizar o evaluar tarda segundos o minutos (13F: 1–3 min). Responder de inmediato con el registro
`pendiente` evita timeouts HTTP y deja trazabilidad (ADR-003). La cola es en memoria (`createCola({concurrencia: 2})`):
simple, pero **una sola instancia** y los trabajos en curso se pierden al reiniciar. Para que la interfaz no consulte para
siempre, al leer (GET por id o listado) un trabajo `pendiente`/`procesando` con más de 15 min sin actualizar (constante
`TIEMPO_MAX_TRABAJO_MS`) que no esté activo en la cola del proceso, se persiste como `fallida` con el error «Trabajo
interrumpido (servidor reiniciado o tiempo agotado). Vuelve a ejecutarlo.» (`trabajos-huerfanos.service.js`).

### C.4 Secuencia 3: análisis (insumos → core → Evaluación; selección → confluencia)

```
flujo.js ejecutarFlujo(simbolo, config)
  1) (opcional) sincroniza empresas → [historicos, cotizaciones, noticias, fundamentales, contratos, (institucional)] en paralelo
  2) por cada core activo: POST /cores/:core/evaluaciones {empresaId, parametros?:{indicadores}}   → 202
        analisis.service.ejecutarCore → iniciarTrabajo('evaluaciones')
          calcular(ctx, core, empresa, perfil, parametros):
            insumos(ctx, empresa, modulo.REQUIERE, parametros)     ← lee SOLO lo que el core declara en REQUIERE
              velas:        datos-mercado tipo 'vela' del intervalo (1Day), orden ascendente
              fundamentales: {periodoInicio, periodoFin, forma, metricas}
              reportes:     {fechaCorte, fechaPublicacion, tenencias}
              noticias:     las que tienen el símbolo en `simbolos`
              opciones:     último snapshot por contrato, solo strikes a ±5 % del último cierre
            modulo.evaluar({...input, fechaReferencia: new Date().toISOString(), parametros, reglas})
            → cambios {puntaje, cobertura, metricas (incluye sesgo y confianza), motivos, datosFaltantes, fuentes}
          Evaluacion "completada" con versionAlgoritmo, parametros, reglasAplicadas, fuentes
  3) POST /selecciones/ejecuciones {modo:'empresa', empresaId, coresSeleccionados, filtros?, ponderaciones}
        analisis.service.ejecutarSeleccion:
          por empresa: RECALCULA cada core (crea Evaluaciones nuevas) → por estrategia: combinar() → crea Confluencia
          resultados ordenados por puntaje desc, desempate por cobertura desc
```

`combinar()` (en `analisis.service.js`) toma el `sesgo` y la `confianza` de las **métricas guardadas** (4 decimales), las
ponderaciones del usuario (peso 1 si no hay) y `volatilidad = {ivActual: iv_promedio, hv20: hv_20}` del core indicadores,
y llama a `confluencia.evaluar`. Detalle en §E.

### C.5 Secuencia 4: orden paper

```
BotonOperar.jsx «Operar»
  cargarDatosAnalisis(empresa): última selección completada + estrategias + última evaluación por core
  cargarCadena(simbolo, {diasMin, diasMax}): GET /mercado/opciones/resumen/:simbolo → elegirVencimiento(…, diasMin, diasMax)
     (rango de «Configurar análisis», defecto 7–60) → recarga ese vencimiento
  construirPatas(codigo, items, precioSubyacente)       (web/src/utils/estrategiasOrden.js)
  contextoAnalisis(datos, codigo)                       (avisos: sin análisis, > 24 h, no es la mejor, contradicción)
     ▼
TicketOrden.jsx  editar → revisar → enviado
  select «Vencimiento» → cambiarVencimiento → reconstruirPatas (§G.3)
  netoMid, redondearPrecio, perfilRiesgo, advertencias; clave.current = uuid() (se reutiliza en reintentos)
  POST /api/v1/ordenes/ticket  + header Idempotency-Key
     ▼
acciones.routes.js → operacion.service.ticket(ctx, body, key)
  claveIdempotencia(key)  ─ /^[\w-]{8,128}$/
  existente(ctx, key)?  ── sí → devuelve la orden previa (200, repetida) sin reenviar
  validarOrdenBase: tipo, vigencia, credito, precioLimite, cantidad 1–100, 1–4 patas
  por pata: contrato de la empresa, proveedor alpaca, no vencido, sin repetir, intencion coherente
  estrategiaPorPatas (4 patas → IRON_CONDOR; 1 → LONG_CALL/LONG_PUT por tipo) si no viene estrategiaCodigo
  asegurarConexion: broker 'alpaca' + conexión paper credencialRef 'env:ALPACA' (crea si falta)
  crearYEnviar: Configuracion 'validada' + Orden 'pendiente' (idempotencyKey) → broker.service.enviar
     ▼
broker.service.enviar(ctx, ordenId, key)
  key debe coincidir con orden.idempotencyKey (si no, 409) · si ya hay ordenExternaId → devuelve (no reenvía)
  conexionOperable: broker alpaca, entorno 'paper', credencialRef env:ALPACA, no revocada
  alpaca.enviarOrden({clientOrderId: key, ...}) → construirCuerpoOrden → POST https://paper-api.alpaca.markets/v2/orders
  éxito: ordenExternaId + estado mapeado + evento 'enviada'   ·   fallo: evento 'error_envio' (la orden queda 'pendiente')
     ▼
TicketOrden: cada 2 s POST /sincronizaciones/ejecuciones {recurso:'ordenes', conexionId} + GET la orden, hasta estado final o 60 s
Cierre: POST /posiciones/:id/cierre (long → sell_to_close, short → buy_to_close, misma idempotencia)
```

### C.6 Modelo de datos

Todas las entidades tienen `_id` UUID, `createdAt`, `updatedAt` y (las del usuario) `usuarioId`. Esquemas en
`src/api/v1/models/` con `strict: 'throw'` (un campo desconocido es error 400, no se ignora en silencio).

| Colección (`resources.js`) | Modelo | Campos clave | Lo crea |
|---|---|---|---|
| `empresas` | Empresa | `simbolo`, `nombre`, `mercado`, `cik`, `activo` | sync `empresas` |
| `datos-mercado` | DatoMercado | `empresaId`, `tipo` (`vela`/`cotizacion`/`snapshot_opcion`), OHLCV, `bid/ask/ultimo`, `volatilidadImplicita`, `griegas{delta…rho}`, `contratoId`, `fuente{proveedor, fechaDato, feed}` | sync |
| `contratos` | ContratoOpcion | `proveedor`, `contratoExternoId` (OCC), `tipo`, `strike`, `vencimiento`, `multiplicador` | sync `contratos` |
| `fundamentales` | Fundamental | `periodoInicio`, `periodoFin`, `forma`, `metricas[]` | sync |
| `institucional` | ReporteInstitucional | `fechaCorte`, `fechaPublicacion`, `tenencias[{institucion, identificadorInstitucion, acciones, valorReportado}]` | sync |
| `noticias` | Noticia | `titulo`, `resumen`, `url`, `publicadaEn`, `simbolos[]` | sync |
| `evaluaciones` | Evaluacion | `core`, `empresaId`/`configuracionId`, `versionAlgoritmo`, `parametros`, `reglasAplicadas`, `estado`, `puntaje`, `cobertura`, `metricas[]`, `motivos[]`, `datosFaltantes[]`, `fuentes[]` | análisis |
| `confluencias` | Confluencia | `empresaId`, `estrategiaId`, `evaluacionesIds`, `coresSeleccionados`, `ponderaciones` (efectivas), `puntaje`, `cobertura`, `motivos` | análisis |
| `selecciones` | Seleccion | `modo`, `empresaId`/`estrategiaId`, candidatas, `coresSeleccionados`, `ponderaciones`, `filtros`, `resultados[{empresaId, estrategiaId, confluenciaId, puntaje, cobertura, motivos}]` | análisis |
| `perfiles-analisis` | PerfilAnalisis | `coresSeleccionados`, `parametros`, `reglas[]` (cada regla de un core seleccionado) | usuario |
| `estrategias` | Estrategia | `codigo` (LONG_CALL/LONG_PUT/IRON_CONDOR) | `asegurarEstrategias` |
| `configuraciones` | Configuracion | `empresaId`, `estrategiaId`, `estado`, `componentes[{contratoId, accion, cantidad}]` | usuario o ticket |
| `brokers`, `conexiones-broker` | Broker, ConexionBroker | `codigo`; `entorno` (`paper`/`live`), `credencialRef` (oculto), `estado` | `asegurarConexion` |
| `ordenes` | Orden | `conexionId`, `configuracionId`, `idempotencyKey`, `tipo`, `vigencia`, `cantidad`, `precioLimite`, `credito`, `estado`, `componentes[]`, `eventos[]`, `ordenExternaId` | ticket / cierre |
| `posiciones` | Posicion | `conexionId`, `contratoId`, `lado`, `cantidad`, `precioPromedio`, `estado` | sync `posiciones` |
| `sincronizaciones` | Sincronizacion | `recurso`, `simbolos`, `desde/hasta`, `diasVencimientoMin/Max`, `estado`, `procesados`, `fallidos` | sync |
| `sesiones` | Sesion | `usuarioId`, `baseDatos`, `tokenHash` (oculto), `expiraEn`, `revocadaEn` | login |
| `auditoria` | EventoAuditoria | `accion`, `recurso`, `recursoId`, `resultado` (`exito`/`error`), `requestId`, `ocurridoEn` | CRUD expuesto; eventos automáticos (mejor esfuerzo) vía `registrarEvento` en login/logout, órdenes, cierres, verificación de broker y creación de trabajos |

**Forma física (igual en las dos bases).** Cada fila es `{ _id | id, owner_id, document, revision }`: el documento completo
va en `document` (JSON), `owner_id` es el usuario y `revision` sirve para control optimista de concurrencia
(`replace` exige la revisión leída; si cambió → 409). Unicidad natural: índices únicos por dueño, p. ej.
`(owner_id, conexionId, idempotencyKey)` en órdenes (`database/schema.sql → api_ordenes_natural`; en Mongo los crea
`scripts/setup-mongodb.cjs` a partir de los índices `unique` del modelo).

### C.7 Repositorio dual: diseño y porqué

```
servicio ─► repository(name, ctx) ─┬─► mongoRepository(name, owner)    : colección api_*, consultas {owner_id, 'document.k': v}
                                   └─► supabaseRepository(name, owner) : REST /rest/v1/api_*, owner_id=eq.<id>, document->>k=eq.v
         interfaz común: list({offset, limit, filtro}) · get(id) · create(doc) · replace(id, doc, revision) · upsertMany(docs) · remove(id, revision)
```

- **Dónde se elige**: `src/repositories/index.js → repository(name, context)`, según `context.database`, que viene del token.
- **Por qué dos bases**: requisito del proyecto (comparar documental vs relacional) y demostrar que la lógica no depende de
  la base. Los **modelos mongoose validan para ambas** (`crud.service.js → validated`), así las reglas de negocio son
  idénticas.
- **Por qué `document` JSON también en Postgres**: un solo esquema físico genérico por tabla (`jsonb` con
  `CHECK (document->>'_id' = id)`) permite reutilizar la misma validación y el mismo repositorio para 19 recursos.
- **Seguridad por dueño**: toda consulta lleva `owner_id`; `filtroSeguro` solo acepta claves alfanuméricas y valores
  string (no se pueden inyectar operadores `$` de Mongo ni filtros PostgREST arbitrarios). En Supabase, RLS activado y
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated`: solo el servidor (service role) accede; la clave nunca llega al navegador.
- **Los datos no se copian entre bases**: lo dice la pantalla de login. Un usuario que entra con Supabase no ve lo
  sincronizado en Mongo.

### C.8 Estructura del frontend (`web/src`)

| Carpeta | Contenido |
|---|---|
| `App.jsx`, `main.jsx` | Rutas (react-router 6) protegidas por `RequireAuth`; `/` = Analizar |
| `api/client.js` | `request()`: añade el Bearer, convierte errores en `ApiError`; en 401 borra la sesión y emite `opciones:sesion-expirada` |
| `api/resources.js` | Funciones por recurso (`mercado.panorama`, `acciones.sincronizar`, `operacion.ticket`…) |
| `context/AuthContext.jsx` | `login`, `logout`, sesión en `sessionStorage` |
| `hooks/` | `useAsync` (carga + reload), `useJob` (sondeo de trabajos hasta `completada`/`fallida`), `useLookup` |
| `pages/` | `Analizar` (Inicio, Buscador, ConfigAnalisis, Progreso, Resultados, DetalleEmpresa, GraficoPanel, OpcionesGriegas, CarteraPaper, `flujo.js`), `Mercado` (pestañas Gráfico, Cotización, Cadena, Fundamentales, Institucional, Noticias), `Broker`, `Seleccion`, `Perfiles`, `Configuraciones`, `Estrategias`, `Empresas`, `Sincronizaciones`, `Auditoria`, `Panel`, `Login` |
| `components/` | `TicketOrden`, `BotonOperar`, `CandleChart` (lightweight-charts 4.2.1), `Sparkline` (SVG propio), `PayoffChart`, `Gauge`, `ResourceManager`, `SchemaForm`… |
| `utils/` | `estrategiasOrden.js` (armado de patas y riesgo), `velas.js` (agregación semanal/mensual, SMA, rangos), `format.js`, `constants.js`, `objects.js` (`uuid`) |

**"Mercado hoy"** (`pages/analizar/Inicio.jsx → Mercado`): pide `GET /mercado/panorama?simbolos=SPY,QQQ,DIA,IWM`.
Son **ETF** que siguen al S&P 500, Nasdaq 100, Dow Jones y Russell 2000. El servidor (`mercado.controller.js → panoramaSimbolo`)
consulta Alpaca directamente (no guarda en la base): velas diarias de los **últimos 70 días** (se quedan las últimas 45),
cotización actual, `cambioPct` contra el cierre previo; **caché por proceso de 5 minutos**. El mini gráfico es
`components/Sparkline.jsx`, un `<svg>` dibujado a mano (línea + área con degradado; verde si sube, rojo si baja).

**Gráficos de precio** (`pages/analizar/GraficoPanel.jsx`): pide hasta 10 000 velas guardadas; la sincronización normal trae
**420 días**; el botón **«Cargar histórico largo (10 años)»** sincroniza `desde = hace 10 años`, pero el feed IEX solo tiene
datos **desde 2020-07**, así que se guarda lo que el proveedor entregue. Los intervalos **semanal y mensual se calculan en
el navegador** (`web/src/utils/velas.js → agregar`: agrupa por lunes UTC o por mes; O de la primera, H máximo, L mínimo,
C de la última, volumen sumado). Rangos 1M…5A, YTD y Máx (`rangoVisible`); SMA 20/50/200 superpuestas.

### C.9 Configuración y despliegue

**Variables de entorno** (`src/config/config.js`, `src/integrations/index.js`):

| Variable | Defecto | Uso |
|---|---|---|
| `HOST`, `PORT` | `localhost`, 3000 | Escucha (Render: `0.0.0.0` y PORT asignado) |
| `API_URL` | `/api/v1` | Prefijo |
| `CONNECTION_STRING`, `DATABASE`, `DNS_SERVERS` | `mongodb://127.0.0.1:27017`, `db_opciones` | MongoDB |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | — | Supabase (exige HTTPS salvo localhost) |
| `AUTH_USERS_JSON` / `AUTH_USERS_FILE` | — / `./private/users.json` | Usuarios (JSON tiene prioridad) |
| `SESSION_TTL_SECONDS` | 3600 | Vida del token (60–86400) |
| `CORS_ORIGINS` | vacío = sin CORS | Orígenes permitidos (en producción todo es mismo origen) |
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_DATA_FEED` | —, —, `iex` | Alpaca (claves paper) |
| `SEC_USER_AGENT` | — | Obligatorio para la SEC (nombre y contacto) |

**Render** (`render.yaml`, `docs/despliegue-render.md`): un solo Web Service Node (plan free) que sirve API y `web/dist`.
Build: `npm ci --include=dev && npm run build && npm --prefix web ci --include=dev && npm --prefix web run build`; start:
`npm start`; health check `/health`; `autoDeploy: true`. Variables fijas: `NODE_VERSION=22`, `HOST=0.0.0.0`,
`API_URL=/api/v1`, `SESSION_TTL_SECONDS=3600`, `ALPACA_DATA_FEED=iex`, `DATABASE=db_opciones`. Secretos con `sync: false`
(se capturan en el panel, nunca en Git): `CONNECTION_STRING`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ALPACA_KEY_ID`,
`ALPACA_SECRET_KEY`, `SEC_USER_AGENT`, **`AUTH_USERS_JSON`** (salida de `npm run exportar:usuarios`: hashes scrypt, no
contraseñas, pero se trata como secreto). En Render no existe `private/users.json`; por eso existe `AUTH_USERS_JSON`.

### C.10 Decisiones de seguridad

| Decisión | Dónde | Por qué |
|---|---|---|
| **Solo paper** | `createAlpacaClient` lanza `NO_PERMITIDO` si la URL de trading no es exactamente `https://paper-api.alpaca.markets`; `broker.service.conexionOperable` y `operacion.cierre` rechazan `entorno !== 'paper'` (403) | Uso académico; habilitar live exigiría una ADR nueva (ADR-005) |
| **Credenciales por referencia** | `credencialRef = 'env:ALPACA'`; cualquier otra → 400; el campo se oculta (`hideSecrets`, `safeDocument`) | Las claves viven solo en variables del servidor (ADR-006) |
| **Secretos fuera de errores** | `createHttp({secretos: [id, secreto]})`; `mensajeSeguro` en trabajos | Un error del proveedor no filtra claves |
| **Contraseñas con scrypt** | `sesiones.service.js`, `create-user.cjs` | Derivación lenta con salt; comparación `timingSafeEqual` |
| **Tokens hasheados** | `tokenHash = sha256(token)` | Robo de base ≠ robo de sesiones |
| **Límite de login** | `loginLimit`: 10 intentos por minuto por IP | Freno a fuerza bruta |
| **Esquemas estrictos** | `strict: 'throw'`; `crud.service.input` prohíbe `_id`, `usuarioId`, claves con `$` o `.` | Sin inyección de campos ni operadores |
| **Filtrado por dueño** | Repositorios con `owner_id`; `obtener()` da "Referencia inexistente o ajena"; validación de referencias (`references`) | Un usuario nunca lee ni enlaza datos de otro |
| **Cuerpo ≤ 1 MB** | `express.json({limit:'1mb'})` | Evita abusos de memoria |
| **Token en sessionStorage** | `web/src/api/client.js` | Se pierde al cerrar la pestaña; riesgo XSS mitigado porque React escapa (ADR-007) |
| **Supabase cerrado** | RLS + `REVOKE` a `anon`/`authenticated`; clave secreta solo en servidor | El navegador no puede hablar con la base |

---

## D. Lógica de los cores

### D.0 El contrato común (lo que todos los cores comparten)

**Qué es un core.** Un módulo de `src/cores/` que exporta:

| Export | Qué es |
|---|---|
| `VERSION` | `'tecnico@1.1.0'`…; se guarda en la Evaluación como `versionAlgoritmo` |
| `REQUIERE` | Insumos que necesita (`'velas'`, `'opciones?'` = opcional). El servicio carga **solo** esos (`insumos()`) |
| `SENALES` | Catálogo `[{nombre, etiqueta, descripcion, pesoBase}]`, publicado en `GET /cores/catalogo` (ADR-010) |
| `evaluar(input)` | Función **pura**: `{simbolo, fechaReferencia, velas, fundamentales, reportes, noticias, opciones, parametros, reglas}` → `{sesgo, confianza, puntaje, cobertura, metricas, motivos, datosFaltantes, reglas}` |

**Pureza (ADR-001).** Sin red, sin base, sin `Date.now()`, sin azar. "Hoy" es `input.fechaReferencia` (el servicio pasa
`new Date().toISOString()`). Ventajas: se prueba sin red, es reproducible y se puede auditar (la Evaluación guarda
versión, parámetros, reglas y fuentes).

**El patrón de todos los cores:**

```
datos crudos ──► métricas (en su unidad natural: %, razón, índice)
             ──► señales en [−1, 1] (tanh, clamp o función por tramos)
             ──► filtrarSenales(lista, parametros)      (el usuario puede elegir qué señales cuentan)
             ──► combinar(señales con pesoBase)         → sesgo, confianza, cobertura
             ──► finalizar(...)                         → reglas del perfil, puntaje = 50 + 50·sesgo
```

#### `util.combinar(subsenales)`: las fórmulas

Entrada: `[{nombre, valor ∈ [−1,1] o null, peso = pesoBase}]`. V = las válidas (valor numérico y peso > 0); n = total.

```
cobertura    = |V| / n
sesgo        = clamp( Σ p·v / Σ p )                     promedio ponderado
consistencia = | Σ p·v | / Σ p·|v|                      1 si todas apuntan igual; → 0 si se cancelan
intensidad   = Σ p·|v| / Σ p                            qué tan lejos de 0 están, en promedio
confianza    = clamp( cobertura · (0.5·consistencia + 0.5·intensidad), 0, 1 )
sin válidas  → sesgo = null, confianza = 0
```

**Ejemplo mínimo (a mano).** Tres señales: A = +0.8 (peso 1), B = +0.4 (peso 1), C = −0.2 (peso 2), y una cuarta D sin dato.

```
Σp = 4          Σp·v = 0.8 + 0.4 − 0.4 = 0.8         Σp·|v| = 0.8 + 0.4 + 0.4 = 1.6
sesgo = 0.8/4 = 0.20          consistencia = 0.8/1.6 = 0.5          intensidad = 1.6/4 = 0.4
cobertura = 3/4 = 0.75        confianza = 0.75·(0.5·0.5 + 0.5·0.4) = 0.75·0.45 = 0.3375
```

Lectura: sesgo levemente alcista, con poca confianza porque las señales se contradicen (consistencia 0.5), son débiles
(intensidad 0.4) y falta una (cobertura 0.75).

**¿Por qué confianza = mitad consistencia + mitad intensidad?** Son dos fuentes distintas de duda: señales que discrepan
(consistencia baja) y señales que apuntan igual pero tibias (intensidad baja). Se promedian con igual peso; es una heurística
documentada, no un resultado estadístico. Multiplicar por la cobertura hace que **faltar datos baje la confianza**, sin
inventar valores.

#### `util.filtrarSenales(lista, parametros)` (ADR-010)

Si `parametros.indicadores` contiene **al menos una** señal de este core, solo esas entran en `combinar` (y la cobertura se
calcula sobre la lista reducida), con el motivo «Señales usadas: … (selección del usuario).». Si no contiene ninguna, se usan
todas. Las métricas se reportan siempre. En la interfaz, las casillas de «Configurar análisis → Métricas» producen esa lista
(`flujo.js → resolverConfig`). El core noticias no lo usa (tiene una sola señal).

#### `util.finalizar(...)` y reglas del perfil (`reglas.js`)

1. Descarta métricas no finitas (`metrica()` devuelve null: "no se inventan datos") y redondea a 4 decimales.
2. Añade `sesgo`, `confianza` y `cobertura` como métricas (así se guardan en la Evaluación).
3. `aplicarReglas`: una regla es `{core, criterio (nombre de métrica), operador, valorReferencia, valorSuperior?, peso ≥ 0, obligatoria, activo}`.
   Operadores `eq, ne, gt, gte, lt, lte, between` con tolerancia 1e-9.
   - `puntaje₀ = 50 + 50·sesgo`; `d = signo(sesgo)`.
   - No obligatoria: `puntaje += (cumplida ? +1 : −1)·d·peso` (empuja en la dirección del sesgo; con sesgo 0 no hace nada).
   - Obligatoria incumplida: al final `puntaje = 50` y `confianza = 0` («Resultado forzado a neutral»).
   - Métrica inexistente → `metrica:<criterio>` en `datosFaltantes`; regla mal formada → se ignora con motivo.
   - `puntaje = clamp(0, 100)`; `sesgo_final = (puntaje − 50)/50` para que `puntaje = 50 + 50·sesgo` siga siendo exacto.
4. `puntaje = round(50 + 50·sesgo, 2)`. **El puntaje de un core es un índice direccional (0 bajista, 50 neutral, 100 alcista),
   no una compatibilidad con una estrategia** (ADR-002).

Ejemplos (ejecutado, core técnico DEMO con sesgo 0.1742 → puntaje 58.71): regla no obligatoria `precio_vs_sma200 gt 0`, peso 5,
cumplida → **63.71** (sesgo 0.2742). Regla **obligatoria** `pendiente_20 gt 0`, incumplida (la pendiente es −0.26) →
**50**, confianza **0**.

#### ¿Por qué `tanh` y por qué `clamp`?

```
 tanh(x/escala)                                     clamp(x, −1, 1)
  +1 |                 ___________                   +1 |        ________
     |              .-'                                 |       /
     |            /     tanh(0.5)=0.46                   |      /
   0 |----------/-------- tanh(1)=0.76                 0 |-----/-----------
     |        /         tanh(2)=0.96                     |    /
  −1 |_____.-'          tanh(3)=0.995                 −1 |___/
       −2esc  0  +2esc                                     −1  0  +1
```

- **`tanh`** para magnitudes **sin tope natural** (porcentajes de distancia, crecimiento, pendiente): es suave, simétrica,
  vale 0 en 0 y **satura** (un +50 % no vale 10 veces más que un +5 %). La **escala** es el valor que da 0.76 ("señal clara")
  y 2·escala da 0.96 ("señal casi máxima"). Así cada escala se lee como "cuánto es mucho" para esa métrica.
- **`clamp` lineal** para magnitudes que **ya tienen un rango interpretable** o un punto neutro natural (cruce, %B,
  deuda/capital, razón corriente, posición en rango): una recta que se corta en ±1 es más fácil de explicar.
- **Función por tramos** (`senalOscilador`) para osciladores 0–100 con zonas extremas (§D.2).

**Ventanas y escalas: ¿fijas o variables?** Todas las ventanas, escalas, umbrales y `pesoBase` de los cinco cores son
**constantes fijas en el código** (con nombre y comentario de justificación). Lo único variable por el usuario dentro de
un core es: qué señales entran (`parametros.indicadores`), las reglas del perfil, y en noticias `vidaMediaDias` y
`ventanaDias`. Se dejaron fijas para que una Evaluación sea comparable con otra y trazable por `versionAlgoritmo` (ADR-010
lo deja en "debate abierto").

---

### D.1 Core técnico (`src/cores/tecnico.core.js`, `tecnico@1.1.0`)

**Pregunta que responde.** ¿La acción está en tendencia alcista o bajista, y con qué estructura de precio?

**Intuición financiera.** Las tendencias tienden a persistir (momentum de mediano plazo): una acción por encima de sus medias
de 50 y 200 días, con la media corta sobre la larga y cerca de máximos de un año, suele estar en fase alcista. Este core
**no** usa osciladores (RSI, MACD…), para no contar dos veces la misma información: eso es del core indicadores.

**Datos y origen.** `REQUIERE = ['velas']`. Velas diarias de `datos-mercado` (Alpaca, IEX, ajustadas por split). Solo las de
fecha ≤ `fechaReferencia` (`util.limpiarVelas`, que además descarta OHLC no finitos y ordena por fecha).

**Señales.**

| Señal | Métrica (fórmula) | Ventana | Mapeo a [−1, 1] | pesoBase |
|---|---|---|---|---|
| `precio_vs_sma50` | `(C/SMA50 − 1)·100` (%) | 50 | `tanh(%/5)` | 1 |
| `precio_vs_sma200` | `(C/SMA200 − 1)·100` (%) | 200 | `tanh(%/10)` | **1.5** |
| `cruce_sma50_200` | `dif = (SMA50/SMA200 − 1)·100`; estado = signo(dif) | 50/200 | `clamp(dif/5)` | 1 |
| `pendiente_20` | `pendienteRegresion(20 cierres)/promedio(20)·100` (%/vela) | 20 | `tanh(%/0.5)` | 1 |
| `posicion_rango_52s` | `clamp((C − mín)/(máx − mín), 0, 1)` con máx/mín intradía | 252 (mín. 60) | `2·(pos − 0.5)` | 0.75 |
| `volumen_relativo_20` | `vr = V_hoy / promedio(V de las 20 velas previas)` | 20 | `signo(C_t − C_{t−1})·clamp(vr − 1, 0, 1)` | **0.5** |

Métricas extra (sin señal): `diferencia_sma50_200`, `distancia_maximo_pct`, `distancia_minimo_pct`. Motivo adicional si hubo
cruce dorado o de la muerte en las últimas 20 velas (`VENTANA_CRUCE_RECIENTE`).

**Por qué esas ventanas y escalas (todas fijas).**

- **50 / 200**: convención universal del análisis técnico para mediano y largo plazo (`SMA_CORTA`, `SMA_LARGA`).
- **Escala 5 % (SMA50) y 10 % (SMA200)**: el precio se aleja más de una media larga que de una corta; un 5 % sobre la
  SMA50 o un 10 % sobre la SMA200 son desvíos "claros" en grandes empresas (heurística del comentario del código).
- **Cruce: 5 %** de separación entre medias satura la señal. Lineal (`clamp`) porque la separación ya es un "estado" acotado.
- **Pendiente: 20 velas** ≈ 1 mes bursátil; **0.5 %/vela** ≈ 10 % al mes = tendencia fuerte. La regresión usa los 20 puntos,
  así que un solo día raro pesa poco (a diferencia de `C_t/C_{t−20} − 1`).
- **Rango 52 semanas = 252 sesiones**, con mínimo **60** (≈ 3 meses) para que el rango sea informativo; si hay entre 60 y 251
  velas se usa lo disponible y se informa `velas<252`. Lineal porque "posición en el rango" ya está en [0, 1].
- **Volumen**: compara con las 20 velas **anteriores** (sin incluir la de hoy, para no compararla consigo misma). Solo el
  **exceso** de volumen (vr > 1) confirma la dirección de la última vela; vr ≥ 2 satura.

**Por qué esos pesos.** Heurística de experto escrita en el código: la tendencia de largo plazo (SMA200) es la más
persistente → 1.5; el volumen es una sola vela y con IEX es parcial → 0.5; la posición en rango es redundante con las medias
→ 0.75; el resto 1. **No hubo ajuste estadístico.**

**Ejemplo completo (ejecutado: `node scripts/guia/ejemplos.cjs tecnico`).** Serie DEMO de 280 velas: sube ≈ 0.22 USD/día
durante 265 días y retrocede ≈ 0.55 USD/día las últimas 15 sesiones; la última vela tiene volumen 1.65 M.

```
Datos:     C = 149.3557   C_previo = 152.1495   SMA50 = 154.3594   SMA200 = 139.0863
           pendiente 20 = −0.4056 USD/vela, promedio 20 = 155.2874
           máx 252 = 161.2333   mín 252 = 103.4281   V = 1 650 000   V medio 20 previas = 991 390
```

| Señal | Métrica | Cálculo del mapeo | Valor | Peso | p·v |
|---|---|---|---|---|---|
| precio_vs_sma50 | (149.3557/154.3594 − 1)·100 = −3.2416 % | tanh(−0.6483) | −0.5705 | 1 | −0.5705 |
| precio_vs_sma200 | +7.3835 % | tanh(0.7384) | +0.6281 | 1.5 | +0.9422 |
| cruce_sma50_200 | dif = +10.9811 % | clamp(2.196) | +1.0000 | 1 | +1.0000 |
| pendiente_20 | −0.4056/155.2874·100 = −0.2612 %/vela | tanh(−0.5224) | −0.4796 | 1 | −0.4796 |
| posicion_rango_52s | (149.36 − 103.43)/(161.23 − 103.43) = 0.7945 | 2·(0.7945 − 0.5) | +0.5890 | 0.75 | +0.4418 |
| volumen_relativo_20 | 1 650 000/991 390 = 1.6643 | signo(−2.79)·clamp(0.6643) | −0.6643 | 0.5 | −0.3321 |

```
Σp = 5.75    Σp·v = 1.0017    Σp·|v| = 3.7662
sesgo        = 1.0017/5.75 = 0.1742
consistencia = 1.0017/3.7662 = 0.2660        intensidad = 3.7662/5.75 = 0.6550
confianza    = 1 · (0.5·0.2660 + 0.5·0.6550) = 0.4605
puntaje      = 50 + 50·0.1742 = 58.71
```

Lectura: la tendencia de largo plazo es alcista (SMA200, cruce, rango), pero el corto plazo es bajista (precio bajo la
SMA50, pendiente negativa, vela bajista con volumen alto). El resultado es **levemente alcista con confianza baja**
(consistencia 0.27): el código "se da cuenta" de la contradicción interna. Motivos generados: «Precio bajo SMA50 (-3.24%).»,
«SMA50 sobre SMA200 (10.98%).», «Volumen 1.66× el promedio confirma la vela bajista.».

Variante (ejecutado): solo `precio_vs_sma200` + `pendiente_20` → sesgo 0.1851 = (1.5·0.6281 − 0.4796)/2.5, puntaje 59.26.

**Casos límite y datos faltantes.**

| Situación | Resultado |
|---|---|
| Sin velas | `datosFaltantes` incluye `velas`; sesgo null |
| Pocas velas | < 50: sin SMA50 (`velas<50`); < 200: sin SMA200 ni cruce (`velas<200`); < 20: sin pendiente; < 60: sin rango; < 21 o volumen inválido: `volumen<21` |
| Ninguna señal calculable | sesgo null, motivo «Sin velas suficientes para evaluar tendencia (mínimo 20).» |
| Solo 30 velas (ejecutado) | 2 de 6 señales (pendiente y volumen) → cobertura 0.3333, sesgo −0.5411, confianza 0.2569, puntaje 22.95; faltan `velas<50, velas<200, velas<60` |
| máx = mín en el rango | no hay señal de rango |
| Velas con fecha futura | se descartan (`limpiarVelas`) |

**Limitaciones.** La última vela puede ser la sesión en curso (cierre y volumen provisionales); volumen IEX de un solo
mercado; precios ajustados solo por split (no dividendos); escalas pensadas para grandes empresas (una acción muy volátil
satura antes).

---

### D.2 Core indicadores (`src/cores/indicadores.core.js`, `indicadores@1.1.0`)

**Pregunta que responde.** ¿Qué dice el **momentum** de corto plazo y en qué **régimen de volatilidad** estamos?

**Intuición.** Los osciladores detectan aceleración o agotamiento. La volatilidad no tiene dirección (no dice "sube" o
"baja"), pero es clave para opciones: por eso se mide y se pasa a la confluencia para el ajuste del Iron Condor.

**Datos y origen.** `REQUIERE = ['velas', 'opciones?']`. Velas como el técnico. Opciones: último snapshot por contrato con
strike a **±5 % del último cierre** (`analisis.service.js → insumos`; la IV de contratos muy ITM/OTM distorsiona el promedio
por la "sonrisa de volatilidad"). Proveedor: Alpaca snapshots `feed=indicative` (`impliedVolatility`, `greeks`).

**Señales direccionales.**

| Señal | Métrica | Ventana | Mapeo | pesoBase | Velas mínimas |
|---|---|---|---|---|---|
| `rsi_14` | RSI de Wilder | 14 | `senalOscilador(RSI, 30, 70)` | 1 | 15 |
| `macd_hist` | MACD − señal (EMA12 − EMA26, EMA9) | 12/26/9 | `tanh((hist/C·100)/0.5)` | 1 | 34 |
| `estocastico_k` | %K (y %D informativo) | 14/3 | `senalOscilador(%K, 20, 80)` | 0.75 | 16 |
| `bollinger_pctb` | %B con bandas SMA20 ± 2σ_pob | 20, 2 | `clamp(2·(%B − 0.5))` | 0.75 | 20 |

**Métricas de volatilidad (no direccionales):** `atr_pct = ATR14/C·100`; `hv_20`, `hv_60` (retornos log, desviación muestral
× √252); con opciones: `iv_promedio` (promedio simple de IV de contratos **no vencidos** —vencimiento ≥ referencia − 1 día—
con `0 < IV ≤ 5`) e `iv_hv_ratio = iv_promedio/hv_20`.

**La función `senalOscilador(v, bajo, alto)`** (continua por tramos):

```
v entre bajo y alto:  (v − 50)/(alto − 50)  si v ≥ 50      (v − 50)/(50 − bajo)  si v < 50
v > alto:             1 − (v − alto)/(100 − alto)          (de +1 en "alto" a 0 en 100)
v < bajo:             −1 + (bajo − v)/bajo                 (de −1 en "bajo" a 0 en 0)

 señal
  +1 |                  /\                 RSI (30/70), ejecutado:
     |                /    \               0→0   10→−0.33  20→−0.67  30→−1   40→−0.5
   0 |\------------/--------\------ RSI    50→0  60→0.5    70→1      80→0.67 85→0.5  90→0.33  100→0
     |  \        /
  −1 |    \/                               Estocástico (20/80): 10→−0.5  20→−1  35→−0.5  65→0.5  80→1  90→0.5
     0   30  50  70    100
```

**Por qué esa forma.** Dentro de la zona normal, más RSI = más momentum alcista. En sobrecompra (RSI > 70) el momentum
sigue siendo alcista pero **se está agotando**: la señal baja hacia 0 en vez de saltar a −1. El código **no apuesta a la
reversión** (no la invierte), porque una acción puede seguir sobrecomprada semanas en una tendencia fuerte; tampoco premia
el extremo. Es una postura conservadora documentada en el comentario de `senalOscilador`.

**Por qué esas ventanas.** Son las **definiciones originales** de cada indicador: RSI 14 y ATR 14 (Wilder, 1978), MACD 12/26/9
(Appel), estocástico 14/3 (Lane), Bollinger 20/2; HV 20 ≈ 1 mes y 60 ≈ 3 meses bursátiles. No se optimizaron (optimizarlas
sobre datos pasados invitaría a sobreajuste). **MACD escala 0.5 %**: el histograma está en dólares; se divide por el precio
para que sea comparable entre acciones de 20 y de 900 USD, y un 0.5 % del precio se considera momentum marcado (heurística).

**Pesos.** RSI y MACD (los más usados) 1; estocástico y %B (más ruidosos) 0.75.

**Cobertura y confianza (distintas de los otros cores).**

```
cobertura = (direccionales calculadas + volatilidades calculadas) / (n_direccionales + 3, o + 4 si hay opciones)
confianza = confianza_combinar · cobertura / cobertura_direccional
si HV20/HV60 > 1.5 → confianza × 0.8  («Volatilidad en expansión»: los osciladores fallan más en rupturas)
```

Así, que falte la IV o la HV60 baja la confianza aunque no cambie la dirección.

**Ejemplo completo (ejecutado: `node scripts/guia/ejemplos.cjs indicadores`).** Misma serie DEMO + 6 contratos (4 cerca del
dinero con IV 0.24, 0.26, 0.23, 0.27; uno **vencido** con IV 0.90 y uno con IV **7.5** absurda).

| Métrica | Valor | Señal | Cálculo | Peso | p·v |
|---|---|---|---|---|---|
| rsi_14 | 40.50 | −0.4749 | (40.50 − 50)/(50 − 30) | 1 | −0.4749 |
| macd_hist | −0.7221 USD (−0.4834 % del precio) | −0.7474 | tanh(−0.4834/0.5) | 1 | −0.7474 |
| estocastico_k | 6.52 (%D 28.09) | −0.3258 | −1 + (20 − 6.52)/20 (sobreventa atenuada) | 0.75 | −0.2444 |
| bollinger_pctb | 0.0184 (bandas 149.13–161.45) | −0.9632 | 2·(0.0184 − 0.5) | 0.75 | −0.7224 |
| atr_pct | 2.30 % | — | no direccional | — | — |
| hv_20 / hv_60 | 0.2267 / 0.2289 | — | razón 0.99 < 1.5: sin expansión | — | — |
| iv_promedio | **0.25** | — | (0.24+0.26+0.23+0.27)/4; vencido y 7.5 excluidos | — | — |
| iv_hv_ratio | 1.1028 | — | pasa a la confluencia | — | — |

```
Σp = 3.5   Σp·v = −2.1891   sesgo = −0.6254   consistencia = 1   intensidad = 0.6254
confianza_combinar = 1·(0.5 + 0.3127) = 0.8127;  cobertura total = (4 + 4)/(4 + 4) = 1  →  confianza 0.8127
puntaje = 50 − 50·0.6254 = 18.73
```

Lectura: el retroceso de 15 días se ve claramente en el momentum (todas las señales negativas, consistencia 1). Nota fina:
el estocástico está en sobreventa extrema (6.5), así que su señal se **atenúa** a −0.33 en lugar de −1. Junto con el técnico
(+0.17) ya tenemos un caso de desacuerdo entre cores, que la confluencia tratará en §E.

**Casos límite.** `datosFaltantes` posibles: `velas`, `velas<15`, `velas<34`, `velas<16`, `velas<20`, `velas<21`, `velas<61`,
`opciones.volatilidadImplicita`. Sin opciones el denominador de cobertura es 4 + 3 (la IV no penaliza). Con
`máx = mín` en 14 velas, %K = 50; con `superior = inferior`, %B = 0.5; sin pérdidas en el RSI, 100 (o 50 si no hubo cambios).

**Limitaciones.** IV indicativa (no OPRA); `iv_promedio` mezcla todos los vencimientos sincronizados (7–60 días por defecto) y
HV20 mira 20 sesiones: horizontes distintos; no hay IV Rank porque solo se guarda el último snapshot por contrato.

---

### D.3 Core fundamental (`src/cores/fundamental.core.js`, `fundamental@1.1.0`)

> Aclaración que suelen preguntar: **el core fundamental NO usa Black-Scholes.** Usa estados financieros de la SEC.
> Black-Scholes solo está en `blackscholes.js`, usado por `estrategias.core.js`.

**Pregunta que responde.** ¿La empresa crece, es rentable, está muy endeudada, tiene liquidez?

**Intuición.** A mediano plazo el precio sigue a los resultados. Una empresa que crece en ventas y utilidad con buenos márgenes
y balance sano tiene viento a favor.

**Datos y origen.** `REQUIERE = ['fundamentales']`. SEC `GET data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
(`sec.client.js → construirFundamentales`), formas 10-K, 10-Q, 10-K/A, 10-Q/A, máx. 12 periodos. El CIK sale de
`www.sec.gov/files/company_tickers.json`. Se usan los **frames calendario** de la SEC (`CY2025`, `CY2025Q3`, instantes
`CY2025Q3I`) para no duplicar cifras comparativas que aparecen en varios informes. Conceptos us-gaap (`METRICAS_SEC`, en orden
de preferencia):

| Métrica | Conceptos |
|---|---|
| ingresos | `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, `RevenueFromContractWithCustomerIncludingAssessedTax` |
| utilidad_neta | `NetIncomeLoss`, `ProfitLoss`, `NetIncomeLossAvailableToCommonStockholdersBasic` |
| pasivos / capital | `Liabilities` / `StockholdersEquity`, `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| activo / pasivo circulante | `AssetsCurrent` / `LiabilitiesCurrent` |
| flujo_operativo | `NetCashProvidedByUsedInOperatingActivities`, `…ContinuingOperations` |
| eps_diluido | `EarningsPerShareDiluted`, `EarningsPerShareBasicAndDiluted` (se reporta, sin señal) |
| activos | `Assets` (se sincroniza, el core no lo usa) |

**Selección de periodos.**

1. **Sin anticipación**: un periodo cuenta si `fechaPresentacion ≤ ref` o, si no viene, `periodoFin ≤ ref`.
   **El servicio no pasa `fechaPresentacion`** (`insumos()` solo envía `periodoInicio, periodoFin, forma, metricas`), así que
   en producción se usa `periodoFin`. Hoy no importa (ref = ahora); en un backtest adelantaría información ~1–2 meses.
2. **Tipo por duración** (`tipoPeriodo`): 330–400 días = anual; 80–100 = trimestral; si no hay fechas, por `forma`.
3. **Periodo base** = el anual o trimestral más reciente con ingresos.
4. **Comparable** = mismo tipo con cierre `365 ± 25` días antes (los 25 cubren años fiscales de 52/53 semanas). Nunca se
   mezcla un trimestre con un año. (El Q4 fiscal no aparece como trimestre en XBRL, solo el anual; si el último periodo es
   anual, se compara anual vs anual.)
5. **Saldos** (pasivos/capital, circulantes): el periodo más reciente que tenga ambos valores.

**Señales.**

| Señal | Fórmula | Mapeo | pesoBase | Por qué esa escala / mapeo |
|---|---|---|---|---|
| `crecimiento_ingresos_yoy` | `(I₀/I₁ − 1)·100`, I₁ > 0 | `tanh(g/10)` | **1.5** | +10 % anual ya es buen crecimiento; los ingresos son la variable más persistente → más peso |
| `crecimiento_utilidad_yoy` | `(U₀ − U₁)/\|U₁\|·100`, U₁ ≠ 0 | `tanh(g/20)` | 1 | La utilidad es más volátil → escala doble. `\|U₁\|` hace que pasar de −20 a −5 sea **+75 %** (mejora, ejecutado), no −75 % |
| `margen_neto` | `U₀/I₀·100` | `tanh(m/10)` | 1 | 10 % ≈ mediana del S&P 500 según el comentario del código (no verificado aquí) |
| `deuda_capital` | `pasivos/capital`; capital ≤ 0 → señal −1 | `clamp(1.5 − d)` | 1 | Neutro en 1.5 ("típico"): d = 0.5 → +1; 2.5 → −1. Lineal porque tiene punto neutro natural |
| `razon_corriente` | `AC/PC` | `clamp(rc − 1)` | 0.75 | rc = 1 neutro, ≥ 2 sólido; menos peso (la liquidez rara vez decide sola) |
| `margen_flujo_operativo` | `FO/I₀·100` | `tanh(m/15)` | 1 | El flujo suele superar a la utilidad → escala mayor |

**Ejemplo completo (ejecutado: `node scripts/guia/ejemplos.cjs fundamental`).** Trimestres DEMO (USD, B = miles de millones):

| Periodo | Ingresos | Utilidad | Flujo op. | Pasivos | Capital | AC | PC |
|---|---|---|---|---|---|---|---|
| Q3-2026 (07-01 → 09-30) | 12.0 B | 1.8 B | 2.6 B | 30 B | 20 B | 15 B | 10 B |
| Q2-2026 | 11.4 B | 1.6 B | 2.2 B | | | | |
| Q3-2025 | 10.5 B | 1.7 B | 2.1 B | | | | |
| Año 2025 (10-K) | 42.0 B | 6.5 B | | | | | |

Periodo base Q3-2026; comparable Q3-2025 (365 días antes). Q2-2026 y el anual **no** se usan para el YoY.

| Señal | Métrica | Valor | Peso | p·v |
|---|---|---|---|---|
| crecimiento_ingresos_yoy | (12.0/10.5 − 1)·100 = 14.2857 % | tanh(1.4286) = 0.8914 | 1.5 | 1.3371 |
| crecimiento_utilidad_yoy | (1.8 − 1.7)/1.7·100 = 5.8824 % | tanh(0.2941) = 0.2859 | 1 | 0.2859 |
| margen_neto | 1.8/12·100 = 15 % | tanh(1.5) = 0.9051 | 1 | 0.9051 |
| deuda_capital | 30/20 = 1.5 | clamp(0) = 0 | 1 | 0 |
| razon_corriente | 15/10 = 1.5 | clamp(0.5) = 0.5 | 0.75 | 0.375 |
| margen_flujo_operativo | 2.6/12·100 = 21.6667 % | tanh(1.4444) = 0.8946 | 1 | 0.8946 |

```
Σp = 6.25   Σp·v = 3.7977 = Σp·|v|  → consistencia 1
sesgo = 0.6076   intensidad = 0.6076   confianza = 0.5·1 + 0.5·0.6076 = 0.8038   puntaje = 80.38
```

`eps_diluido` 1.42 se reporta sin señal. Siempre se añade el motivo «Pasivos totales se usan como aproximación de deuda…».
Variante (ejecutado): con capital −2 B la señal de deuda pasa a −1 y el sesgo baja a 0.4476.

**Casos límite.** `datosFaltantes`: `fundamentales`, `fundamentales.periodo_flujo`, `fundamentales.periodo_comparable_yoy` y el
nombre de cada señal no calculable. Sin comparable no hay crecimientos (pero sí márgenes y balance).

**Limitaciones.** `deuda_capital` usa **pasivos totales** (incluye proveedores, impuestos diferidos…), no deuda financiera;
empresas con capital negativo por recompras de acciones reciben −1 aunque sean sanas; no hay valuación (P/E): una empresa
excelente pero carísima puntúa alto.

---

### D.4 Core institucional (`src/cores/institucional.core.js`, `institucional@1.1.0`)

**Pregunta que responde.** ¿Los grandes gestores **aumentaron o redujeron** su posición en la empresa entre los dos últimos
trimestres?

**Intuición.** Compras agregadas de grandes instituciones indican demanda de fondo. Pero el dato llega tarde (hasta 45 días) y
muchos gestores son indexados (compran por flujo de sus fondos, no por convicción): por eso es una señal débil.

**Datos y origen.** `REQUIERE = ['reportes']`. Sincronización `institucional` (`sec.client.js → tenencias13F`):

1. Para cada uno de los **9 filers** de `src/integrations/institucionales.js` (CIK verificados 2026-11-16): Vanguard Capital
   Management LLC (0002100119), Vanguard Portfolio Management LLC (0002100121), BlackRock, Inc. (0002012383), State Street Corp
   (0000093751), FMR LLC (0000315066), Berkshire Hathaway Inc (0001067983), Geode Capital Management, LLC (0001214717),
   Morgan Stanley (0000895421), JPMorgan Chase & Co (0000019617). (Vanguard Group presenta 13F-NT desde 2026 y sus tenencias
   van en las dos LLC; BlackRock usa el CIK 2012383 desde 2024: notas del propio archivo.)
2. `GET data.sec.gov/submissions/CIK….json` → los 2 últimos **13F-HR** (uno por fecha de corte).
3. `GET www.sec.gov/Archives/edgar/data/{cik}/{accn}/index.json` → el XML de la tabla de información → `parsearTabla13F`.
4. Filtra filas: excluye `PRN` (bonos) y opciones (`putCall`), y **coincide por `nameOfIssuer` normalizado**
   (`normalizarEmisor`: mayúsculas, quita signos y sufijos INC, CORP, CO, LTD, PLC, CLASS, A/B/C…; "Apple Inc." ≈ "APPLE INC").
   El nombre buscado es el de la SEC (guardado al sincronizar `empresas`), que coincide mejor que "Apple Inc. Common Stock" de
   Alpaca. El adaptador acepta CUSIP, pero **la sincronización no lo envía**.
5. Suma las filas por gestor (varias clases/subgestores) y agrupa por fecha de corte. Respeta la SEC: `User-Agent` obligatorio y
   ≥ 100 ms entre solicitudes (≤ 10/s). Es lenta (tablas XML grandes): la interfaz avisa "1–3 min".

**Algoritmo del core.**

1. Solo reportes con `fechaPublicacion ≤ ref` (anti look-ahead). Reportes con igual `fechaCorte` se combinan.
2. A = corte más reciente, B = el anterior. Con menos de 2 cortes → sin sesgo (`reportes<2` o `reportes`).
3. **Panel balanceado**: solo instituciones presentes en A **y** B. Las "nuevas" y las que "salen" se informan pero no entran
   en la señal, porque pueden ser 13F aún no presentados o nombres que no coincidieron (antes de 1.1.0 se contaban como
   ventas y generaban un sesgo bajista artificial).
4. **Split**: si hay ≥ 3 comunes y la **mediana** de `A_i/B_i` está a ±5 % de un factor de `{2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50}`
   (o su inverso), el corte previo se multiplica por ese factor (el 13F reporta acciones sin ajustar; un split 10:1 parecía una
   compra masiva). La mediana (no el promedio) evita que una compra grande de un solo gestor parezca split.

**Señales.**

| Señal | Fórmula | Mapeo | pesoBase |
|---|---|---|---|
| `cambio_acciones_pct` | `(Σ_comunes A_i / Σ_comunes B_i·f − 1)·100` | `tanh(%/10)` | **1.5** |
| `amplitud_instituciones` | `(aumentan − disminuyen)/comunes` | identidad (ya en [−1, 1]) | 1 |

`confianza = confianza_combinar × (dias_desde_corte > 135 ? 0.5 : 1)`. **135 = 45 días de plazo + 90 de trimestre**: pasado
eso ya debería existir un corte más nuevo. **Escala 10 %**: los grandes indexados rara vez cambian más de ±10 % por trimestre.
Más peso al cambio agregado (mide cantidad de acciones) que a la amplitud (solo cuenta cabezas).

**Ejemplo completo (ejecutado: `node scripts/guia/ejemplos.cjs institucional`).** Acciones de DEMO (millones):

| Gestor | 2026-06-30 (B) | 2026-09-30 (A) | Cambio |
|---|---|---|---|
| Vanguard Capital Management | 50.0 | 52.0 | aumenta |
| BlackRock | 45.0 | 44.5 | disminuye |
| State Street | 20.0 | 21.0 | aumenta |
| FMR | 11.0 | 9.8 | disminuye |
| Geode | 6.0 | 6.3 | aumenta |
| JPMorgan | 2.5 | — | **sale** (no cuenta) |
| Morgan Stanley | — | 3.0 | **nueva** (no cuenta) |

```
comunes = 5;  Σ A = 133.6;  Σ B = 132.0;  cambio = (133.6/132.0 − 1)·100 = 1.2121 %  → tanh(0.1212) = 0.1206
amplitud = (3 − 2)/5 = 0.2
sesgo = (1.5·0.1206 + 1·0.2)/2.5 = 0.1524      consistencia 1, intensidad 0.1524
confianza = 0.5 + 0.5·0.1524 = 0.5762  (corte de hace 48.6 días ≤ 135 → sin castigo)      puntaje 57.62
```

Variantes (ejecutado): el mismo 13F evaluado el 2027-03-01 (152 días) → confianza **0.2881** (× 0.5). Split: razones 10.1, 9.9, 10.1
→ factor **10**, cambio real +0.5 % (no +900 %). `detectarSplit([2.02, 1.98, 2.0]) = 2`; `[1.3, 1.2, 1.25]` → 1 (no es split);
con solo 2 instituciones → 1 (mínimo 3).

**Limitaciones.** Solo 9 gestores; coincidencia por nombre (puede fallar; CUSIP sería más robusto); rezago de hasta 45 días; no
distingue venta real de 13F pendiente; la interfaz omite el core si no hay 13F (`flujo.js`, paso "omitida").

---

### D.5 Core noticias (`src/cores/noticias.core.js` + `src/cores/lexico.js`; `noticias@1.1.0`, `lexico@1.1.0`)

**Pregunta que responde.** ¿Cuál es el tono reciente de las noticias, dando más peso a lo más nuevo?

**Intuición.** Una sorpresa positiva en resultados empuja el precio unos días; una demanda o un recorte de guía lo hunden. El
efecto se disipa rápido: por eso decae exponencialmente.

**Datos y origen.** `REQUIERE = ['noticias']`. Alpaca `GET /v1beta1/news` (contenido Benzinga); la sincronización trae
**14 días**, máximo 50 noticias; el servicio pasa las que incluyen el símbolo en `simbolos`.

**Paso 1: texto → polaridad** (`puntuarTexto(título + " " + resumen)`):

- Normaliza (minúsculas, sin acentos ni apóstrofos) y separa tokens `[a-z0-9]+`.
- **Léxico** propio inglés/español de **287 términos** con valores asignados a mano: ±2 eventos extremos (fraud, bankruptcy,
  plunge, surge), ±1.5 resultados/calificaciones (beat, miss, upgrade, downgrade), ±1 movimientos/tono, ±0.5 términos débiles
  (risk, buy, lower).
- **Negadores** (`not, no, never, without, fails, unable, sin, nunca…`) invierten el signo de los términos en las **3** palabras
  siguientes; **intensificadores** (`sharply, significantly, massive…`) ×1.5 y **atenuadores** (`slightly, modestly…`) ×0.5 al
  siguiente término dentro de **2** palabras.
- `pos = Σ aportes > 0`, `neg = Σ |aportes < 0|`, **polaridad** `p = (pos − neg)/(pos + neg)` ∈ [−1, 1],
  **fuerza** `f = min(1, (pos + neg)/2)` (un término fuerte o dos moderados = fuerza 1).

**Paso 2: agregado** (noticias con fecha ≤ ref, dentro de `ventanaDias`, titulares duplicados eliminados, solo las que tienen polaridad):

```
w_i          = 0.5^(edad_i / vidaMedia) · f_i               (edad en días; vida media 3 → λ = ln2/3 = 0.231/día)
sesgo        = Σ w_i p_i / Σ w_i
consistencia = |Σ w_i p_i| / Σ w_i |p_i|
confianza    = (1 − e^(−Σw/2)) · consistencia               (Σw = 2 → 63 % del máximo)
cobertura    = noticias con polaridad / noticias analizadas
```

`0.5^(edad/h)` es lo mismo que `e^(−λ·edad)` con `λ = ln2/h`: una noticia de hace h días pesa la mitad. Con h = 3:
1 día → 0.7937, 2 → 0.6300, 4 → 0.3969, 6 → 0.2500 (ejecutado). Este core no usa `combinar` ni `filtrarSenales` (una sola señal,
`sentimiento_promedio`, pesoBase 1); calcula su propio sesgo/confianza y llama a `finalizar`.

**Por qué estas constantes.** Vida media **3 días** (heurística: el efecto se disipa en pocas sesiones); ventana **30 días** ≈ un
vencimiento mensual; ambas **variables** por `parametros.vidaMediaDias` (0.25–365) y `parametros.ventanaDias` (1–365) en el perfil o
en el cuerpo de la evaluación. Saturación `1 − e^(−x/2)` (x = 0.5 → 0.22, 1 → 0.39, 2 → 0.63, 4 → 0.86): más evidencia da más
confianza, con techo. La confianza se multiplica por la consistencia porque noticias que se contradicen no deben dar seguridad.
Umbral 0.1 solo para contar positivas/negativas.

**Ejemplo completo (ejecutado: `node scripts/guia/ejemplos.cjs noticias`).** Referencia 2026-11-17 15:00 UTC, 7 noticias:

| Titular | Edad | Términos | pos/neg | p | f | 0.5^(edad/3) | w |
|---|---|---|---|---|---|---|---|
| DEMO **significantly beats** estimates as cloud revenue **surges** | 0.5 d | 1.5×1.5 + 2 | 4.25/0 | +1 | 1 | 0.8909 | 0.8909 |
| Analyst **warns** of **slowing** demand in Europe | 2 d | −1 −1 | 0/2 | −1 | 1 | 0.6300 | 0.6300 |
| DEMO shares **slightly lower** after guidance **cut** | 4 d | −0.5×0.5 − 0.5 | 0/0.75 | −1 | 0.375 | 0.3969 | 0.1488 |
| DEMO did **not miss** estimates, regulator says | 6 d | −(−1.5) | 1.5/0 | +1 | 0.75 | 0.2500 | 0.1875 |
| DEMO to host investor day in December | 1 d | ninguno | — | sin polaridad | — | — | — |
| (duplicado del primer titular, otro proveedor) | 0.4 d | — | — | descartado | | | |
| DEMO record quarter | 40 d | — | — | fuera de la ventana de 30 d | | | |

```
analizadas = 5, con términos = 4 → cobertura 0.8
Σw = 1.8572    Σw·p = 0.8909 − 0.6300 − 0.1488 + 0.1875 = 0.2996
sesgo = 0.2996/1.8572 = 0.1613            consistencia = 0.2996/1.8572 = 0.1613 (todas tienen |p| = 1)
confianza = (1 − e^(−0.9286))·0.1613 = 0.6049·0.1613 = 0.0976        puntaje 58.07
sentimiento_sin_decaimiento = (1 − 1 − 1 + 1)/4 = 0
```

Lectura: sin decaimiento el tono es 0 (2 buenas, 2 malas); con decaimiento gana la más reciente (+0.16), pero la confianza
es muy baja (0.10) porque las noticias se contradicen. Con `vidaMediaDias = 10` (ejecutado): sesgo 0.117, confianza 0.0854
(lo viejo pesa más y se diluye la noticia buena).

**Casos límite.** Sin noticias → `noticias`, sesgo null; ninguna con términos → `noticias.terminos_lexico`, sesgo null (antes de 1.1.0
contaban como 0 y diluían el promedio: probable causa del 0.00 de MSFT con datos reales); sin `fechaReferencia` → peso uniforme y
`fechaReferencia` en datosFaltantes.

**Limitaciones.** Palabras sueltas (sin frases, sarcasmo ni a quién se refiere: un "beats" de un competidor cuenta igual);
léxico **no validado** con titulares etiquetados; la sincronización trae 14 días aunque la ventana por defecto sea 30.

---

## E. Confluencia y selección paso a paso (`src/cores/confluencia.core.js`, `confluencia@1.1.0`; ADR-002, ADR-012)

### E.1 La idea en una página

Cada core da un sesgo `s_i` y una confianza `c_i`. El usuario da un peso `w_i` por core (0–5 en la interfaz, 1 por defecto).
El **peso efectivo** es `e_i = w_i · c_i`: un core cuenta más si el usuario lo valora **y** si está seguro de lo que dice.
(La cobertura del core no se multiplica aparte: ya está dentro de `c_i`.)

```
s̄  = clamp( Σ e_i s_i / Σ e_i )                     sesgo combinado (consenso)
D  = √( Σ e_i (s_i − s̄)² / Σ e_i )                  dispersión = desviación estándar ponderada, en [0, 1]
A  = clamp(1 − D, 0, 1)                             acuerdo (un solo core → D = 0, A = 1)
N̄  = Σ e_i (1 − |s_i|) / Σ e_i                      neutralidad media
cobertura = cores con resultado / cores seleccionados
confianza = (Σ w_i c_i / Σ w_i) · cobertura · A

LONG_CALL   = clamp(50 + 50·s̄·A, 0, 100)
LONG_PUT    = clamp(50 − 50·s̄·A, 0, 100)
IRON_CONDOR = clamp(100·N̄ + ajusteVolatilidad, 0, 100)
```

**Qué significa "compatibilidad".** Un número 0–100 que dice qué tan coherente es cada estrategia con lo que dicen los cores.
50 = indiferente. **No es una probabilidad de ganar.** Long Call y Long Put son simétricos (suman 100). Ejemplo de lectura:
Long Call 69 ⇒ `s̄·A = 0.38` (p. ej. sesgo 0.5 con acuerdo 0.76).

**Un core sin resultado** (sesgo null) **no cuenta como negativo**: se excluye y baja la cobertura. Si ningún core tiene
resultado (o Σe = 0): puntaje 50, confianza 0, `sesgoCombinado null`; la selección lo registra con puntaje **0** y cobertura 0
para que quede al final.

### E.2 Ejemplo completo con los 5 cores DEMO (ejecutado: `node scripts/guia/ejemplos.cjs confluencia`)

Entradas = salidas reales de §D, pesos del usuario = 1, IV/HV del core indicadores.

| Core | s_i | c_i = e_i | e·s | 1 − \|s\| | e·(1 − \|s\|) | e·(s − s̄)² |
|---|---|---|---|---|---|---|
| técnico | +0.1742 | 0.4605 | +0.0802 | 0.8258 | 0.3803 | 0.0060 |
| indicadores | −0.6254 | 0.8127 | −0.5083 | 0.3746 | 0.3044 | 0.3813 |
| fundamental | +0.6076 | 0.8038 | +0.4884 | 0.3924 | 0.3154 | 0.2414 |
| institucional | +0.1524 | 0.5762 | +0.0878 | 0.8476 | 0.4884 | 0.0050 |
| noticias | +0.1613 | 0.0976 | +0.0157 | 0.8387 | 0.0819 | 0.0010 |
| **Σ** | | **2.7508** | **0.1638** | | **1.5704** | **0.6347** |

```
s̄ = 0.1638/2.7508 = 0.0596                     (neutral: indicadores y fundamental se cancelan)
D = √(0.6347/2.7508) = √0.2307 = 0.4804          A = 0.5196
N̄ = 1.5704/2.7508 = 0.5709
confianza = (2.7508/5)·1·0.5196 = 0.5502·0.5196 = 0.2859
IV/HV20 = 0.25/0.2267 = 1.1028 → ajuste = clamp(0.1028/0.2)·15 = 0.514·15 = +7.71

LONG_CALL   = 50 + 50·0.0596·0.5196 = 51.55
LONG_PUT    = 50 − 50·0.0596·0.5196 = 48.45
IRON_CONDOR = 100·0.5709 + 7.71      = 64.80      ← mejor clasificada
```

Ponderaciones efectivas guardadas en la Confluencia (`e_i/Σe`): técnico 0.1674, indicadores 0.2954, fundamental 0.2922,
institucional 0.2095, noticias 0.0355. Motivos generados (literal): «Sesgo combinado 0.060 (neutral) con 5/5 cores.», «Los cores se
contradicen (dispersión 0.48): la señal direccional se reduce un 48 % y la confianza también.», «Neutralidad media de los cores
0.57 (promedio de 1 − |sesgo| de cada core; un desacuerdo no cuenta como neutralidad).», «Ajuste por volatilidad +7.7 (IV/HV20 = 1.10).».

**Lectura crítica (útil ante el revisor).** El Iron Condor gana con 64.8, pero la confianza es solo 0.29 y los cores se
contradicen. La fórmula 1.1.0 ya no lo infla tanto: con la fórmula 1.0.0 (`100·(1 − |s̄|)`) habría salido
`100·0.9404 + 7.71 = 101.75 → 100`. Además la interfaz avisa: en `estrategiasOrden.js → contextoAnalisis`, si la mejor
estrategia es Iron Condor y hay un core con puntaje ≥ 70 (fundamental 80.38) y otro ≤ 30 (indicadores 18.73), el ticket
muestra «Los cores se contradicen: la neutralidad puede ser desacuerdo, no rango lateral.».

**Efecto de los pesos del usuario (ejecutado).** Técnico 3, noticias 0, el resto 1: s̄ 0.0863, A 0.5758 → Long Call 52.49,
Long Put 47.51, Iron Condor 70.63. Subir el técnico (que es casi neutral, 0.17) aumenta la neutralidad media.

### E.3 ¿Por qué desviación estándar **ponderada**?

- Queremos medir **cuánto se alejan los cores del consenso** `s̄`. La desviación estándar es la medida natural de dispersión
  alrededor de una media.
- **Ponderada** con el mismo `e_i` que el consenso: un core con confianza 0.10 (noticias) casi no debe poder "crear desacuerdo".
  En el ejemplo aporta 0.001 de 0.6347.
- Como cada `s_i ∈ [−1, 1]`, `D ∈ [0, 1]`, y `A = 1 − D` queda en [0, 1] sin normalizar.
- Alternativas descartadas (ADR-012): **rango** máx − mín (un solo core extremo con poca confianza lo dispara);
  **entropía de signos** (ignora magnitudes: +0.05 y −0.05 serían "desacuerdo total").
- Debate abierto: A es lineal en D; `A²` castigaría más el desacuerdo. No hay datos para elegir.

### E.4 ¿Por qué promedio de neutralidades y no neutralidad del promedio? (caso NVDA)

Un Iron Condor gana si **el precio no se mueve**. Que un core diga +1 y otro −1 significa "uno espera subida fuerte y otro
caída fuerte", es decir, **incertidumbre**, no calma. `1 − |s̄|` lo confunde con neutralidad; `Σe(1 − |s|)/Σe` no.

**Caso real NVDA** (ADR-012; también es la prueba «caso NVDA» en `tests/cores.test.cjs`; confianzas iguales 0.8, sin ajuste IV):
fundamental +1.0, técnico −0.6, indicadores −0.8, noticias 0.

```
s̄ = (1 − 0.6 − 0.8 + 0)/4 = −0.1
D = √((1.1² + 0.5² + 0.7² + 0.1²)/4) = √(1.96/4) = 0.7          A = 0.3
N̄ = (0 + 0.4 + 0.2 + 1)/4 = 0.4

                 1.0.0 (antes)              1.1.0 (ahora, ejecutado)
IRON_CONDOR      100·(1 − 0.1) = 90         100·0.4 = 40
LONG_PUT         50 + 50·0.1 = 55           50 + 50·0.1·0.3 = 51.5
LONG_CALL        45                         48.5
confianza        —                          0.8·1·0.3 = 0.24
```

Antes el Iron Condor ganaba con 90 aunque **ningún** core indicaba lateralidad. (Las confianzas reales de aquella ejecución no
están guardadas en el documento; con confianzas distintas los números cambian.)

### E.5 Ajuste de volatilidad del Iron Condor (`ajusteVolatilidad`)

```
con IV y HV20 > 0:     ajuste = clamp((IV/HV20 − 1)/0.2, −1, 1) · 15
si no, con IV Rank:    ajuste = clamp((rank − 50)/30, −1, 1) · 15     (rank ≤ 1 se lee como fracción)
sin datos:             sin ajuste («Sin datos de IV/HV: no se aplica ajuste de volatilidad.»)
```

Ejecutado: IV/HV = 0.8 → −15; 0.9 → −7.5; 1.0 → 0; 1.1 → +7.5; 1.2 → +15; 1.3 → +15 (satura).

- **Razón financiera**: el Iron Condor **vende** prima; si la IV es alta frente a la volatilidad realizada, se cobra "caro" algo
  que históricamente se mueve menos.
- **Por qué ±15** (`AJUSTE_IV_MAX`): permite desempatar sin poder superar a la estructura direccional (que aporta hasta 100).
  **0.2** (`SENSIBILIDAD_IV_HV`): ±20 % de prima de IV satura. Heurísticas de ADR-002.
- **Lo que hace el servicio**: `analisis.service.js → combinar` pasa `{ivActual: iv_promedio, hv20: hv_20}` del core indicadores;
  **nunca envía IV Rank** (no hay histórico de IV).
- **Limitación honesta**: IV/HV ≈ 1.1–1.2 suele ser lo normal (prima de riesgo de varianza; afirmado en ADR-012, no medido
  aquí), así que centrar en 1.0 suma típicamente +7.5 a +15 al Iron Condor. Y IV (contratos ±5 %, vencimientos 7–60 días)
  vs HV20 (20 sesiones) miden horizontes distintos.
- Constantes solo de texto: `UMBRAL_DIRECCION 0.1` (decir alcista/neutral/bajista) y `UMBRAL_CONTRADICCION 0.35` (decir
  "se contradicen"). No afectan el puntaje.

### E.6 La selección (`analisis.service.js → ejecutarSeleccion`)

```
para cada empresa del universo:
   para cada core seleccionado: calcular() de nuevo → nueva Evaluacion 'completada'   (parametros = perfil.parametros + filtros)
   para cada estrategia candidata: combinar() → nueva Confluencia 'completada'
   resultado {empresaId, estrategiaId, confluenciaId, puntaje, cobertura, motivos (≤ 8)}
ordenar por puntaje desc; desempate por cobertura desc
```

| `modo` | Empresas | Estrategias |
|---|---|---|
| `empresa` (el que usa «Analizar») | `empresaId` | `estrategiasCandidatas` o las 3 |
| `estrategia` | `empresasCandidatas` o las primeras 25 activas | la de `estrategiaId` |
| `empresa_estrategia` | `empresaId` | la de `estrategiaId` |

Validaciones del modelo `Seleccion`: ponderaciones sin cores repetidos y solo de cores seleccionados; `empresaId`/`estrategiaId`
obligatorios según el modo. En la interfaz los pesos van de 0 a 5 en pasos de 0.5 (`ConfigAnalisis.jsx`); un core con peso 0
se excluye antes de enviar (`resolverConfig`).

---

## F. Evaluación de configuraciones y Black-Scholes en el código

### F.1 Qué hace `estrategias.core.js → evaluarConfiguracion`

Entrada: `{estrategia, componentes:[{tipo, accion, strike, cantidad, vencimiento, precio?, volatilidadImplicita?, griegas?}],
precioSubyacente?, multiplicador = 100, fechaReferencia?, tasaLibreRiesgo = 0.04}`.

En la app (`analisis.service.js → evaluarConfiguracion`, `POST /configuraciones/:id/evaluaciones`): `precio` = `(bid + ask)/2`
del último snapshot (o `ultimo`); IV y griegas del snapshot de Alpaca; `precioSubyacente` = último cierre guardado (o el del
body); `fechaReferencia` = ahora. Se guarda como una Evaluación con `core: 'configuracion'`.

1. **Validar** (`validar`): LONG_CALL = 1 call comprado; LONG_PUT = 1 put comprado; IRON_CONDOR = 4 patas, mismo vencimiento,
   cantidades iguales, 1 put buy, 1 put sell, 1 call sell, 1 call buy con `K1 < K2 < K3 < K4`; strike > 0, cantidad entera > 0,
   precio ≥ 0. Ejemplo (ejecutado): strikes 90/95/94/110 → «Strikes deben cumplir put comprado < put vendido < call vendido <
   call comprado (recibido 90, 95, 94, 110).»
2. **Montos** (§B.12, B.16): `prima_neta`, `perdida_maxima`, `ganancia_maxima` (null = ilimitada en Long Call: las métricas deben
   ser finitas), breakevens, `ancho_alas`, `resultado_vencimiento_precio_actual` = payoff con S actual, `delta_neta` =
   `Σ signo·Δ_Alpaca·q·100` (en "acciones equivalentes").
3. **Black-Scholes** (requiere S > 0, `fechaReferencia` y vencimiento futuro; `T = (vencimiento a las 20:00 UTC − ref)/365 días`):

| Métrica | Fórmula | Para qué |
|---|---|---|
| `anos_al_vencimiento` | T | — |
| `delta_neta_bs` | `Σ signo·Δ_BS(IV de la pata)·q·100` | Delta propia, independiente del proveedor |
| `prima_neta_teorica_bs` | `Σ −signo·precio_BS·q·100` | ¿La prima de mercado es coherente con su propia IV? |
| `diferencia_delta_max` | `máx |Δ_BS − Δ_Alpaca|` | **Verificación independiente** de las griegas indicativas |
| `diferencia_iv_max` | `máx |IV recalculada desde la mid − IV_Alpaca|` | ¿La IV del proveedor corresponde al precio mid? |
| `probabilidad_ganancia` | ver F.2 | Comparar configuraciones |

### F.2 Probabilidad de ganancia (neutral al riesgo, lognormal, r = 0.04, q = 0)

```
LONG_CALL:    P[S_T > K + prima]                     = N(d2) con X = K + prima
LONG_PUT:     1 − P[S_T > K − prima]
IRON_CONDOR:  P[S_T > K2 − c; σ del put vendido] − P[S_T > K3 + c; σ del call vendido], acotado a [0, 1]; c ≤ 0 → 0
```

Cada breakeven del Iron Condor usa la IV de la pata vendida más cercana (aproxima la "sonrisa": los puts OTM suelen tener más IV).
`probabilidadSobre({S, X, T, r, sigma})` = `N(d2)` con K = X.

### F.3 Ejemplos ejecutados (`node scripts/guia/ejemplos.cjs estrategias`)

Referencia 2026-11-17 15:00 UTC, vencimiento 2026-12-18 (20:00 UTC) → **T = 0.0855 años = 31.21 días**. S = 100.

| Métrica | Long Call K100 @3.60, IV 0.30, Δ 0.53 | Long Put K100 @3.00, IV 0.31, Δ −0.46 | Iron Condor 90/95/105/110 |
|---|---|---|---|
| prima_neta | −360 (débito) | −300 | +180 (crédito) |
| pérdida / ganancia máx. | 360 / ilimitada | 300 / 9 700 | 320 / 180 |
| breakeven(s) | 103.60 | 97.00 | 93.20 / 106.80 |
| delta_neta (Alpaca) / delta_neta_bs | 53 / 53.30 | −46 / −46.69 | — / −3.65 |
| diferencia_delta_max | 0.003 | 0.0069 | — (sin deltas del proveedor) |
| prima_neta_teorica_bs | −366.59 | −344.07 | +182.82 |
| diferencia_iv_max | 0.0057 | 0.0379 | 0.0123 |
| **probabilidad_ganancia** | **0.3416** | **0.3713** | **0.5841** |

Iron Condor a mano (ejecutado): `P[S_T > 93.20; σ 0.30] = 0.7875` − `P[S_T > 106.80; σ 0.27] = 0.2034` = **0.5841**.
Lectura: el Long Call "pierde" más a menudo (34 %) pero gana mucho cuando acierta; el condor gana más a menudo (58 %) pero poco.
Ninguna de las dos cosas dice cuál es mejor: la probabilidad **no incluye el tamaño** de las ganancias y pérdidas.

**TSLA iron condor (ticket real de la conversación).** Patas: vender put 352.50 (mid 3.97), comprar put 342.50 (2.39), vender call
407.50 (2.90), comprar call 417.50 (1.51); subyacente 380.15. Aritmética (verificada con el código):

```
crédito c = 3.97 + 2.90 − 2.39 − 1.51 = 2.97 por acción
ganancia máxima = 2.97 · 100 = 297 USD
ancho = max(352.5 − 342.5, 417.5 − 407.5) = 10
pérdida máxima = (10 − 2.97) · 100 = 703 USD
breakevens = 352.50 − 2.97 = 349.53   y   407.50 + 2.97 = 410.47
payoff (ejecutado): 330 → −703 · 349.53 → 0 · 352.5 → 297 · 380.15 → 297 · 407.5 → 297 · 410.47 → 0 · 430 → −703
```

Para Black-Scholes faltan datos que la conversación no da (vencimiento e IV). **Supuesto**: vencimiento 2026-12-01 (T = 0.0389,
14.2 días) e IV de cada pata **recalculada desde su mid** con `volatilidadImplicita`: put 342.5 → 0.4884, put 352.5 → 0.4756,
call 407.5 → 0.3786, call 417.5 → 0.3755. Con eso las patas vendidas tienen **Δ −0.193 y +0.192** (coherente con la regla
|Δ| ≈ 0.20 de §G) y `probabilidad_ganancia = 0.6581`, `delta_neta_bs = −1.11` acciones. Con otro vencimiento o IV real estos dos
números cambian; los montos y breakevens no.

### F.4 Verificación de Black-Scholes en las pruebas

`tests/cores.test.cjs → 'blackscholes: valores de libro'` comprueba call 10.4506, put 5.5735, Δ 0.6368/−0.3632, Γ 0.018762,
vega 0.375240, θ −6.414028/365, N(d2) 0.5596, paridad put-call (tolerancia 1e-9), `cdf(1.96) = 0.9750021`, IV recuperada 0.2, y que
T = 0 o un precio sobre el límite sin arbitraje devuelvan null. Otra prueba compara `probabilidad_ganancia` y
`diferencia_delta_max` con cálculos independientes.

---

## G. De la recomendación a la orden

### G.1 «Operar»: cómo se arman las patas (`web/src/utils/estrategiasOrden.js`)

| Paso | Función | Regla exacta |
|---|---|---|
| Vencimiento | `elegirVencimiento(vencimientos, hoy, minDias = 7, maxDias = null)` | El más cercano dentro de [mín, máx] días (rango de «Configurar análisis», defecto 7–60); si no hay, el primero con ≥ mín; si no, el futuro más cercano. Ejecutado: [11-20, 11-28, 12-18] con hoy 11-17 y mín 7 → **2026-11-28**. Detalle en §G.3 |
| Long Call / Long Put | `construirPatas` | Comprar el call/put con strike **más cercano al precio** (ATM) |
| Iron Condor, patas cortas | `porDelta(items, tipo, 0.2, fallback)` | Put y call vendidos con **\|Δ\| más cercano a 0.20** (solo deltas entre 0.02 y 0.98); sin griegas: strike más cercano a `0.95·S` (put) y `1.05·S` (call) |
| Iron Condor, alas | `ala(items, tipo, base, dir, 0.025·S)` | Del lado exterior, el strike cuya distancia a la pata corta esté más cerca de **2.5 % del precio** (mínimo un paso) |
| Precio sugerido | `netoMid` + `redondearPrecio` | Neto = Σ ventas − Σ compras a mid (> 0 = crédito). Redondeo a 0.01 si < 3, a 0.05 si ≥ 3 (ejecutado: 2.97 → 2.97; 3.42 → 3.40; 0.034 → 0.03) |
| Riesgo mostrado | `perfilRiesgo` | Long: pérdida = precio·100·q; condor: (ancho − crédito)·100·q, breakevens K2 − c y K3 + c |
| Avisos | `contextoAnalisis` | Sin análisis; análisis > 24 h; la estrategia no es la mejor clasificada; contradicción (mejor = Iron Condor con algún core ≥ 70 y otro ≤ 30) |

**Ejemplo (ejecutado) sobre una cadena sintética TSLA** (S = 380.15, strikes cada 2.5 de 285 a 475 —el ±25 % que sincroniza el
servidor—, primas y deltas de Black-Scholes con σ 0.45, vencimiento a 14 días):

```
LONG_CALL   → comprar call 380 (Δ 0.527)          LONG_PUT → comprar put 380 (Δ −0.474)
IRON_CONDOR → vender put 355 (Δ −0.2025), comprar put 345, vender call 412.5 (Δ 0.1955), comprar call 422.5
              ancho objetivo = 2.5 % · 380.15 = 9.50 → elige alas a 10 de distancia (más cerca de 9.50 que 7.5 o 12.5)
sin griegas → vender put 360 (≈ 0.95·S = 361.14), comprar put 350, vender call 400 (≈ 1.05·S = 399.16), comprar call 410
```

**¿Por qué |Δ| ≈ 0.20?** Convención de mercado para vender opciones fuera del dinero: la delta de una opción OTM aproxima su
probabilidad neutral al riesgo de terminar ITM (en rigor esa probabilidad es N(d2), algo menor que N(d1)), así que cada pata corta
tiene ≈ 20 % de quedar ITM y el condor ≈ 60 % de ganar algo. **¿Por qué alas al 2.5 %?** Limita la pérdida máxima a un múltiplo
razonable del crédito. **Ninguna de las dos cifras está respaldada por un estudio en el código: son heurísticas de la interfaz**, y
el usuario puede cambiar cualquier pata en el ticket.

### G.2 El ticket (`web/src/components/TicketOrden.jsx`)

Tres pasos: **editar** (elegir el **vencimiento** —reconstruye las patas, §G.3—, cambiar acción, tipo, strike, añadir/quitar patas
hasta 4, cantidad 1–100, tipo market/límite, precio, vigencia day/GTC) → **revisar** → **enviado** (seguimiento). Calcula en vivo: neto a mid, crédito o débito, total
(`precio × 100 × cantidad`), pérdida y ganancia máximas, breakevens; compara lo requerido con el **poder de compra** de la cuenta
paper (para un crédito, lo requerido es la pérdida máxima). Advertencias: spread > 10 % en orden market, poder de compra
insuficiente, operar sin análisis, análisis > 24 h, estrategia que no es la mejor, contradicción, patas sin cotización.

Para el TSLA (ejecutado con `perfilRiesgo`): 1 contrato → pérdida 703, ganancia 297, breakevens 349.53/410.47; 3 contratos → 2 109 / 891.

Cuerpo que envía a `POST /api/v1/ordenes/ticket`:
`{empresaId, estrategiaCodigo?, nombre, tipo, precioLimite?, credito, vigencia, cantidad, componentes:[{contratoId, accion, intencion, proporcion:1}]}`.
El nombre lleva contexto: «IRON_CONDOR TSLA · compat 65 · 2026-11-17» (`nombreConContexto`).

### G.3 Selección del vencimiento y "días a vencimiento"

Hay **dos momentos** en que importa el vencimiento: qué contratos se **descargan** y cuál se **elige** para operar.

```
«Configurar análisis» (ConfigAnalisis.jsx)          flujo.js → sincronizarDatos                 servidor
  Días a vencimiento mín. [ 7 ]  máx. [ 60 ]  ───►   acciones.sincronizar({recurso:'contratos',  ──► sincronizacion.service → contratos:
  (enteros 0–730, mín ≤ máx: errorRangoDias;           simbolos, diasVencimientoMin,                    vencimientos entre hoy+mín y hoy+máx,
   se guarda en localStorage 'opciones.analizar.       diasVencimientoMax})                             strikes ±25 % (defecto del servidor 7/60)
   config.v1')
                                                                                 ▼
«Operar» (BotonOperar.jsx)  rango = props o leerConfig() → cargarCadena(simbolo, {diasMin, diasMax})
   elegirVencimiento(vencimientos, hoy, diasMin, diasMax):
     1) el más cercano con  diasMin ≤ días ≤ diasMax          2) si no hay, el primero con ≥ diasMin
     3) si no, el futuro más cercano                           4) si no, el primero de la lista
   construirPatas(codigo, cadena de ese vencimiento, S)
                                                                                 ▼
TicketOrden.jsx   select «Vencimiento» con todos los vencimientos sincronizados («2026-12-18 · 31 días», diasHasta)
   cambiarVencimiento(v): GET /mercado/opciones/resumen/:simbolo?vencimiento=v
     → reconstruirPatas(estrategiaCodigo, patas previas, nueva cadena, S)
         con estrategia: vuelve a aplicar construirPatas (ATM, |Δ|≈0.20, alas 2.5 %) en el nuevo vencimiento
         sin estrategia (patas manuales): conserva tipo/acción/intención y toma el strike más cercano al anterior
     → borra el precio límite editado (vuelve a la mid); bloquea «Revisar» mientras carga o si falló (botón «Reintentar»)
```

**Ejemplo (ejecutado: `node scripts/guia/ejemplos.cjs orden`).** Hoy 2026-11-17, vencimientos sincronizados a 3, 11, 17, 31, 37 y
59 días: con 7–60 → **2026-11-28** (11 días); con **30–45 → 2026-12-18** (31 días); con 50–55 (ninguno en rango) → el primero con
≥ 50: 2027-01-15 (59 días).

**¿Por qué 30–45 días para un Iron Condor?** Es la convención de mercado que muestra el texto de ayuda («Iron Condor suele usarse
con 30–45 días»): a esa distancia el decaimiento por tiempo (theta) ya es apreciable y la gamma (sensibilidad a saltos de precio)
todavía es moderada. **Es una convención, no un cálculo del código**; el defecto de la interfaz sigue siendo 7–60.

**Cómo se configura (respuesta para el revisor).** En «Configurar análisis» poner mín. 30 y máx. 45 y analizar (la sincronización
de contratos traerá solo esos vencimientos); al pulsar «Operar» se elegirá el vencimiento más cercano dentro de 30–45 y en el
ticket se puede cambiar a cualquier otro vencimiento sincronizado. Por API: `POST /api/v1/sincronizaciones/ejecuciones` con
`{"recurso":"contratos","simbolos":["TSLA"],"diasVencimientoMin":30,"diasVencimientoMax":45}` (el modelo `Sincronizacion` acepta
0–3650 y valida mín ≤ máx; la interfaz limita a 0–730).

**Lo que todavía no tiene efecto.** Las páginas `Seleccion` y `Perfiles` también tienen «Días a vencimiento mín./máx.», que se guardan
en `filtros`/`parametros` (`parametrosSchema`: defecto 0 y 60), pero **ningún core ni servicio los lee**: no cambian ni el análisis ni
la sincronización. El rango que sí funciona es el de «Configurar análisis».

> Nota de versión: el selector y el rango de días aparecieron en el código mientras se redactaba esta guía (verificado el
> 2026-11-17 en `TicketOrden.jsx`, `BotonOperar.jsx`, `estrategiasOrden.js`, `flujo.js`, `ConfigAnalisis.jsx`, `Analizar.jsx`);
> estas funciones de interfaz **no tienen pruebas automáticas propias** todavía
> (el script de la guía sí las ejecuta).

### G.4 Idempotencia: por qué un reintento no duplica la orden

1. La interfaz genera un UUID (`uuid()` en `web/src/utils/objects.js`) al confirmar y lo **reutiliza** si el usuario pulsa
   «Reintentar envío»; «Volver» lo descarta.
2. Header `Idempotency-Key` (8–128 caracteres `[\w-]`) → se guarda como `orden.idempotencyKey` y se envía a Alpaca como
   **`client_order_id`**.
3. `operacion.service.ticket` busca primero una orden con esa key (`existente`): si existe, la devuelve con HTTP 200 y mensaje
   «Orden ya existente para esa Idempotency-Key.» **sin reenviar**.
4. `broker.service.enviar` no reenvía si la orden ya tiene `ordenExternaId`, y exige que la key coincida con la de la orden (409).
5. La base lo refuerza: índice único `(usuarioId, conexionId, idempotencyKey)` en `Orden` (Mongo) y `api_ordenes_natural` en
   `database/schema.sql` (Supabase).
6. Alpaca también rechaza un `client_order_id` repetido (comportamiento del proveedor; verificado solo indirectamente por el smoke).

Escenario: la red se cae después de que Alpaca aceptó la orden pero antes de la respuesta. El usuario reintenta con la misma key →
la API encuentra la orden local (creada antes de enviar) y no la duplica. Si el envío falló de verdad, la orden queda `pendiente`
con evento `error_envio` y se puede reenviar con `POST /ordenes/:id/envio`.

### G.5 Convención de crédito (`alpaca.client.js → precioLimiteAlpaca`, `construirCuerpoOrden`)

Nuestra API: `precioLimite` **siempre positivo** + `credito: true`. Alpaca (`POST /v2/orders`, órdenes `mleg`): positivo = débito,
**negativo = crédito**. La traducción vive en **un solo lugar**. Formato: 2 decimales si |precio| ≥ 1, hasta 4 si < 1
(ejecutado: 0.4567 a crédito → "−0.4567"; 6.2 de una pata → "6.2"). Cuerpo real generado para el TSLA (ejecutado):

```json
{"type":"limit","time_in_force":"day","client_order_id":"7f9c1e2a-demo-0001","limit_price":"-2.97","order_class":"mleg","qty":"1",
 "legs":[{"symbol":"TSLA261201P00342500","ratio_qty":"1","side":"buy","position_intent":"buy_to_open"},
         {"symbol":"TSLA261201P00352500","ratio_qty":"1","side":"sell","position_intent":"sell_to_open"},
         {"symbol":"TSLA261201C00407500","ratio_qty":"1","side":"sell","position_intent":"sell_to_open"},
         {"symbol":"TSLA261201C00417500","ratio_qty":"1","side":"buy","position_intent":"buy_to_open"}]}
```

Una pata: sin `order_class`, con `symbol`, `side`, `qty = cantidad × proporcion`. Verificado en paper (ADR-011): un Iron Condor
con `limit_price` negativo fue aceptado (`new`) y cancelado. Validaciones: `credito` solo con `limit` y multi-pata; market sin precio.

### G.6 Estados de la orden (`mapearEstadoOrden`)

| Alpaca | Nuestro estado |
|---|---|
| (antes de enviar) | `pendiente` |
| pending_new, held | `enviada` |
| accepted, new, accepted_for_bidding, pending_cancel, pending_replace, stopped, suspended, done_for_day | `aceptada` (done_for_day con algo ejecutado → `parcial`) |
| partially_filled | `parcial` |
| filled, calculated | `ejecutada` |
| canceled, replaced | `cancelada` |
| rejected | `rechazada` |
| expired | `expirada` |
| desconocido | `enviada` |

El ticket sondea cada **2 s** (sincroniza `ordenes` y lee la orden) hasta un estado terminal (`ejecutada`, `cancelada`,
`rechazada`, `expirada`) o **60 s**. Cancelar: `POST /ordenes/:id/cancelacion` (si aún no se envió, se cancela localmente).

### G.7 Posiciones y cierre

- `sincronizacion.service → posiciones`: guarda las posiciones vivas de Alpaca que tengan contrato sincronizado (las de acciones
  cuentan como fallidas); las abiertas localmente que el broker ya no reporta pasan a `cerrada`.
- `GET /broker/paper/resumen` (`operacion.resumen`): cuenta, posiciones vivas con P/L (si Alpaca no lo da:
  `(actual − promedio)·cantidad·100·signo`) y las 15 últimas órdenes; si no hay contrato guardado interpreta el símbolo OCC.
- `POST /posiciones/:id/cierre`: long → `sell_to_close`, short → `buy_to_close`, cantidad = la de la posición, misma idempotencia,
  solo si la posición está `abierta` y la conexión es paper.

---

## H. Qué es fijo y qué es variable

### H.1 Variable por el usuario (y efecto real)

| Parámetro | Dónde se fija | Defecto | Efecto real (verificado en código) |
|---|---|---|---|
| Base de datos | Login | MongoDB | Toda la sesión trabaja en esa base |
| Cores activos (`coresSeleccionados`) | «Configurar análisis», Selección, Perfil | los 5 (13F apagado) | Qué cores se ejecutan y combinan; institucional se omite si no hay 13F |
| Peso por core (`ponderaciones`) | «Configurar análisis» (0–5, paso 0.5), Selección | 1 | `w_i` de la confluencia; peso 0 = core excluido |
| Señales por core (`parametros.indicadores`) | Casillas «Métricas» | todas | Qué señales entran en `combinar` (no aplica a noticias) |
| Reglas del perfil | Perfiles | — | ± peso puntos o neutralización (§D.0) |
| `vidaMediaDias`, `ventanaDias` | Perfil o cuerpo de evaluación | 3 / 30 | Decaimiento y ventana del core noticias (0.25–365 / 1–365) |
| Incluir 13F | Casilla «Incluir 13F institucional» | apagado | Sincroniza 13F y habilita el core |
| Sincronizar antes de analizar | Casilla | encendido | Ejecuta los 6 recursos antes de los cores |
| Rango de velas (`desde`, `hasta`) | Sincronización; botón «histórico largo» | 420 días | Velas descargadas (IEX desde 2020-07) |
| Días a vencimiento mín./máx. | «Configurar análisis» (0–730) o API `POST /sincronizaciones/ejecuciones` `diasVencimientoMin/Max` | 7 / 60 | Qué contratos se sincronizan y qué vencimiento elige «Operar» (§G.3) |
| Vencimiento de la orden | Select del ticket | el elegido por `elegirVencimiento` | Reconstruye las patas en ese vencimiento |
| Modo de selección, candidatas | Página Selección | — | Universo a ordenar |
| Patas, tipo, precio, vigencia, cantidad | Ticket | límite a mid, day, 1 | Orden enviada |
| `precioSubyacente` | `POST /configuraciones/:id/evaluaciones` | último cierre | S de payoff y Black-Scholes |

**Variables en el esquema pero sin efecto (honestidad):** `parametros.periodos` (defecto 120, reservado: los cores usan toda la
serie), `parametros.intervalo` (solo admite `1Day`), `desde/hasta` dentro de `parametros` (no los lee ningún core). `diasVencimientoMin/Max` sí
tienen efecto: al cargar las opciones del core `indicadores` solo se promedian los contratos cuyo vencimiento cae en ese rango
de días desde hoy (la métrica `iv_promedio` lleva el periodo, p. ej. `7-60d`); si no se envían, no se filtra. `tasaLibreRiesgo` existe en `estrategias.core.js` pero no se expone por REST.

### H.2 Fijo en código, y por qué

| Grupo | Constantes | Por qué fijas |
|---|---|---|
| Ventanas de indicadores | 50/200, 20, 252 (mín. 60), RSI 14, MACD 12/26/9, estocástico 14/3, Bollinger 20/2, ATR 14, HV 20/60 | Definiciones estándar; optimizarlas invita a sobreajuste |
| Escalas de `tanh` | 5, 10, 0.5 (técnico); 0.5 (MACD); 10, 20, 10, 15 (fundamental); 10 (13F) | "Cuánto es mucho" para cada métrica; heurísticas documentadas |
| Umbrales | 30/70, 20/80, 1.5 (deuda neutra), 1 (liquidez neutra), HV20/HV60 1.5 y ×0.8, 135 días y ×0.5 | Convenciones clásicas o heurísticas |
| `pesoBase` | 1 / 1.5 / 0.75 / 0.5 por señal | Trazabilidad entre evaluaciones (ADR-010; editable por usuario queda en debate) |
| Periodos fundamentales | anual 330–400 días, trimestral 80–100, YoY ±25 días | Años fiscales de 52/53 semanas |
| 13F | 9 filers, factores de split, tolerancia 5 %, mínimo 3 | Lista verificada; robustez |
| Noticias | léxico (287), negación 3, intensidad 2, ×1.5/×0.5, fuerza 2, saturación 2, umbral 0.1 | Criterio de experto |
| Confluencia | ±15, sensibilidad 0.2, IV Rank 50/30, umbrales de texto 0.1 y 0.35 | ADR-002/012 |
| Black-Scholes | r = 0.04, q = 0, 365 días, 20:00 UTC, bisección [0.0001, 5], tolerancia 1e-6, 200 iteraciones | Supuestos documentados |
| Datos | IV solo ±5 % del dinero, IV ≤ 5, strikes ±25 % al sincronizar, 420 días de velas, 14 días de noticias | Calidad y volumen acotado |
| Interfaz | defecto de días a vencimiento 7–60 (editable), \|Δ\| 0.20, alas 2.5 %, redondeo 0.01/0.05, sondeo 2 s / 60 s | Heurísticas de usabilidad |
| Seguridad | URL paper, `env:ALPACA`, 10 logins/min, TTL 60–86400 s, cuerpo 1 MB | No negociables |

### H.3 ¿Cómo se determinó cada peso? (respuesta preparada)

Hay **dos niveles**: (1) los **pesos de core** (0–5) los elige el usuario en «Configurar análisis»; (2) los **`pesoBase` de cada
señal** dentro de un core son **heurísticas de experto** escritas junto a cada constante: más peso a lo más persistente (SMA200 1.5,
crecimiento de ingresos 1.5, cambio agregado 13F 1.5), menos a lo ruidoso (volumen 0.5, estocástico y %B 0.75, razón corriente 0.75).
**No hubo ajuste estadístico ni backtesting**; está declarado en el código, en ADR-002/012 y en §J. Lo que sí garantiza el diseño:
cualquier peso es **visible** (`GET /cores/catalogo`), **trazable** (`versionAlgoritmo`) y **neutralizable** (desmarcar la señal).

---

## I. Pruebas, verificación y despliegue

### I.1 Pruebas automáticas (sin red)

`npm.cmd test` compila `src/ → dist/` y ejecuta `node --test` sobre 10 archivos. Resultado el 2026-11-17: **122 pruebas, 122
aprobadas, 0 fallidas** (≈ 2 s).

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `scripts/check-models.cjs` | 29 | Esquemas: estricto, referencias, subdocumentos, validaciones cruzadas, secretos ocultos |
| `tests/cores.test.cjs` | 42 | util (SMA, RSI de Wilder, EMA, Bollinger, ATR, HV, regresión), reglas, los 5 cores, confluencia (incl. caso NVDA, unánimes), estrategias, Black-Scholes de libro, regresiones 1.1.0 (split 10:1, IV vencida/absurda, look-ahead fundamental, titulares sin términos) |
| `tests/integrations.test.cjs` | 19 | Adaptadores con `fetch` simulado: velas, paginación, contratos/snapshots, sin credenciales, **URL live rechazada**, orden `mleg`, estados, reintento 429, errores sin secretos, timeout → RED, SEC (User-Agent, CIK, frames XBRL, 13F por CUSIP y nombre), estado sin revelar valores |
| `tests/senales-activos.test.cjs` | 9 | `filtrarSenales`, cores honran `parametros.indicadores`, búsqueda de activos (caché 12 h), catálogo HTTP, `mercado/panorama` (cambio y caché), sincronizar posiciones, parámetros (noticias configurable, intervalo solo 1Day, rango de vencimientos), `AUTH_USERS_JSON` con prioridad |
| `tests/services.test.cjs` | 7 | CRUD con aislamiento por usuario **y base**, no falsificar dueño ni claves Mongo, lotes, referencias y subdocumentos, sesión (elige base, rechaza token alterado, revoca) |
| `tests/operacion.test.cjs` | 7 | Conexión paper idempotente (sin credenciales → 503), ticket idempotente con `client_order_id` = key, validaciones, Iron Condor → `mleg` con `limit_price` negativo, convención crédito/débito, cierre, resumen |
| `tests/http.test.cjs` | 2 | Flujo HTTP completo con Express (incluida la selección) |
| `tests/acciones.test.cjs` | 1 | Flujo funcional: sincronizar → cores → confluencia → selección → configuración → orden paper |
| `tests/start.test.cjs` | 1 | El servidor compilado arranca y responde `/health` |
| `tests/trabajos-auditoria.test.cjs` | 5 | Trabajos huérfanos (> 15 min → «fallida»), filtro de opciones por días a vencimiento, eventos de auditoría y correo enmascarado, TTL/limpieza de sesiones |

(Conteo ejecutado tras corregir las brechas detectadas al redactar esta guía: 122.)

**Por qué estas pruebas convencen.** Las fórmulas se comparan con **valores conocidos de libro** (Black-Scholes 10.4506/5.5735,
RSI de Wilder, paridad put-call con tolerancia 1e-9), con **casos construidos a mano** (NVDA, splits) y con **invariantes**
(`puntaje = 50 + 50·sesgo`, métricas finitas, rangos [0, 1]). Las integraciones usan `fetch` inyectado: se prueba el código propio
sin depender de la red.

### I.2 Pruebas reales opt-in ("smokes", requieren `.env` con claves)

| Comando | Qué hace |
|---|---|
| `npm.cmd run smoke:real -- mongodb AAPL --institucional` | Flujo completo real (Alpaca + SEC + base) con usuario temporal; limpia al final; no envía órdenes |
| `npm.cmd run smoke:orden -- mongodb` | Orden limit de 1 contrato a 0.01 (no se ejecuta) → reenvío idempotente → sincronización → cancelación |
| `npm.cmd run smoke:ejecucion -- mongodb` | Compra market de 1 call ATM de AAPL y la cierra (`sell_to_close`); requiere mercado abierto; dinero simulado |
| `node scripts/smoke-ticket.cjs mongodb` (tras build) | Ticket de Iron Condor a crédito lejos del precio y cancelación; nunca deja órdenes abiertas |
| `node scripts/guia/ejemplos.cjs` | Reproduce todos los números de esta guía (sin red) |

Resultados citados en la documentación del proyecto (no re-ejecutados para esta guía porque requieren claves y mercado): el
reenvío con la misma key devuelve la misma orden y una key ajena da 409; un Iron Condor con `limit_price` negativo fue aceptado y
cancelado en paper (ADR-011); en una ejecución real comprar y vender de inmediato costó ≈ 80 USD por el spread.

### I.3 Despliegue en Render (resumen; detalle en §C.9 y `docs/despliegue-render.md`)

1. Código en GitHub (`.env`, `private/` y `backups/` en `.gitignore`).
2. MongoDB Atlas: permitir `0.0.0.0/0` (Render free no tiene IP fija; la protección queda en usuario/contraseña).
3. `npm.cmd run exportar:usuarios` → copiar la línea JSON en `AUTH_USERS_JSON`.
4. Render → New → Blueprint → elegir el repositorio; pegar los secretos `sync: false`.
5. Comprobar `GET /health` → `{"status":"ok"}`, abrir `/` (login) y que Alpaca/SEC aparezcan configurados (`GET /integraciones/estado`).

Efectos del plan gratuito: el servicio se duerme tras ~15 min sin tráfico (primera visita 30–60 s); un redeploy pierde los trabajos
de la cola en memoria (al consultarlos tras 15 min pasan a «fallida» y hay que relanzarlos); las sesiones sobreviven porque viven en la base.

---

## J. Limitaciones honestas y mejoras posibles

| Limitación | Detalle | Mejora posible |
|---|---|---|
| Pesos y escalas heurísticos | `pesoBase`, escalas de `tanh`, umbrales y ±15 no se ajustaron con datos | Guardar evaluaciones + precios posteriores y calibrar (backtesting) |
| Sin backtesting | No hay medida de acierto histórico | Registro histórico; además pasar `fechaPresentacion` a fundamentales para evitar look-ahead |
| Feed IEX | Volumen de un solo mercado; velas desde 2020-07 | Feed SIP de pago |
| Vela parcial | La última vela puede ser la sesión en curso | Excluir la vela del día hasta el cierre |
| Ajuste solo por split | HV y retornos sin dividendos | Ajuste `all` |
| IV indicativa | Feed `indicative`, no OPRA | Feed OPRA de pago |
| Sin historial de IV | Solo el último snapshot por contrato → no hay IV Rank | Guardar snapshots diarios |
| Ajuste IV/HV centrado en 1.0 | Favorece levemente al Iron Condor; horizontes distintos | Centrar en ≈ 1.1–1.2 medido, IV del mismo vencimiento |
| Acuerdo lineal | `A = 1 − D` | Evaluar `A²` con datos |
| Léxico no validado | 287 términos a mano; sin frases ni contexto | Validar con titulares etiquetados o un modelo de lenguaje |
| 13F | 9 gestores, coincidencia por nombre, rezago 45 días | CUSIP, más gestores |
| `deuda_capital` | Pasivos totales, no deuda financiera; capital negativo → −1 | Conceptos de deuda (`LongTermDebt`…) |
| Black-Scholes | Europeo, r fija 4 %, q = 0, IV constante; probabilidad neutral al riesgo | Tasa de mercado, dividendos, modelo binomial para americanas |
| Parámetros sin efecto | `periodos` (reservado). `diasVencimiento*` ya filtran los contratos del core `indicadores` | Conectar `periodos` o eliminarlo del esquema |
| Selector de vencimiento sin pruebas | El rango de días y `reconstruirPatas` son lógica de interfaz recién añadida, sin pruebas automáticas | Pruebas unitarias de `estrategiasOrden.js` |
| Cola en memoria | Una instancia; trabajos en curso se pierden al reiniciar. Los `pendiente`/`procesando` de más de 15 min no activos se marcan `fallida` al leerlos (ADR-003 implementado) | Cola persistente (BullMQ/Redis) |
| Configuración por orden | Cada ticket crea una Configuracion | Deduplicar o archivar |
| Auditoría | Eventos automáticos de sesiones, órdenes, cierres, verificación de broker y trabajos (mejor esfuerzo; un fallo al registrar no afecta la operación). Logins fallidos de usuario desconocido quedan bajo `anonimo` con email enmascarado | Visor/filtros por acción |

---

## K. Banco de preguntas del revisor

Formato: **pregunta** → respuesta corta → *archivo para señalar*.

### K.1 Arquitectura

1. **¿Qué hace la herramienta en una frase?** Sincroniza datos de Alpaca y la SEC, evalúa 5 cores direccionales, los combina en
   compatibilidad con Long Call, Long Put e Iron Condor, y envía la orden a Alpaca paper. *§A; `src/app.js`.*
2. **¿Por qué los cores son funciones puras?** Para que sean reproducibles, probables sin red y auditables: el servicio carga los
   datos y guarda la Evaluación con versión, parámetros, reglas y fuentes (ADR-001). *`src/cores/README.md`, `analisis.service.js → calcular`.*
3. **¿Cómo fluye una petición de análisis?** Ruta `POST /cores/:core/evaluaciones` → `analisis.ejecutarCore` → `iniciarTrabajo`
   (202 + registro pendiente) → cola → `insumos()` → `core.evaluar` → `finalizar` → Evaluación completada. *`acciones.routes.js`, `analisis.service.js`.*
4. **¿Por qué 202 y sondeo?** Sincronizar o evaluar tarda segundos o minutos; responder de inmediato evita timeouts y deja un
   registro con estado (pendiente → procesando → completada/fallida). *ADR-003, `trabajos.service.js`, `jobs/cola.js`.*
5. **¿Qué pasa si se reinicia el servidor durante un trabajo?** Se pierde (cola en memoria) y su registro queda en `procesando`;
   hay que relanzarlo. Es una limitación declarada. *`jobs/cola.js`, `docs/despliegue-render.md`.*
6. **¿Por qué repetir una sincronización no duplica datos?** `idDeterminista` (SHA-256 de las partes) da el mismo `_id` a la misma
   vela/contrato/noticia y `upsertMany` reemplaza. *`services/registros.js`.*
7. **¿Dónde está el frontend y cómo se sirve?** React + Vite en `web/`; en producción Express sirve `web/dist` con respaldo SPA
   (ADR-007). *`src/app.js`.*
8. **¿Por qué separar técnico e indicadores?** Para no contar dos veces la misma información: técnico = tendencia; indicadores =
   osciladores y volatilidad. *`tecnico.core.js` (comentario de cabecera).*

### K.2 Seguridad y bases de datos

9. **¿Dónde se elige Mongo o Supabase?** En el login (select «Base de datos»); el valor viaja como primera parte del token y
   `repositories/index.js → repository(name, context)` elige `mongoRepository` o `supabaseRepository` según `context.database`.
   *`web/src/pages/Login.jsx`, `sesiones.service.js`, `src/repositories/index.js`.*
10. **¿Cómo es el token?** `baseDatos.userId.sesionId.random(64 hex)`; en la base solo se guarda `sha256(token)`, con expiración
    (3600 s por defecto) y revocación. *`sesiones.service.js`.*
11. **¿Cómo se guardan las contraseñas?** scrypt con salt aleatorio de 16 bytes, clave de 64 bytes; comparación con
    `timingSafeEqual` y costo igual si el usuario no existe. *`sesiones.service.js`, `scripts/create-user.cjs`.*
12. **¿Dónde están los usuarios en Render?** En la variable secreta `AUTH_USERS_JSON` (hashes, no contraseñas), generada con
    `npm run exportar:usuarios`; en local, `private/users.json`. *`config.js`, `render.yaml`.*
13. **¿Un usuario puede ver datos de otro?** No: todo repositorio filtra por `owner_id`, `obtener()` responde «Referencia
    inexistente o ajena» y se validan las referencias al crear. *`repositories/*/repository.js`, `crud.service.js → references`.*
14. **¿Cómo evitan inyección?** Esquemas `strict: 'throw'`, campos protegidos (`_id`, `usuarioId`, claves con `$` o `.`) y
    `filtroSeguro` (solo claves alfanuméricas y valores string). *`crud.service.js`, `repositories/resources.js`.*
15. **¿Se puede operar con dinero real?** No: la URL de trading está fija a paper (`NO_PERMITIDO` si no) y las conexiones `live`
    se rechazan con 403 (ADR-005). *`alpaca.client.js → createAlpacaClient`, `broker.service.js`.*
16. **¿Dónde están las claves de Alpaca?** En variables del servidor; la conexión solo guarda `credencialRef = 'env:ALPACA'`,
    oculto en las respuestas (ADR-006). *`broker.service.js`, `models/ConexionBroker.js`.*
17. **¿Por qué el token en sessionStorage?** Se pierde al cerrar la pestaña; el riesgo XSS se mitiga porque React escapa el
    contenido (ADR-007). *`web/src/api/client.js`.*
18. **¿Y la base Supabase está expuesta?** No: RLS activo y `REVOKE ALL` a `anon`/`authenticated`; solo el servidor con la clave
    secreta accede. *`database/schema.sql`, `config/supabase.config.js`.*

### K.3 Datos

19. **¿De dónde salen los datos de "Mercado hoy"?** De `GET /mercado/panorama` con los ETF **SPY, QQQ, DIA, IWM** (S&P 500,
    Nasdaq 100, Dow Jones, Russell 2000): velas de los últimos 70 días (se muestran 45) y cotización de Alpaca, caché de 5 min por
    proceso, sin guardar en la base; el mini gráfico es `Sparkline.jsx` (SVG propio). *`mercado.controller.js → panoramaSimbolo`,
    `pages/analizar/Inicio.jsx`.*
20. **¿Qué tan atrás llegan los gráficos?** La sincronización normal trae 420 días; el botón «Cargar histórico largo (10 años)»
    pide 10 años, pero IEX solo tiene datos desde 2020-07. Semanal y mensual se agregan en el navegador. *`GraficoPanel.jsx`,
    `web/src/utils/velas.js → agregar`.*
21. **¿Qué es IEX y por qué importa?** Un solo mercado (no el consolidado): el volumen es parcial, así que el volumen relativo pesa
    solo 0.5. *`alpaca.client.js`, `tecnico.core.js`.*
22. **¿Qué es el 13F y de dónde sale?** Informe trimestral de tenencias de grandes gestores, presentado hasta 45 días después del
    trimestre. Se lee de SEC EDGAR (13F-HR) para 9 gestores fijos y se coincide por `nameOfIssuer` normalizado.
    *`src/integrations/institucionales.js`, `sec.client.js → tenencias13F`.*
23. **¿Por qué por nombre y no por CUSIP?** La sincronización no tiene el CUSIP de la empresa; el adaptador ya acepta CUSIP, es
    una mejora pendiente. Se usa el nombre de la SEC, que coincide mejor que el de Alpaca. *`sincronizacion.service.js → institucional`.*
24. **¿De dónde salen los fundamentales?** SEC `companyfacts` (XBRL us-gaap), formas 10-K/10-Q, con frames calendario para
    deduplicar. *`sec.client.js → construirFundamentales`.*
25. **¿Por qué solo strikes ±5 % para la IV?** La IV de contratos muy ITM/OTM (sonrisa) distorsiona el promedio. Al sincronizar
    se traen ±25 % para poder armar estrategias. *`analisis.service.js → insumos`, `sincronizacion.service.js → contratos`.*
26. **¿Cómo evitan look-ahead?** Todo se filtra contra `fechaReferencia`: velas, fundamentales (`fechaPresentacion` o
    `periodoFin`), 13F (`fechaPublicacion`), noticias y contratos vencidos. Limitación: el servicio no pasa `fechaPresentacion`.
    *`util.limpiarVelas`, cada core.*

### K.4 Core técnico

27. **¿Por qué 50 y 200?** Convención estándar de mediano y largo plazo; constantes fijas `SMA_CORTA`, `SMA_LARGA`. *`tecnico.core.js`.*
28. **¿Por qué tanh(%/5) y tanh(%/10)?** `tanh` satura suavemente; la escala es el desvío que da 0.76: 5 % de la SMA50 y 10 % de
    la SMA200 son desvíos "claros". *`tecnico.core.js`.*
29. **¿Por qué la SMA200 pesa 1.5 y el volumen 0.5?** La tendencia larga es la más persistente; el volumen es una sola vela y con
    IEX es parcial. Heurística, no estadística. *`SENALES` de `tecnico.core.js`.*
30. **¿Por qué pendiente de regresión y no variación de 20 días?** La regresión usa los 20 puntos y no depende de un día extremo
    en los bordes. *`util.pendienteRegresion`.*

### K.5 Core indicadores

31. **¿Por qué RSI 14?** Es la definición original de Wilder (1978); no se optimizó. *`indicadores.core.js → RSI_N`.*
32. **¿Por qué un RSI de 85 no da +1?** `senalOscilador` atenúa en sobrecompra (85 → 0.5; 100 → 0): momentum que se agota; no se
    invierte a negativo para no apostar a la reversión. *`indicadores.core.js → senalOscilador`.*
33. **¿Para qué sirve la volatilidad si no tiene dirección?** Cuenta en la cobertura y alimenta el ajuste IV/HV del Iron Condor.
    *`indicadores.core.js`, `confluencia.core.js → ajusteVolatilidad`.*
34. **¿Por qué √252?** Si los retornos diarios son independientes las varianzas se suman: `σ_anual = σ_diaria·√252`; 252 ≈ sesiones
    por año. *`util.volatilidadHistorica`.*
35. **¿Por qué HV muestral y Bollinger poblacional?** HV es un estimador estadístico (n − 1); Bollinger se define con la poblacional.
    *`util.desviacion`.*

### K.6 Core fundamental

36. **¿El fundamental usa Black-Scholes?** No. Usa estados financieros de la SEC; Black-Scholes solo está en `blackscholes.js`.
37. **¿Cómo compara periodos?** Solo misma duración: anual con anual, o trimestre con el mismo trimestre del año anterior
    (365 ± 25 días). *`fundamental.core.js → tipoPeriodo`.*
38. **¿Por qué |U₁| en el crecimiento de utilidad?** Para que pasar de −20 a −5 sea mejora (+75 %), no empeoramiento.
39. **¿Por qué deuda/capital con pasivos totales?** El XBRL estándar no separa deuda financiera de forma homogénea; está declarado
    en un motivo fijo y como limitación.

### K.7 Core institucional

40. **¿Qué es el panel balanceado?** Solo se comparan gestores presentes en ambos cortes; un 13F aún no presentado no se lee como
    venta. *`institucional.core.js`.*
41. **¿Cómo detectan un split?** Si la mediana de razones nuevo/previo (≥ 3 gestores) está a ±5 % de un factor típico, se reexpresa
    el corte previo. *`detectarSplit`.*
42. **¿Por qué 135 días?** 45 días de plazo de presentación + 90 del trimestre; pasado eso la confianza se multiplica por 0.5.

### K.8 Core noticias

43. **¿Cómo se mide el sentimiento?** Léxico propio de 287 términos (−2…+2) con negación, intensificadores y atenuadores; polaridad
    `(pos − neg)/(pos + neg)`. *`lexico.js`, `noticias.core.js → puntuarTexto`.*
44. **¿Por qué vida media de 3 días?** Heurística: el efecto de una noticia se disipa en pocas sesiones; λ = ln2/3 = 0.231/día. **Es
    configurable** con `parametros.vidaMediaDias` (0.25–365) en el perfil o la evaluación. *`noticias.core.js`, `models/shared.js`.*
45. **¿Qué pasa con titulares sin términos?** Bajan la cobertura pero no diluyen el sentimiento (cambio 1.1.0, caso MSFT).

### K.9 Contrato común y confluencia

46. **¿Qué significa puntaje 69 en Long Call?** Compatibilidad 0–100, no probabilidad: `50 + 50·s̄·A = 69` → `s̄·A = 0.38`.
    *`confluencia.core.js`.*
47. **¿Y el puntaje de un core?** Índice direccional `50 + 50·sesgo` (0 bajista, 50 neutral, 100 alcista) (ADR-002). *`util.finalizar`.*
48. **¿Cómo se define la compatibilidad?** Long Call `50 + 50·s̄·A`, Long Put `50 − 50·s̄·A`, Iron Condor `100·N̄ ± 15`, con
    `e_i = peso·confianza`. *§E.1.*
49. **¿Los pesos son arbitrarios?** Hay dos niveles: los pesos de core (0–5) los elige el usuario; los `pesoBase` de las señales son
    heurísticas de experto documentadas, públicas en `/cores/catalogo` y sin calibración estadística (declarado). *§H.3.*
50. **¿Cómo se calcula la confianza?** En un core: `cobertura·(0.5·consistencia + 0.5·intensidad)` (con ajustes propios en
    indicadores, institucional y noticias). En la confluencia: `(Σw·c/Σw)·cobertura·A`. *`util.combinar`, `confluencia.core.js`.*
51. **¿Qué es la dispersión y por qué desviación estándar ponderada?** Cuánto se alejan los cores del consenso, ponderando por
    peso·confianza; rango y entropía de signos se descartaron (ADR-012).
52. **¿Por qué el Iron Condor usa promedio de neutralidades?** Un alcista fuerte y un bajista fuerte promedian 0 pero no indican
    lateralidad. Caso NVDA: 90 → 40.
53. **¿Qué hace el ajuste ±15?** `clamp((IV/HV20 − 1)/0.2)·15`: opciones caras frente a la volatilidad realizada favorecen vender
    prima. Limitación: centrado en 1.0.
54. **¿Qué pasa si un core no tiene datos?** Sesgo null, confianza 0, `datosFaltantes`; en la confluencia se excluye (no es negativo)
    y baja la cobertura. Si ninguno tiene datos: 50 y confianza 0.

### K.10 Opciones y Black-Scholes

55. **¿Para qué usan Black-Scholes?** Verificar delta e IV indicativas de Alpaca, prima teórica y probabilidad de ganancia de una
    configuración. *`estrategias.core.js → metricasBlackScholes`.*
56. **¿La probabilidad de ganancia es real?** No: es neutral al riesgo (deriva = r = 4 %), lognormal, IV constante. Sirve para comparar
    configuraciones, no para pronosticar. *`blackscholes.js → probabilidadSobre`.*
57. **¿Por qué N(d2) es una probabilidad?** Bajo la medida neutral al riesgo `ln S_T` es normal con media `ln S + (r − σ²/2)T`;
    `P[S_T > K] = N(d2)`. *§B.15.*
58. **¿Qué aproximación de N(x) usan?** Abramowitz & Stegun 26.2.17, error < 7.5·10⁻⁸. *`blackscholes.js → cdf`.*
59. **¿Cómo comprobaron Black-Scholes?** Valores de libro (10.4506/5.5735/Δ 0.6368), paridad put-call y IV recuperada 0.2 en
    `tests/cores.test.cjs`.
60. **¿Por qué T con 365 y HV con 252?** T es tiempo de calendario (convención de proveedores de griegas); √252 escala la varianza
    de sesiones de negociación.

### K.11 Órdenes

61. **¿Por qué |Δ| ≈ 0.20 para el condor?** Convención para vender opciones OTM (≈ 20 % de probabilidad de terminar ITM por lado).
    Heurística de la interfaz; el usuario puede cambiar las patas. *`estrategiasOrden.js → porDelta`.*
62. **¿Cómo configuro los días a vencimiento del Iron Condor (p. ej. 30–45)?** En «Configurar análisis» → mín. 30, máx. 45 (defecto
    7–60): se envían a la sincronización de contratos como `diasVencimientoMin/Max` y «Operar» elige el vencimiento más cercano dentro
    del rango; en el ticket se puede cambiar el vencimiento y las patas se reconstruyen. 30–45 es convención de mercado, no un cálculo.
    *`ConfigAnalisis.jsx`, `flujo.js`, `estrategiasOrden.js → elegirVencimiento`, `TicketOrden.jsx`, §G.3.*
63. **¿Cómo garantizan no duplicar órdenes?** Idempotency-Key = `client_order_id`; la API devuelve la orden existente; índice único
    en la base; `enviar` no reenvía si ya hay `ordenExternaId`. *`operacion.service.js`, `broker.service.js`.*
64. **¿Por qué limit_price negativo?** Alpaca define negativo = crédito en `mleg`; nuestra API expone siempre positivo + `credito: true`
    y traduce en un solo lugar. *`alpaca.client.js → precioLimiteAlpaca`.*
65. **Explique el ticket TSLA.** Crédito `3.97 + 2.90 − 2.39 − 1.51 = 2.97` → ganancia máx. 297; ancho 10 → pérdida máx.
    `(10 − 2.97)·100 = 703`; breakevens 349.53 y 410.47; se envía `limit_price: "-2.97"`. *§F.3, §G.5.*

### K.12 Pruebas y despliegue

66. **¿Cómo probaron que funciona?** 122 pruebas automáticas sin red y smokes reales opt-in con Alpaca paper y la SEC. *§I.*
67. **¿Qué pasa si Alpaca falla?** Los adaptadores normalizan errores (`IntegrationError` con SIN_CREDENCIALES 503, LIMITE 429,
    NO_ENCONTRADO 404, PROVEEDOR/RED 502…); el trabajo queda `fallida` con un mensaje sin secretos. *`src/app.js`, `trabajos.service.js`.*
68. **¿Cómo se despliega?** Blueprint de Render (`render.yaml`): un servicio Node que compila API y web, health check `/health`,
    secretos en el panel, `autoDeploy` al hacer push. *`docs/despliegue-render.md`.*
69. **¿Qué mejorarías primero?** Backtesting para calibrar pesos; historial de IV (IV Rank); pruebas de la lógica de interfaz
    (`estrategiasOrden.js`); CUSIP para 13F; cola persistente. *§J.*

---

## L. Glosario alfabético

| Término | Definición en una línea |
|---|---|
| Acuerdo (A) | `1 − D`: qué tanto coinciden los cores; multiplica la señal direccional en la confluencia |
| ADR | Registro de decisión técnica (`docs/decisiones/README.md`, ADR-001…012) |
| Ala | Opción comprada más lejos en un Iron Condor que limita la pérdida |
| Ask | Mejor precio de venta publicado |
| ATM / ITM / OTM | En / dentro / fuera del dinero según la relación entre S y K |
| ATR | Rango verdadero promedio (Wilder, 14): volatilidad en dólares |
| Bid | Mejor precio de compra publicado |
| Black-Scholes | Modelo de precio de opciones europeas con precio lognormal y σ constante |
| Bollinger %B | Posición del precio entre bandas SMA20 ± 2σ |
| Breakeven | Precio del subyacente al vencimiento con resultado cero |
| Call | Derecho a comprar al strike |
| CIK | Identificador de 10 dígitos de un registrante en la SEC |
| `clamp` | Recorta un valor a [mín, máx] |
| `client_order_id` | Identificador propio de la orden en Alpaca; aquí = Idempotency-Key |
| Cobertura | Fracción de señales (o cores) que se pudieron calcular |
| Confianza | 0–1: solidez del sesgo (cobertura, consistencia, intensidad, acuerdo) |
| Confluencia | Combinación de los cores en compatibilidad por estrategia |
| Consistencia | `|Σp·v|/Σp·|v|`: 1 si todas las señales apuntan igual |
| Compatibilidad | Puntaje 0–100 por estrategia en la confluencia; no es probabilidad |
| Core | Módulo puro de análisis que devuelve sesgo y confianza |
| Crédito / débito | Cobrar / pagar prima neta al abrir |
| CUSIP | Identificador de 9 caracteres de un valor |
| day / gtc | Vigencia de la orden: hasta el cierre / hasta cancelar |
| Delta (Δ) | ∂V/∂S: cambio de la prima por 1 USD del subyacente |
| Dispersión (D) | Desviación estándar ponderada de los sesgos de los cores |
| EMA | Media móvil exponencial, α = 2/(n + 1) |
| Estocástico %K/%D | Posición del cierre en el rango de 14 días / su media de 3 |
| ETF | Fondo cotizado que replica un índice (SPY, QQQ, DIA, IWM) |
| Extrínseco | Prima − valor intrínseco |
| `fechaReferencia` | "Hoy" para un core; nada posterior se usa |
| Filer 13F | Gestor que presenta el formulario 13F |
| Gamma (Γ) | ∂²V/∂S²: cambio de la delta |
| HV | Volatilidad histórica anualizada (retornos log × √252) |
| IEX | Mercado único cuyo feed gratuito usa Alpaca |
| Idempotencia | Repetir una operación no cambia el resultado (no duplica órdenes) |
| `idDeterminista` | UUID derivado por SHA-256 de partes fijas para hacer upsert |
| Intensidad | `Σp·|v|/Σp`: qué tan lejos de 0 están las señales |
| Intrínseco | Lo que vale ejercer ya: `max(0, S − K)` o `max(0, K − S)` |
| Iron Condor | 4 patas neutrales con crédito; gana si el precio queda entre las patas cortas |
| IV | Volatilidad implícita: la σ que reproduce la prima con Black-Scholes |
| IV Rank | Posición de la IV actual en su rango anual (no disponible: sin historial) |
| Léxico | Diccionario de palabras con valor de sentimiento |
| Limit / market | Orden con precio máximo/mínimo / a mercado |
| Lognormal | Distribución cuyo logaritmo es normal |
| Long / short | Posición comprada / vendida |
| Look-ahead | Usar información que aún no se conocía |
| MACD | EMA12 − EMA26; histograma = MACD − EMA9(MACD) |
| Mid | `(bid + ask)/2` |
| `mleg` | Orden multi-pata de Alpaca |
| Multiplicador | 100 acciones por contrato |
| N(x), φ(x) | Distribución acumulada y densidad normal estándar |
| Neutral al riesgo | Medida de probabilidad con deriva igual a la tasa libre de riesgo |
| Neutralidad media (N̄) | `Σe(1 − |s|)/Σe` |
| OCC | Formato de símbolo de opción (`TSLA261201P00352500`) |
| OHLCV | Apertura, máximo, mínimo, cierre, volumen |
| Paper trading | Cuenta simulada del broker |
| Paridad put-call | `C − P = S − K·e^(−rT)` |
| Payoff | Resultado al vencimiento según el precio final |
| `pesoBase` | Peso fijo de una señal dentro de su core |
| Prima | Precio de la opción por acción |
| Puntaje (de core) | `50 + 50·sesgo`: índice direccional |
| Put | Derecho a vender al strike |
| Razón corriente | Activo circulante / pasivo circulante |
| Regla (de perfil) | Condición sobre una métrica que suma/resta puntos o neutraliza |
| Retorno logarítmico | `ln(C_t/C_{t−1})` |
| Rho | ∂V/∂r por punto porcentual |
| RSI | Índice de fuerza relativa de Wilder (14) |
| scrypt | Función de derivación de claves lenta con salt |
| SEC / EDGAR | Regulador de valores de EE. UU. / su sistema de presentaciones |
| Selección | Trabajo que evalúa cores y ordena empresas/estrategias por compatibilidad |
| Sesgo | Dirección estimada en [−1, 1] |
| SMA | Media móvil simple |
| Snapshot de opción | Última cotización, IV y griegas de un contrato |
| Spread | `ask − bid` |
| Split | División de acciones (p. ej. 10:1) |
| Strike (K) | Precio de ejercicio |
| `tanh` | Tangente hiperbólica: mapeo suave y saturado a (−1, 1) |
| Theta (Θ) | ∂V/∂t por día natural |
| Upsert | Insertar o reemplazar según exista el `_id` |
| Vega | ∂V/∂σ por punto de volatilidad |
| Vencimiento | Fecha de expiración de la opción (20:00 UTC en el código) |
| Vida media | Días en que el peso de una noticia cae a la mitad |
| XBRL / us-gaap | Formato etiquetado de estados financieros / su taxonomía |
| YoY | Comparación contra el mismo periodo del año anterior |
| 10-K / 10-Q | Informe anual / trimestral a la SEC |
| 13F-HR | Informe trimestral de tenencias institucionales |
