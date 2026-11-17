# Inventario técnico de los cores (exacto, generado del código final)

Fecha: 2026-11-17. Fuente de verdad: `src/cores/*.js`. Este documento describe **exactamente** lo que calcula el código
(versiones `tecnico@1.1.0`, `indicadores@1.1.0`, `fundamental@1.1.0`, `institucional@1.1.0`, `noticias@1.1.0`,
`confluencia@1.1.0`, `estrategias@1.1.0`, `blackscholes@1.0.0`, `reglas@1.0.0`, `lexico@1.1.0`).
Notación: `clamp(x)` = acotar a [−1, 1] salvo que se indiquen otros límites; `tanh` = tangente hiperbólica;
`N(x)` = normal estándar acumulada; Σ = suma; "vela" = barra diaria OHLCV.

---

## 0. Arquitectura y flujo de datos

| Paso | Dónde | Qué hace |
|---|---|---|
| Sincronización | `src/api/v1/services/sincronizacion.service.js` + `src/integrations/*.client.js` | Descarga y guarda en la base (MongoDB o Supabase) velas, noticias, fundamentales, 13F, contratos y snapshots de opciones. |
| Insumos | `analisis.service.js` → `insumos()` | Lee lo guardado y arma `input` del core según `REQUIERE`. |
| Core | `src/cores/<core>.core.js` → `evaluar(input)` | Función pura y síncrona (ADR-001): sin red, sin base, sin `Date.now()`, sin azar. "Hoy" = `input.fechaReferencia` (el servicio pasa la hora actual). |
| Confluencia | `confluencia.core.js` | Combina los cores en compatibilidad por estrategia (ADR-012). |
| Selección | `analisis.service.js` → `ejecutarSeleccion` | Ejecuta cores + confluencia por empresa/estrategia y ordena por puntaje (desempate por cobertura). |
| Configuración | `estrategias.core.js` (+ `blackscholes.js`) | Valida patas, payoff, breakevens y métricas Black-Scholes de una configuración con contratos reales. |

### Fuentes de datos

| Insumo | Colección guardada | Proveedor / endpoint | Notas |
|---|---|---|---|
| `velas` | `datos-mercado` (tipo `vela`, intervalo `1Day` por defecto, `parametros.intervalo`) | Alpaca Market Data `GET /v2/stocks/bars`, `feed=iex`, `adjustment=split`, `sort=asc` | Sincroniza ~420 días por defecto (≈ 290 sesiones) o desde `desde`; hasta 10 000 velas. IEX solo tiene historia desde 2020-07. Precios ajustados por split, no por dividendos. |
| `opciones` (opcional, `opciones?`) | `contratos` + `datos-mercado` (tipo `snapshot_opcion`, el más reciente por contrato) | Alpaca Trading `GET /v2/options/contracts` (strikes ±25 % del precio) y Market Data `GET /v1beta1/options/snapshots/{subyacente}`, `feed=indicative` | El servicio solo pasa contratos con strike a ±5 % del último cierre. `volatilidadImplicita` = `impliedVolatility` (fracción anual); `griegas` = `greeks` {delta, gamma, theta, vega, rho}. Feed indicativo: cotizaciones derivadas/retrasadas, no OPRA. |
| `noticias` | `noticias` (filtradas por `simbolos` que contienen el símbolo) | Alpaca `GET /v1beta1/news` (contenido Benzinga) | Sincroniza 14 días por defecto, máx. 50 noticias. Campos usados: `titulo`, `resumen`, `publicadaEn`. |
| `fundamentales` | `fundamentales` | SEC `GET https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | Formas 10-K, 10-Q, 10-K/A, 10-Q/A. Se usan los *frames* calendario de la SEC (`CY2024`, `CY2024Q1`, `CY2024Q1I`) para deduplicar comparativos. Máx. 12 periodos. |
| `reportes` | `institucional` | SEC `GET data.sec.gov/submissions/CIK##########.json` (13F-HR, 2 cortes por filer) + `Archives/edgar/data/{cik}/{accn}/index.json` → tabla de información XML | Coincidencia por nombre de emisor normalizado (o CUSIP si se pasa). Excluye filas `PRN` y opciones (`putCall`). |

**Etiquetas us-gaap usadas** (`src/integrations/sec.client.js`, `METRICAS_SEC`, en orden de preferencia):

| Métrica | Tipo | Unidad | Conceptos us-gaap |
|---|---|---|---|
| ingresos | duración | USD | `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, `RevenueFromContractWithCustomerIncludingAssessedTax` |
| utilidad_neta | duración | USD | `NetIncomeLoss`, `ProfitLoss`, `NetIncomeLossAvailableToCommonStockholdersBasic` |
| activos | instante | USD | `Assets` (sincronizado, no usado por el core) |
| pasivos | instante | USD | `Liabilities` |
| capital | instante | USD | `StockholdersEquity`, `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| activo_circulante | instante | USD | `AssetsCurrent` |
| pasivo_circulante | instante | USD | `LiabilitiesCurrent` |
| flujo_operativo | duración | USD | `NetCashProvidedByUsedInOperatingActivities`, `NetCashProvidedByUsedInOperatingActivitiesContinuingOperations` |
| eps_diluido | duración | USD/acción | `EarningsPerShareDiluted`, `EarningsPerShareBasicAndDiluted` |

