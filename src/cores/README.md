# Análisis propios (cores)

Funciones puras y síncronas (ADR-001). Contrato en `docs/version-funcional/contratos.md` §1–3.
Cada core exporta `VERSION`, `REQUIERE` y `evaluar(input)`. Sin red, base de datos, `Date.now()` ni azar:
"hoy" es `input.fechaReferencia` y se descartan datos posteriores a esa fecha (velas, periodos, reportes no publicados, noticias).
Un core desactivado no es una evaluación negativa. Las familias de señales no se solapan (técnico = tendencia; indicadores = osciladores/volatilidad).
**Inventario técnico exacto** (fórmulas, constantes, fuentes, ejemplos numéricos): `docs/version-funcional/cores-inventario.md`.
Todas las constantes están con nombre al inicio de cada archivo con su justificación. Los `pesoBase` son heurísticas de experto, no un ajuste estadístico.

## Esquema común
- Cada core calcula sub-señales en −1..1 con un peso. `sesgo` = promedio ponderado de las calculables;
  `cobertura` = sub-señales calculadas / total; `confianza` = cobertura × (0.5·consistencia + 0.5·intensidad),
  donde consistencia = |Σw·s| / Σw·|s| e intensidad = Σw·|s| / Σw (`util.combinar`).
- Datos insuficientes: la sub-señal no se calcula, baja la cobertura y se agrega a `datosFaltantes` (p. ej. `velas<200`). Sin ninguna sub-señal → `sesgo` y `puntaje` null.
- Métricas: valores finitos redondeados a 4 decimales. Siempre incluye `confianza` y `cobertura`; `sesgo` cuando no es null.
- `puntaje = round(50 + 50·sesgo, 2)` después de reglas.

## Reglas (`reglas.js`, `reglas@1.0.0`)
Solo reglas `activo !== false` (y del core si traen `core`). Operadores eq, ne, gt, gte, lt, lte, between (tolerancia 1e-9).
- No obligatoria cumplida: +peso puntos en la dirección del sesgo; incumplida: −peso. Acotado 0..100. Con sesgo 0 no hay ajuste.
- Obligatoria incumplida: puntaje 50, confianza 0, motivo explícito.
- Métrica inexistente: `cumplida: null` y `metrica:<criterio>` en datosFaltantes.
- El sesgo final se recalcula como (puntaje − 50)/50 para mantener la relación del contrato.

## tecnico@1.1.0 — tendencia y estructura (`velas`)
| Sub-señal | Cálculo | Señal | Peso | Mínimo |
|---|---|---|---|---|
| precio_vs_sma50 | (cierre/SMA50 − 1)·100 | tanh(%/5) | 1 | 50 velas |
| precio_vs_sma200 | (cierre/SMA200 − 1)·100 | tanh(%/10) | 1.5 | 200 |
| cruce_sma50_200 | estado ±1 y `diferencia_sma50_200` % | estado·min(1, |dif|/5) | 1 | 200 |
| pendiente_20 | pendiente de regresión de 20 cierres, % del precio medio por vela | tanh(%/0.5) | 1 | 20 |
| posicion_rango_52s | (cierre − mín)/(máx − mín) con máximos/mínimos de hasta 252 velas; también distancia_maximo_pct / distancia_minimo_pct | 2·(pos − 0.5) | 0.75 | 60 (con <252 se avisa `velas<252`) |
| volumen_relativo_20 | volumen último / promedio 20 previos | signo(última vela)·clamp(vr − 1, 0, 1) | 0.5 | 21 |
Motivos: cruce dorado/de la muerte en las últimas 20 velas.

## indicadores@1.1.0 — momentum y volatilidad (`velas`, `opciones?`)
| Sub-señal | Señal | Peso | Mínimo |
|---|---|---|---|
| rsi_14 (Wilder) | 30..70 lineal a ±1; fuera de rango se atenúa hacia 0 (no se invierte) | 1 | 15 |
| macd_hist (12/26/9) | tanh((hist/cierre·100)/0.5) | 1 | 34 |
| estocastico_k (14/3, también estocastico_d) | 20..80 lineal; atenuado en extremos | 0.75 | 16 |
| bollinger_pctb (20, 2σ) | clamp(2·(%B − 0.5)) | 0.75 | 20 |
| atr_pct, hv_20, hv_60 | no direccionales: cuentan en cobertura | — | 15 / 21 / 61 |
| iv_promedio, iv_hv_ratio | promedio de `volatilidadImplicita` de las opciones / HV20 (cuentan en cobertura solo si hay opciones) | — | — |
HV = desviación muestral de retornos logarítmicos × √252 (fracción anual). HV20 > 1.5·HV60 → confianza × 0.8.
IV: solo contratos no vencidos a la fecha de referencia y con 0 < IV ≤ 5 (1.1.0).

## fundamental@1.1.0 (`fundamentales`)
Sin anticipación: si un periodo trae `fechaPresentacion` (fecha de presentación a la SEC) solo cuenta cuando es ≤ fechaReferencia; si no, se usa `periodoFin`.
Clasificación por duración `periodoFin − periodoInicio`: 330–400 días = anual, 80–100 = trimestral (`forma` 10-K/10-Q solo si faltan fechas).
Periodo base = el periodo de flujo más reciente con ingresos; comparable = mismo tipo con cierre a 365 ± 25 días antes
(anual vs anual, o trimestre vs mismo trimestre del año previo). Nunca se mezclan duraciones.
Saldos (pasivos, capital, circulantes) se toman del periodo más reciente que tenga ambos valores.
| Métrica | Señal | Peso |
|---|---|---|
| crecimiento_ingresos_yoy % | tanh(g/10) | 1.5 |
| crecimiento_utilidad_yoy % ((U0 − U1)/|U1|) | tanh(g/20) | 1 |
| margen_neto % | tanh(m/10) | 1 |
| deuda_capital (pasivos totales / capital) | clamp(1.5 − d); capital ≤ 0 → −1 | 1 |
| razon_corriente | clamp(rc − 1) | 0.75 |
| margen_flujo_operativo % | tanh(m/15) | 1 |
`eps_diluido` se reporta como métrica sin señal.