**Filers 13F-HR** (`src/integrations/institucionales.js`, `FILERS_13F`, CIK verificados 2026-11-16):
Vanguard Capital Management LLC (0002100119), Vanguard Portfolio Management LLC (0002100121), BlackRock, Inc. (0002012383),
State Street Corp (0000093751), FMR LLC (0000315066), Berkshire Hathaway Inc (0001067983), Geode Capital Management, LLC (0001214717),
Morgan Stanley (0000895421), JPMorgan Chase & Co (0000019617).

---

## 1. Esquema común (`src/cores/util.js`)

Exporta: `esNumero, clamp, round, promedio, tiempo, DIA_MS, desviacion, smaSerie, sma, emaSerie, ema, rsi, macd, estocastico,
bollinger, atr, volatilidadHistorica, pendienteRegresion, limpiarVelas, combinar, filtrarSenales, metrica, finalizar`.

Cada core exporta `VERSION`, `REQUIERE` (insumos; `x?` = opcional), `SENALES` (catálogo: nombre, etiqueta, descripción, `pesoBase`)
y `evaluar(input) → { sesgo, confianza, puntaje, cobertura, metricas, motivos, datosFaltantes, reglas }`.

### 1.1 Sub-señales → sesgo, confianza, cobertura (`combinar`)
Entrada: lista de sub-señales `{ nombre, valor ∈ [−1, 1] o null, peso = pesoBase }` (tras `filtrarSenales`). Sea V el conjunto con
valor numérico y peso > 0, y n el total de la lista.
- `cobertura = |V| / n`
- `sesgo = clamp( Σ_V p·v / Σ_V p )`
- `consistencia = |Σ_V p·v| / Σ_V p·|v|` (1 si todas apuntan al mismo lado; 0 si se cancelan) — 0 si Σp|v| = 0
- `intensidad = Σ_V p·|v| / Σ_V p` (qué tan lejos de 0 están en promedio)
- `confianza = clamp( cobertura · (0.5·consistencia + 0.5·intensidad), 0, 1 )`
- Sin sub-señales válidas: `sesgo = null`, `confianza = 0`.

### 1.2 Selección de señales (`filtrarSenales`, ADR-010)
`parametros.indicadores` (lista de nombres de señales de cualquier core). Si contiene al menos una señal del core, solo esas entran en
`combinar` (cobertura y confianza se calculan sobre esa lista reducida) y se agrega el motivo "Señales usadas: … (selección del usuario)."
Si no contiene ninguna, se usan todas.

### 1.3 Resultado (`finalizar`) y reglas del perfil (`reglas.js`)
1. Métricas con valor no finito se descartan (`metrica` devuelve null); valores redondeados a 4 decimales.
2. Se agregan métricas `sesgo` (si no es null), `confianza`, `cobertura`.
3. `aplicarReglas` (ver §1.4) sobre esas métricas.
4. `sesgo = round(sesgo tras reglas, 4)`; `puntaje = round(50 + 50·sesgo, 2)` (0 = bajista, 50 = neutral, 100 = alcista; ADR-002).

### 1.4 Reglas del perfil (`reglas.js`, `reglas@1.0.0`)
Regla = `{ core?, criterio (= nombre de una métrica del core), operador, valorReferencia, valorSuperior?, peso ≥ 0, obligatoria, activo }`.
- Solo reglas con `activo !== false` y, si traen `core`, del core evaluado (el servicio ya filtra por core).
- Operadores: `eq` (|v − ref| ≤ 1e-9), `ne`, `gt`, `gte` (v ≥ ref − 1e-9), `lt`, `lte` (v ≤ ref + 1e-9), `between` (ref ≤ v ≤ sup, tolerancia 1e-9; `sup < ref` = mal formada).
- `puntaje₀ = 50 + 50·sesgo`; dirección `d = signo(sesgo)`.
- No obligatoria evaluable: `puntaje += (cumplida ? +1 : −1) · d · peso`. Con `d = 0` no hay ajuste. Puede cruzar 50 (cambiar de dirección).
- Obligatoria incumplida: al final `puntaje = 50`, `confianza = 0`, motivo "Regla obligatoria incumplida… Resultado forzado a neutral."
- Métrica inexistente: `cumplida = null`, `metrica:<criterio>` en `datosFaltantes`. Regla mal formada: se ignora con motivo.
- `puntaje = clamp(puntaje, 0, 100)`; `sesgo final = (puntaje − 50)/50`.

### 1.5 Velas (`limpiarVelas`)
Solo velas con apertura, máximo, mínimo, cierre finitos y fecha válida, con **fecha ≤ fechaReferencia** (sin anticipación),
ordenadas ascendentemente (estable).

### 1.6 Fórmulas estándar de `util.js`
| Función | Fórmula exacta | Datos mínimos |
|---|---|---|
| `sma(x, n)` | promedio de los últimos n valores | n |
| `emaSerie(x, n)` | semilla = SMA de los primeros n; luego `e_t = x_t·k + e_{t−1}·(1 − k)`, `k = 2/(n + 1)` | n |
| `rsi(c, 14)` | Wilder: G₀, P₀ = promedio simple de subidas/bajadas de los primeros 14 cambios; luego `G_t = (G_{t−1}·13 + max(Δ,0))/14`, igual P; `RSI = 100 − 100/(1 + G/P)`; P = 0 → 100 (o 50 si G = 0) | 15 cierres |
| `macd(c, 12, 26, 9)` | `línea = EMA12 − EMA26` (desde el índice 25); `señal = EMA9(línea)`; `histograma = línea − señal` | 34 cierres |
| `estocastico(v, 14, 3)` | `%K_t = (C_t − mín14)/(máx14 − mín14)·100` (50 si máx = mín), con máximos/mínimos intradía; `%D = promedio de los últimos 3 %K` | 16 velas |
| `bollinger(c, 20, 2)` | media = SMA20; σ = desviación **poblacional** de 20 cierres; bandas = media ± 2σ; `%B = (C − inferior)/(superior − inferior)` (0.5 si σ = 0) | 20 cierres |
| `atr(v, 14)` | `TR = máx(H − L, |H − C_{t−1}|, |L − C_{t−1}|)`; semilla = promedio de los primeros 14 TR; `ATR_t = (ATR_{t−1}·13 + TR_t)/14` | 15 velas |
| `volatilidadHistorica(c, n)` | `r_t = ln(C_t/C_{t−1})` de los últimos n retornos; desviación **muestral** (n − 1) × √252; fracción anual; precio ≤ 0 → null | n + 1 cierres |
| `pendienteRegresion(y)` | mínimos cuadrados con x = 0..n−1: `Σ(x − x̄)(y − ȳ)/Σ(x − x̄)²` | 2 |

---

## 2. Core técnico (`tecnico.core.js`, `tecnico@1.1.0`)
Exporta `VERSION`, `REQUIERE = ['velas']`, `SENALES`, constantes y `evaluar`. Familia: tendencia y estructura (no osciladores).

| Señal (`nombre`) | Métrica cruda (unidad) | Mapeo a [−1, 1] | pesoBase | Mínimo | Razón |
|---|---|---|---|---|---|
| `precio_vs_sma50` | `(C/SMA50 − 1)·100` (%) | `tanh(%/5)` | 1 | 50 velas | Tendencia de mediano plazo |
| `precio_vs_sma200` | `(C/SMA200 − 1)·100` (%) | `tanh(%/10)` | 1.5 | 200 | Tendencia de largo plazo, la más persistente |
| `cruce_sma50_200` | `dif = (SMA50/SMA200 − 1)·100` (%) y estado ±1 | `signo(dif)·min(1, |dif|/5)` = `clamp(dif/5)` | 1 | 200 | Cruce dorado/de la muerte |
| `pendiente_20` | pendiente de regresión de 20 cierres / promedio de esos cierres ·100 (%/vela) | `tanh(%/0.5)` | 1 | 20 | Dirección reciente sin depender de un solo día |
| `posicion_rango_52s` | `pos = clamp((C − mín)/(máx − mín), 0, 1)` con máx/mín intradía de hasta 252 velas (fracción) | `2·(pos − 0.5)` (lineal) | 0.75 | 60 (< 252 → aviso `velas<252`) | Cerca de máximos = fuerza relativa |
| `volumen_relativo_20` | `vr = V_último / promedio(V de las 20 velas previas)` (razón) | `signo(C_t − C_{t−1})·clamp(vr − 1, 0, 1)` | 0.5 | 21 con volumen ≥ 0 | El volumen solo confirma la dirección de la última vela; ruidoso |

Métricas adicionales (sin señal): `diferencia_sma50_200` (%), `distancia_maximo_pct = (máx/C − 1)·100`, `distancia_minimo_pct = (C/mín − 1)·100`.
Motivos: posición vs SMA50/SMA200, cruce dorado/de la muerte si cambia el signo de SMA50 − SMA200 en las últimas 20 velas, volumen > 1.5×.
`confianza`, `cobertura`: `combinar` sobre las 6 señales (o las seleccionadas).
`datosFaltantes`: `velas`, `velas<50`, `velas<200`, `velas<20`, `velas<60`, `velas<252`, `volumen<21`.

**Constantes** (todas fijas):
| Nombre | Valor | Por qué |
|---|---|---|
| SMA_CORTA / SMA_LARGA | 50 / 200 | Convención estándar de tendencia de mediano/largo plazo |
| ESCALA_SMA50_PCT | 5 | 5 % sobre la SMA50 → tanh(1) = 0.76; desvío "claro" (heurística) |
| ESCALA_SMA200_PCT | 10 | Ídem para la SMA200, que se separa más del precio |
| ESCALA_CRUCE_PCT | 5 | 5 % de separación entre medias satura la señal |
| VENTANA_CRUCE_RECIENTE | 20 | ≈ 1 mes bursátil para reportar un cruce reciente (solo motivo) |
| VENTANA_PENDIENTE / ESCALA_PENDIENTE_PCT | 20 / 0.5 | 0.5 %/vela ≈ 10 % al mes es tendencia fuerte |
| VENTANA_52S / MIN_RANGO | 252 / 60 | 52 semanas ≈ 252 sesiones (NYSE); 3 meses mínimo |
| VENTANA_VOLUMEN | 20 | Promedio de 1 mes, excluye la vela actual |
| UMBRAL_VOLUMEN_MOTIVO | 1.5 | Solo para el texto del motivo |

---

## 3. Core indicadores (`indicadores.core.js`, `indicadores@1.1.0`)
Exporta `VERSION`, `REQUIERE = ['velas', 'opciones?']`, `SENALES`, `senalOscilador`, constantes y `evaluar`.
Familia: osciladores de momentum (direccionales) y volatilidad (no direccional).

**Mapeo de osciladores** `senalOscilador(v, bajo, alto)` (continuo por tramos; atenúa en extremos en lugar de invertir):
- `bajo ≤ v ≤ alto`: `(v − 50)/(alto − 50)` si v ≥ 50; `(v − 50)/(50 − bajo)` si v < 50.
- `v > alto`: `1 − (v − alto)/(100 − alto)` (de +1 en `alto` a 0 en 100).
- `v < bajo`: `−1 + (bajo − v)/bajo` (de −1 en `bajo` a 0 en 0).