## institucional@1.1.0 (`reportes` 13F)
Solo reportes publicados a la fecha de referencia (`fechaPublicacion`, si no `fechaCorte`). Reportes con igual corte se combinan;
acciones se agregan por `identificadorInstitucion`. Se comparan los dos cortes más recientes (mínimo 2, si no `reportes<2`).
**Panel balanceado (1.1.0):** cambio y amplitud usan solo instituciones presentes en ambos cortes (una ausente puede no haber presentado aún).
Split: si la mediana de acciones_nuevas/previas (≥ 3 instituciones) está a ±5 % de 2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40 o 50 (o su inverso), se ajusta el corte previo.
- cambio_acciones_pct = (Σ acciones comunes nuevas / Σ previas ajustadas − 1)·100 → tanh(%/10), peso 1.5.
- amplitud = (aumentan − disminuyen)/comunes, peso 1. Métricas: instituciones_aumentan/disminuyen/nuevas/salen/comunes/reportadas, amplitud_instituciones, factor_split, dias_desde_corte.
- Corte con más de 135 días → confianza × 0.5. Motivo fijo sobre el retraso de hasta 45 días del 13F. Solo cubre las instituciones sincronizadas.

## noticias@1.1.0 (`noticias`)
Léxico propio en `lexico.js` (`lexico@1.1.0`, inglés financiero + español, −2..+2, sin acentos). Negadores (not, no, never, fails, unable, sin, nunca, …)
invierten los términos de las 3 palabras siguientes; intensificadores (sharply, massive…) ×1.5 y atenuadores (slightly…) ×0.5 al siguiente término (ventana 2).
Por noticia (título + resumen): pos = Σ aportes positivos, neg = Σ |negativos|; polaridad p = (pos − neg)/(pos + neg); fuerza f = min(1, (pos + neg)/2).
Solo noticias con términos: peso = 0.5^(edad/vidaMedia)·f con `parametros.vidaMediaDias` (3) y ventana `parametros.ventanaDias` (30).
sesgo = Σpeso·p/Σpeso; confianza = (1 − e^(−Σpeso/2)) × consistencia; cobertura = noticias con términos / analizadas.
Se descartan noticias futuras, sin fecha y titulares duplicados. Sin fecha de referencia: peso uniforme y `fechaReferencia` en datosFaltantes.

## confluencia@1.1.0 (ADR-012)
e = peso·confianza; s̄ = Σe·s/Σe; dispersión D = √(Σe(s − s̄)²/Σe); acuerdo A = 1 − D (un core: A = 1).
LONG_CALL 50 + 50·s̄·A; LONG_PUT 50 − 50·s̄·A; IRON_CONDOR 100·Σe(1 − |s|)/Σe + ajuste = clamp((IV/HV20 − 1)/0.2)·15
(o con IV Rank: clamp((rank − 50)/30)·15). Cobertura = cores con resultado / seleccionados. confianza = (Σpeso·conf/Σpeso)·cobertura·A.
Devuelve además `dispersion`, `acuerdo` y `metricas` (sesgo_combinado, dispersion_cores, acuerdo_cores, neutralidad_media, confianza, cobertura, ajuste_volatilidad).
Sin cores con resultado o con confianza total 0 → puntaje 50, sesgoCombinado null. `ponderacionesEfectivas` normalizadas (suman 1).

## blackscholes@1.0.0
Funciones puras: `cdf` (Abramowitz-Stegun 26.2.17, error < 7.5e-8), `pdf`, `d1d2`, `opcion` (precio, delta, gamma, theta por día,
vega por punto de vol, rho por punto de tasa, probabilidadITM = N(d2)), `probabilidadSobre` (P[S_T > X]), `volatilidadImplicita` (bisección).
Tasa por defecto `TASA_LIBRE_RIESGO` = 0.04, q = 0, T en días naturales/365.

## estrategias@1.1.0 — `evaluarConfiguracion` (alias `evaluar`), `validar`, `payoff`
Valida LONG_CALL (1 call buy), LONG_PUT (1 put buy) e IRON_CONDOR (4 patas, mismo vencimiento, cantidades iguales,
put buy K1 < put sell K2 < call sell K3 < call buy K4). `precio` = prima por acción; montos × cantidad × multiplicador (100).
prima_neta > 0 crédito, < 0 débito. perdida_maxima en monto positivo. LONG_CALL ganancia_maxima = null (ilimitada);
LONG_PUT ganancia = (K − prima)·q·m; breakeven K ± prima. IRON_CONDOR: ganancia = crédito, pérdida = (ancho máximo − crédito),
breakeven_inferior K2 − crédito, breakeven_superior K3 + crédito. Opcionales: delta_neta (si todas las patas traen delta),
resultado_vencimiento_precio_actual (si hay precioSubyacente). Sin precios: solo validación.
Con `fechaReferencia`, precioSubyacente e IV por pata (Black-Scholes): anos_al_vencimiento, probabilidad_ganancia (neutral al riesgo,
lognormal; Iron Condor usa la IV de cada pata vendida en su breakeven), delta_neta_bs, prima_neta_teorica_bs, diferencia_delta_max
(|Δ_BS − Δ Alpaca|) y diferencia_iv_max (|IV desde la prima media − IV Alpaca|). Vencimiento a las 20:00 UTC.