| Señal | Métrica cruda | Mapeo | pesoBase | Mínimo |
|---|---|---|---|---|
| `rsi_14` | RSI de Wilder 14 (0–100) | `senalOscilador(RSI, 30, 70)` | 1 | 15 velas |
| `macd_hist` | histograma MACD 12/26/9 (unidades de precio) | `tanh((hist/C·100)/0.5)` | 1 | 34 |
| `estocastico_k` | %K 14 (y `estocastico_d` = %D 3, solo métrica) | `senalOscilador(%K, 20, 80)` | 0.75 | 16 |
| `bollinger_pctb` | %B de Bollinger 20, 2σ (fracción) | `clamp(2·(%B − 0.5))` | 0.75 | 20 |

No direccionales (cuentan en cobertura): `atr_pct = ATR14/C·100` (%), `hv_20`, `hv_60` (fracción anual), y si hay opciones
`iv_promedio` = promedio simple de `volatilidadImplicita` de los contratos **no vencidos** (vencimiento ≥ referencia − 1 día) con
0 < IV ≤ 5, e `iv_hv_ratio = IV/HV20`.

- `cobertura = (señales direccionales calculadas + volatilidades calculadas) / (señales direccionales + 3, o + 4 si hay opciones)`.
- `confianza = confianza_combinar · cobertura / cobertura_direccional` (= cobertura total × (0.5·consistencia + 0.5·intensidad));
  si `HV20/HV60 > 1.5` → `confianza × 0.8` y motivo "Volatilidad en expansión".
- `datosFaltantes`: `velas`, `velas<15`, `velas<34`, `velas<16`, `velas<20`, `velas<21`, `velas<61`, `opciones.volatilidadImplicita`.

**Constantes** (fijas): RSI_N 14 (Wilder 1978); MACD 12/26/9 (Appel); ESTOCASTICO 14/3 (Lane); BOLLINGER 20/2 (Bollinger);
ATR_N 14 (Wilder); HV_CORTA 20, HV_LARGA 60 (1 y 3 meses bursátiles); RSI 30/70 y estocástico 20/80 (zonas clásicas);
ESCALA_MACD_PCT 0.5 (heurística); UMBRAL_EXPANSION_HV 1.5 y FACTOR_CONFIANZA_EXPANSION 0.8 (heurística: osciladores fallan en rupturas);
IV_MAXIMA 5 (IV > 500 % = error del feed indicativo). pesoBase: heurística (RSI y MACD más usados → 1; estocástico y %B más ruidosos → 0.75).

---

## 4. Core fundamental (`fundamental.core.js`, `fundamental@1.1.0`)
Exporta `VERSION`, `REQUIERE = ['fundamentales']`, `SENALES`, `tipoPeriodo`, constantes y `evaluar`.

**Selección de periodos.**
1. Sin anticipación: un periodo cuenta si `fechaPresentacion ≤ referencia` (si el periodo trae ese campo) o, si no, `periodoFin ≤ referencia`.
   Nota: el servicio actual no pasa `fechaPresentacion` (la referencia es "ahora", así que no hay anticipación en la práctica).
2. Tipo por duración `periodoFin − periodoInicio`: 330–400 días = `anual`; 80–100 = `trimestral`; otro = `otro`; sin fechas → por `forma` (10-K/10-Q).
3. Periodo base = el periodo anual o trimestral más reciente con ingresos (si no, con cualquier flujo).
4. Comparable = mismo tipo con cierre `365 ± 25` días antes (anual vs anual; trimestre vs mismo trimestre del año previo). Nunca se mezclan duraciones.
5. Saldos (pasivos, capital, circulantes): periodo más reciente que tenga ambos valores necesarios.

| Señal | Fórmula (unidad) | Mapeo | pesoBase | Razón |
|---|---|---|---|---|
| `crecimiento_ingresos_yoy` | `(I₀/I₁ − 1)·100` (%), requiere I₁ > 0 | `tanh(g/10)` | 1.5 | Variable fundamental más persistente |
| `crecimiento_utilidad_yoy` | `(U₀ − U₁)/|U₁|·100` (%), U₁ ≠ 0 | `tanh(g/20)` | 1 | Más volátil que ingresos → escala mayor |
| `margen_neto` | `U₀/I₀·100` (%), I₀ > 0 | `tanh(m/10)` | 1 | 10 % ≈ mediana S&P 500 |
| `deuda_capital` | `pasivos totales / capital` (razón), capital > 0; capital ≤ 0 → señal −1 | `clamp(1.5 − d)` | 1 | Pasivos ≈ 1.5× capital es típico |
| `razon_corriente` | `activo circulante / pasivo circulante` (razón), pasivo > 0 | `clamp(rc − 1)` | 0.75 | rc = 1 neutro; ≥ 2 sólido |
| `margen_flujo_operativo` | `flujo operativo / I₀ ·100` (%) | `tanh(m/15)` | 1 | El flujo suele superar a la utilidad |

`eps_diluido` (USD/acción) se reporta sin señal. Motivo fijo: "Pasivos totales se usan como aproximación de deuda".
`datosFaltantes`: `fundamentales`, `fundamentales.periodo_flujo`, `fundamentales.periodo_comparable_yoy`, y el nombre de cada señal no calculable.

**Constantes** (fijas): DIAS_ANUAL [330, 400], DIAS_TRIMESTRAL [80, 100], TOLERANCIA_YOY_DIAS 25 (años fiscales de 52/53 semanas),
escalas 10 / 20 / 10 / 15 (heurísticas, ver tabla), DEUDA_CAPITAL_NEUTRA 1.5, RAZON_CORRIENTE_NEUTRA 1.

---

## 5. Core institucional (`institucional.core.js`, `institucional@1.1.0`)
Exporta `VERSION`, `REQUIERE = ['reportes']`, `SENALES`, `detectarSplit`, constantes y `evaluar`.

1. Reportes conocidos a la fecha: `fechaPublicacion ≤ referencia` (si falta, `fechaCorte`). Reportes con la misma `fechaCorte` se combinan.
2. Acciones por institución = suma de `tenencias[].acciones` por `identificadorInstitucion` (CIK).
3. Se comparan los dos cortes más recientes: A (reciente) y B (previo). Se requieren 2 (si no, `reportes<2`, sin sesgo).
4. **Panel balanceado**: comunes = instituciones en A y en B. Las que están solo en A (`instituciones_nuevas`) o solo en B
   (`instituciones_salen`) se informan pero no entran en la señal (pueden ser 13F aún no presentados o nombres de emisor distintos).
5. **Split**: razones `A_i/B_i` de las comunes con B_i > 0; si hay ≥ 3 y la mediana está a ±5 % de f ∈ {2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50}
   (o de 1/f), `B_i ← B_i·f` y métrica `factor_split`.

| Señal | Fórmula | Mapeo | pesoBase |
|---|---|---|---|
| `cambio_acciones_pct` | `(Σ_comunes A_i / Σ_comunes B_i·f − 1)·100` (%) | `tanh(%/10)` | 1.5 |
| `amplitud_instituciones` | `(aumentan − disminuyen)/comunes` (ya en [−1, 1]) | identidad | 1 |

Métricas: `instituciones_aumentan`, `instituciones_disminuyen`, `instituciones_nuevas`, `instituciones_salen`, `instituciones_comunes`,
`instituciones_reportadas` (del corte reciente), `dias_desde_corte = (referencia − fechaCorte reciente)/1 día`.
`confianza = confianza_combinar × (dias_desde_corte > 135 ? 0.5 : 1)`.
**Constantes** (fijas): DIAS_VIGENCIA 135 (45 días de plazo 13F + 90 de trimestre), FACTOR_CONFIANZA_ANTIGUO 0.5, ESCALA_CAMBIO_PCT 10,
FACTORES_SPLIT, TOLERANCIA_SPLIT 0.05, MIN_INSTITUCIONES_SPLIT 3. pesoBase: heurística (acciones agregadas > conteo de instituciones).

---

## 6. Core noticias (`noticias.core.js`, `noticias@1.1.0`; léxico `lexico.js`, `lexico@1.1.0`)
Exporta `VERSION`, `REQUIERE = ['noticias']`, `SENALES` (`sentimiento_promedio`, pesoBase 1), `normalizarTexto`, `tokenizar`,
`puntuarTexto`, constantes y `evaluar`.

**Texto → tokens:** minúsculas, sin acentos, sin apóstrofos; tokens `[a-z0-9]+`.
**Léxico:** 287 términos inglés/español con valor −2..+2 asignado a mano (±2 eventos extremos: fraud, bankruptcy, plunge, surge;
±1.5 resultados/calificaciones: beat, miss, upgrade, downgrade; ±1 movimientos/tono; ±0.5 términos débiles: risk, buy, higher).

**Puntaje por noticia** (`puntuarTexto(título + " " + resumen)`), recorriendo tokens:
- Negador (`not, no, never, without, nor, neither, cannot, cant, dont, doesnt, didnt, isnt, wasnt, arent, werent, wont, fail, fails, failed, unable, lacks, lack, hardly, sin, nunca, tampoco, ni, jamas`): invierte el signo de los términos en las 3 palabras siguientes.
- Intensificador (`sharply, significantly, strongly, massive, huge, big, biggest, steep, deep, heavily, fuertemente, drasticamente`): ×1.5 al siguiente término dentro de 2 palabras.
- Atenuador (`slightly, modestly, marginally, somewhat, mild, mildly, ligeramente, levemente, leve`): ×0.5 ídem.
- `pos = Σ aportes > 0`, `neg = Σ |aportes < 0|`.
- **Polaridad** `p = (pos − neg)/(pos + neg)` si pos + neg > 0; si no hay términos, la noticia no tiene polaridad.
- **Fuerza** `f = min(1, (pos + neg)/2)`.

**Agregado** (noticias con fecha ≤ referencia, dentro de `ventanaDias`, sin titulares duplicados; solo las que tienen polaridad):
- `peso_i = 0.5^(edad_i/vidaMedia) · f_i` (edad en días)
- `sesgo = sentimiento_promedio = Σ peso_i·p_i / Σ peso_i`
- `consistencia = |Σ peso·p| / Σ peso·|p|`; `confianza = (1 − e^(−Σpeso/2)) · consistencia`
- `cobertura = noticias con polaridad / noticias analizadas` (los titulares sin términos no cuentan como neutros: antes diluían el sesgo hacia 0)
- Métricas: `sentimiento_promedio`, `sentimiento_sin_decaimiento` (promedio simple de p), `noticias_positivas`/`negativas` (p > 0.1 / < −0.1),
  `noticias_con_terminos`, `noticias_analizadas`, `consistencia_noticias`, `peso_efectivo`.
- Sin fecha de referencia: peso uniforme (edad 0) y `fechaReferencia` en datosFaltantes. Sin noticias: `noticias`; sin términos: `noticias.terminos_lexico`.

**Constantes:** VIDA_MEDIA_DIAS 3 (**variable por perfil**: `parametros.vidaMediaDias`), VENTANA_DIAS 30 (**variable**: `parametros.ventanaDias`),
UMBRAL_POLARIDAD 0.1, FUERZA_REFERENCIA 2, SATURACION_PESO 2, VENTANA_NEGACION 3, VENTANA_INTENSIDAD 2,
FACTOR_INTENSIFICADOR 1.5, FACTOR_ATENUADOR 0.5 (todas heurísticas documentadas en el código).

---

## 7. Confluencia (`confluencia.core.js`, `confluencia@1.1.0`, ADR-012)
Exporta `VERSION`, `CORES`, `ESTRATEGIAS`, constantes, `ajusteVolatilidad`, `estadisticos`, `evaluar`.

Entrada: `{ estrategia, evaluaciones:[{core, sesgo, confianza}], ponderaciones:[{core, peso ≥ 0}], coresSeleccionados, volatilidad?: {ivActual, hv20, ivRank} }`.
El servicio toma `sesgo` y `confianza` de las métricas guardadas de cada evaluación y `volatilidad = { ivActual: iv_promedio, hv20: hv_20 }`
del core indicadores. **Ponderaciones**: variables por el usuario (peso 1 por defecto).

Por core i seleccionado con sesgo numérico: `s_i`, `c_i = clamp(confianza, 0, 1)`, `w_i = peso`, **`e_i = w_i·c_i`**.
(La cobertura del core no se multiplica aparte porque ya está dentro de `c_i`.)

| Magnitud | Fórmula |
|---|---|
| Sesgo combinado | `s̄ = clamp(Σ e_i s_i / Σ e_i)` |
| Dispersión | `D = √(Σ e_i (s_i − s̄)² / Σ e_i)` ∈ [0, 1]; un solo core → 0 |
| Acuerdo | `A = clamp(1 − D, 0, 1)` |
| Neutralidad media | `Σ e_i (1 − |s_i|) / Σ e_i` |
| Cobertura | cores con resultado / cores seleccionados |
| Confianza | `(Σ w_i c_i / Σ w_i) · cobertura · A` |
| LONG_CALL | `clamp(50 + 50·s̄·A, 0, 100)` |
| LONG_PUT | `clamp(50 − 50·s̄·A, 0, 100)` |
| IRON_CONDOR | `clamp(100·neutralidad media + ajuste, 0, 100)` |
| Ponderaciones efectivas | `e_i / Σ e` (suman 1; 0 para cores sin resultado) |

**Ajuste de volatilidad del Iron Condor** (`ajusteVolatilidad`):
- Con IV y HV20 > 0 (ambas fracción anual): `ajuste = clamp((IV/HV20 − 1)/0.2) · 15` → IV/HV = 1.2 → +15; 1.0 → 0; 0.8 → −15.
- Si no, con `ivRank` ∈ [0, 100] (≤ 1 se lee como fracción): `clamp((rank − 50)/30) · 15`. (El servicio no envía IV Rank: no hay histórico de IV.)
- Sin datos: sin ajuste y motivo. Razón: IV alta respecto a la volatilidad realizada favorece vender prima.
- Limitaciones: IV promedio de contratos ±5 % del dinero de todos los vencimientos guardados vs HV de 20 días (horizontes distintos);
  la prima de riesgo de varianza hace que IV/HV ≈ 1.1–1.2 sea normal, por lo que el centro en 1.0 favorece levemente al Iron Condor.

Sin cores con resultado o con Σe = 0: `puntaje 50`, `confianza 0`, `sesgoCombinado null` (el servicio guarda sin puntaje; la selección usa 0).
Salida: `{ puntaje, confianza, cobertura, sesgoCombinado, dispersion, acuerdo, metricas[sesgo_combinado, dispersion_cores, acuerdo_cores,
neutralidad_media, confianza, cobertura, ajuste_volatilidad?], motivos, ponderacionesEfectivas }`. El modelo Confluencia guarda
`puntaje`, `cobertura`, `motivos`, `ponderaciones`; la dispersión queda en los motivos.

**Constantes:** AJUSTE_IV_MAX 15, SENSIBILIDAD_IV_HV 0.2, IV_RANK_CENTRO 50, IV_RANK_ESCALA 30 (heurísticas ADR-002),
UMBRAL_DIRECCION 0.1 y UMBRAL_CONTRADICCION 0.35 (solo texto de motivos).

**Mapeo a estrategia (selección):** la selección ejecuta cada core seleccionado, calcula la confluencia para cada estrategia candidata
y ordena por `puntaje` descendente (desempate por `cobertura`).

---

## 8. Black-Scholes (`blackscholes.js`, `blackscholes@1.0.0`)
Exporta `VERSION, TASA_LIBRE_RIESGO, DIAS_ANIO, IV_MIN, IV_MAX, IV_TOLERANCIA, IV_ITERACIONES, pdf, cdf, d1d2, opcion, precio, probabilidadSobre, volatilidadImplicita`.

- `d1 = [ln(S/K) + (r − q + σ²/2)T]/(σ√T)`, `d2 = d1 − σ√T`. Requiere S, K, T, σ > 0.
- `N(x)`: Abramowitz & Stegun 26.2.17: `t = 1/(1 + 0.2316419|x|)`, `1 − N(|x|) = φ(|x|)·t·(0.319381530 + t(−0.356563782 + t(1.781477937 + t(−1.821255978 + 1.330274429t))))`; error < 7.5·10⁻⁸.
- Call `S e^(−qT) N(d1) − K e^(−rT) N(d2)`; put `K e^(−rT) N(−d2) − S e^(−qT) N(−d1)`.
- Delta call `e^(−qT)N(d1)`, put `e^(−qT)(N(d1) − 1)`; gamma `e^(−qT)φ(d1)/(Sσ√T)`;
  theta **por día** = θ_anual/365, θ_anual call = `−Sφ(d1)σe^(−qT)/(2√T) − rKe^(−rT)N(d2) + qSe^(−qT)N(d1)` (put análogo);
  vega **por punto de volatilidad** = `S e^(−qT) φ(d1) √T / 100`; rho por punto porcentual de tasa.
- `probabilidadITM` = N(d2) (call) / N(−d2) (put), **neutral al riesgo**; `probabilidadSobre(S, X, T, r, σ) = N(d2(K = X))` = P[S_T > X].
- `volatilidadImplicita`: bisección en [0.0001, 5] hasta |precio − objetivo| < 1e-6 (máx. 200 iteraciones); null fuera de límites sin arbitraje.
- Constantes: TASA_LIBRE_RIESGO 0.04 (≈ letras del Tesoro a 3 meses 2025–2026; fija, el llamador puede pasar otra), q = 0, DIAS_ANIO 365.
- Verificado (pruebas): S = K = 100, T = 1, r = 5 %, σ = 20 % → call 10.4506, put 5.5735, delta call 0.6368, N(d2) 0.5596, gamma 0.018762, vega 0.3752/punto.
- Limitación: opciones americanas valoradas como europeas (exacto para calls sin dividendos; aproximado para puts).

---

## 9. Estrategias (`estrategias.core.js`, `estrategias@1.1.0`)
Exporta `VERSION, ESTRATEGIAS, HORA_VENCIMIENTO_UTC, payoff, validar, anosHastaVencimiento, evaluarConfiguracion, evaluar`.

Entrada: `{ estrategia, componentes:[{tipo, accion, strike, cantidad, vencimiento, precio?, volatilidadImplicita?, griegas?{delta}}],
precioSubyacente?, multiplicador = 100, fechaReferencia?, tasaLibreRiesgo = 0.04 }`. En la app: `precio` = (bid + ask)/2 del último
snapshot (o `ultimo`), IV y griegas del snapshot de Alpaca (indicativo), `precioSubyacente` = último cierre, `fechaReferencia` = ahora.

**Validación:** LONG_CALL = 1 call comprado; LONG_PUT = 1 put comprado; IRON_CONDOR = 4 patas, mismo vencimiento, cantidades iguales,
put comprado K1 < put vendido K2 < call vendido K3 < call comprado K4. Strike > 0, cantidad entera > 0, precio ≥ 0.

**Payoff al vencimiento:** `Σ signo·(intrínseco(S_T) − precio)·cantidad·multiplicador`, signo +1 compra / −1 venta;
intrínseco call `max(0, S_T − K)`, put `max(0, K − S_T)`.

| Métrica | LONG_CALL | LONG_PUT | IRON_CONDOR |
|---|---|---|---|
| prima_neta (USD; > 0 crédito) | `−P·q·m` | `−P·q·m` | `Σ −signo·P·q·m` |
| perdida_maxima (USD, positiva) | `P·q·m` | `P·q·m` | `max(0, ancho − crédito)·q·m`, ancho = `max(K2 − K1, K4 − K3)` |
| ganancia_maxima | null (ilimitada) | `max(0, K − P)·q·m` | `crédito·q·m` |
| breakeven(s) (precio) | `K + P` | `K − P` | `K2 − crédito`, `K3 + crédito` |
| resultado_vencimiento_precio_actual | payoff(S actual) | ídem | ídem |
| delta_neta (acciones) | `Σ signo·Δ_Alpaca·q·m` si todas las patas traen delta | ídem | ídem |

**Black-Scholes** (requiere precioSubyacente > 0, `fechaReferencia` y vencimiento futuro; T = (vencimiento a las 20:00 UTC − referencia)/365 días):
- `anos_al_vencimiento` (T).
- Si todas las patas traen IV: `delta_neta_bs = Σ signo·Δ_BS·q·m`; con precios, `prima_neta_teorica_bs = Σ −signo·Precio_BS·q·m`.
- `diferencia_delta_max = máx |Δ_BS(IV de la pata) − Δ_Alpaca|` (verificación independiente de la delta indicativa).
- `diferencia_iv_max = máx |IV recalculada desde la prima media − IV_Alpaca|`.
- `probabilidad_ganancia` (P[ganancia al vencimiento], lognormal neutral al riesgo):
  LONG_CALL `P[S_T > K + P]`; LONG_PUT `1 − P[S_T > K − P]`;
  IRON_CONDOR `P[S_T > K2 − crédito; σ del put vendido] − P[S_T > K3 + crédito; σ del call vendido]`, acotado a [0, 1]; crédito ≤ 0 → 0.
- Constante HORA_VENCIMIENTO_UTC 20 (16:00 ET en horario de verano; 1 h de error en invierno es despreciable).

---

## 10. Constantes variables por el usuario
| Dónde | Parámetro | Por defecto | Efecto |
|---|---|---|---|
| Perfil / ejecución | `parametros.indicadores` | todas | Señales que entran en cada core (ADR-010) |
| Perfil / ejecución | `parametros.vidaMediaDias` | 3 | Decaimiento de noticias |
| Perfil / ejecución | `parametros.ventanaDias` | 30 | Antigüedad máxima de noticias |
| Perfil / ejecución | `parametros.intervalo` | `1Day` | Intervalo de velas leído por el servicio (todas las ventanas asumen velas diarias) |
| Perfil | `reglas[]` | — | Ajustes ± peso o neutralización (§1.4) |
| Confluencia / selección | `ponderaciones[{core, peso}]` | 1 | w_i en la confluencia |
| Core estrategias (API pura) | `tasaLibreRiesgo` | 0.04 | No expuesto en la API REST |
Todas las demás constantes son fijas en el código.

---

## 11. Ejemplos numéricos reales (ejecutados con `node` sobre `dist/`)

### 11.1 Core técnico
Serie sintética de las pruebas: 260 velas diarias hasta 2026-11-15, `cierre_i = 100 + 0.5·i + 0.8·sin(i)`, máximo = cierre + 1,
mínimo = cierre − 1, volumen = 1000 + (i mod 5)·100. Últimos cierres: 228.0413, 229.3037, 230.2869 (volumen 1400).

| Señal | Métrica cruda | Mapeo | Valor | pesoBase |
|---|---|---|---|---|
| precio_vs_sma50 | 6.0028 % | tanh(6.0028/5) | 0.8338 | 1 |
| precio_vs_sma200 | 28.1171 % | tanh(28.1171/10) | 0.9928 | 1.5 |
| cruce_sma50_200 | diferencia 20.862 % | clamp(20.862/5) | 1.0000 | 1 |
| pendiente_20 | 0.2202 %/vela | tanh(0.2202/0.5) | 0.4140 | 1 |
| posicion_rango_52s | 0.9922 | 2·(0.9922 − 0.5) | 0.9844 | 0.75 |
| volumen_relativo_20 | 1.1667 | +1·clamp(0.1667, 0, 1) | 0.1667 | 0.5 |

- Σp = 5.75; Σp·v = 0.8338 + 1.4892 + 1 + 0.4140 + 0.7383 + 0.0834 = 4.5587 → **sesgo = 0.7928**.
- consistencia = 1 (todas positivas); intensidad = 0.7928; cobertura = 1 → **confianza = 0.5·1 + 0.5·0.7928 = 0.8964**.
- **puntaje = 50 + 50·0.7928 = 89.64**. Motivos: "Precio sobre SMA50 (6.00%).", "SMA50 sobre SMA200 (20.86%)."

### 11.2 Confluencia con 3 cores
- técnico (11.1): s = 0.7928, c = 0.8964.
- indicadores sobre 100 velas bajistas (`cierre = 200 − 0.4·i + 0.8·sin(i)`): s = −0.4796, c = 0.7398.
- noticias con 3 titulares: "Company beats estimates, shares rise" (hace 1 día: beat 1.5 + rise 1 → p = +1, f = 1),
  "Analyst warns of slowing demand" (hace 2 días: warns −1, slowing −1 → p = −1, f = 1), "Company to host investor day"
  (sin términos). Pesos 0.5^(1/3) = 0.7937 y 0.5^(2/3) = 0.6300 → s = (0.7937 − 0.6300)/1.4237 = **0.115**;
  consistencia 0.115; confianza = (1 − e^(−1.4237/2))·0.115 = **0.0586**; cobertura 2/3.

Todos con peso 1: e = 0.8964, 0.7398, 0.0586 (Σe = 1.6948; ponderaciones efectivas 0.5289 / 0.4365 / 0.0346).
- s̄ = (0.8964·0.7928 − 0.7398·0.4796 + 0.0586·0.115)/1.6948 = **0.2139** (alcista)
- D = √(Σe(s − s̄)²/Σe) = **0.6225** → A = **0.3775**; neutralidad media = **0.3674**
- confianza = ((0.8964 + 0.7398 + 0.0586)/3)·1·0.3775 = **0.2133**
- **LONG_CALL = 50 + 50·0.2139·0.3775 = 54.04**; **LONG_PUT = 45.96**
- **IRON_CONDOR** con IV 0.33 y HV20 0.30: 100·0.3674 + clamp(0.1/0.2)·15 = 36.74 + 7.5 = **44.24**
- Motivo: "Los cores se contradicen (dispersión 0.62): la señal direccional se reduce un 62 % y la confianza también."
  Con la fórmula 1.0.0 el resultado habría sido LONG_CALL 60.7 e IRON_CONDOR 86.1.

---

## 12. Limitaciones conocidas
- `pesoBase`, escalas de tanh y umbrales son **heurísticas de experto**, no se ajustaron estadísticamente con datos históricos.
- Velas IEX (Alpaca gratis): volumen de un solo mercado (~2–3 % del consolidado); el volumen relativo es indicativo. Si la última vela es la sesión en curso, es parcial.
- Precios ajustados solo por split; HV y retornos no incluyen dividendos.
- Fundamentales: `deuda_capital` usa pasivos totales (no deuda financiera); el Q4 fiscal no se reporta como trimestre en XBRL (solo el anual).
- 13F: solo 9 filers grandes; coincidencia por nombre de emisor; reporta con hasta 45 días de retraso; no distingue salida real de presentación pendiente.
- Noticias: léxico de palabras sueltas (sin frases ni sarcasmo), solo inglés/español; la sincronización trae 14 días aunque la ventana sea 30.
- Opciones: feed indicativo (no OPRA); IV Rank no disponible (no hay histórico de IV); Black-Scholes europeo con r fija y q = 0.
- `probabilidad_ganancia` es neutral al riesgo (deriva r), no una probabilidad del mundo real.
- La dispersión de la confluencia trata igual a todos los cores; un core con baja confianza influye poco en D (está ponderado por e).
