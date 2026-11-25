# Registro de decisiones técnicas (ADR)

Cada decisión: contexto, decisión, alternativas, consecuencias y estado.
Estados: **Propuesta** (en debate) · **Aceptada** · **Reemplazada por ADR-n**.
Para debatir una decisión: cambiar su estado a Propuesta, anotar el argumento en "Debate" y fecharlo.

| # | Decisión | Estado |
|---|---|---|
| 001 | Cores como funciones puras sobre datos almacenados | Aceptada |
| 002 | Puntaje de core = índice direccional; compatibilidad en confluencia | Aceptada (fórmulas de confluencia reemplazadas por ADR-012) |
| 003 | Trabajos asíncronos en proceso con estado en la base (202 + sondeo) | Aceptada |
| 004 | Alpaca como proveedor principal; SEC EDGAR para fundamentales y 13F | Aceptada |
| 005 | Órdenes solo en Alpaca paper; live bloqueado en código | Aceptada |
| 006 | Credenciales de broker por referencia `env:ALPACA` | Aceptada |
| 007 | Frontend React + Vite servido por Express | Aceptada |
| 008 | Respaldos: zip local + rama git local por etapa | Aceptada |
| 009 | Desarrollo multiagente por carpetas con contratos fijos | Aceptada |
| 010 | Selección de señales por core y pesos en selección | Aceptada |
| 011 | Ticket de órdenes en un paso y cierre de posiciones (paper) | Aceptada |
| 012 | Desacuerdo entre cores en la confluencia (dispersión y neutralidad media) | Aceptada |

---

## ADR-001 · Cores como funciones puras
**Contexto.** Los cinco cores deben ser trazables (versión, fuentes, reglas) y probables sin red.
**Decisión.** Cada core es `evaluar(input) → resultado` sin I/O. Un servicio orquestador carga datos de la base, llama al core y guarda la Evaluación. Los datos llegan por sincronización desde proveedores.
**Alternativas.** Que cada core consulte al proveedor directamente (acopla red y algoritmo, no reproducible).
**Consecuencias.** Una evaluación es reproducible con los mismos datos. Requiere sincronizar antes de evaluar; el orquestador reporta `datosFaltantes` si no hay datos.

## ADR-002 · Puntaje direccional
**Contexto.** El modelo Evaluacion tiene un solo `puntaje` por core y empresa, pero tres estrategias con objetivos opuestos (alcista, bajista, neutral).
**Decisión.** El core produce `sesgo` −1..1 y `puntaje = 50+50·sesgo`. La confluencia transforma a compatibilidad por estrategia (ver contratos §2). `sesgo` y `confianza` se guardan como métricas.
**Alternativas.** Un puntaje por estrategia dentro de cada core (triplica lógica y duplica criterios).
**Debate abierto.** Ajuste de IV para Iron Condor (±15) es heurístico; calibrar con datos.
**Reemplazo parcial (2026-11-17).** Las fórmulas de compatibilidad por estrategia (`50 ± 50·s`, `100·(1 − |s|)`) quedan reemplazadas por ADR-012. Se mantiene el resto (sesgo/puntaje del core, sesgo y confianza como métricas).

## ADR-003 · Trabajos asíncronos en proceso
**Contexto.** Sincronizar y evaluar puede tardar segundos. El inventario A define 202 + consulta.
**Decisión.** POST guarda el registro `pendiente`, responde 202 y ejecuta en el mismo proceso (cola en memoria, concurrencia 2). Estados en la base: pendiente → procesando → completada/fallida. Al reiniciar, los trabajos `procesando` antiguos se marcan `fallida` al consultarse (>15 min). **Implementado** (`trabajos-huerfanos.service.js`: CRUD get/list; no aplica a trabajos activos en la cola del proceso).
**Alternativas.** Cola externa (BullMQ/Redis) — correcta para microservicios del tema 3, pero agrega infraestructura.
**Consecuencias.** Una sola instancia. Migrable a cola externa sin cambiar el contrato HTTP.

## ADR-004 · Proveedores
**Decisión.** Alpaca Market Data (velas, cotizaciones, cadena de opciones con griegas feed `indicative`, noticias) y Trading paper. SEC EDGAR (`companyfacts`, `company_tickers`, 13F-HR de una lista configurable de instituciones). Webull OpenAPI (implementado 2026-11-19): adaptador de trading de opciones contra el entorno de pruebas `api.sandbox.webull.com` (firma HMAC-SHA1, `src/integrations/webull.client.js`); el usuario elige el broker (Alpaca o Webull) por conexión. Los datos de mercado siguen viniendo de Alpaca; los contratos se sincronizan desde Alpaca y su símbolo OCC se convierte al formato de patas de Webull.
**Consecuencias.** Feed IEX gratuito es parcial (no consolidado). Las griegas de Alpaca son indicativas. Se etiquetan `fuente.feed`. 13F tiene retraso de hasta 45 días tras el trimestre: no es flujo en tiempo real.

## ADR-005 · Órdenes solo paper
**Decisión.** El cliente de trading usa URL fija de paper. Conexiones con `entorno: live` se rechazan al enviar. Envío exige `Idempotency-Key` → `client_order_id`.
**Consecuencias.** Seguridad ante uso académico. Habilitar live requerirá nueva ADR, confirmación explícita por orden y pruebas.

## ADR-006 · Credenciales por referencia
**Decisión.** `ConexionBroker.credencialRef` acepta `env:ALPACA` (ALPACA_KEY_ID/SECRET del servidor) o `env:WEBULL` (WEBULL_APP_KEY/APP_SECRET/ACCOUNT_ID). No se guardan claves en la base. Nunca se devuelven al cliente.
**Alternativas.** Cifrado de claves por usuario en base (pendiente si hay múltiples usuarios con cuentas distintas).

## ADR-007 · Frontend
**Decisión.** React + Vite en `web/`. Desarrollo con proxy a la API; producción: `web/dist` servido por Express en `/`. Gráficos de velas con `lightweight-charts`. El token se guarda en `sessionStorage` (se pierde al cerrar la pestaña).
**Consecuencias.** Mismo origen en producción → CORS no requerido. sessionStorage es vulnerable a XSS: React escapa por defecto; no usar `dangerouslySetInnerHTML`.

## ADR-008 · Respaldos
**Decisión.** Antes de cada etapa: `scripts/backup.ps1 -Etiqueta <nn-nombre>` (zip privado con .env en `backups/`) y commit local en rama `version-funcional`. No se hace push sin autorización.

## ADR-009 · Multiagente
**Decisión.** Tres agentes en paralelo con carpetas exclusivas: cores (`src/cores`, `tests/cores*`), integraciones (`src/integrations`, `tests/integrations*`), frontend (`web/`). El agente principal integra servicios/rutas y es el único que edita `package.json` raíz y `src/api`. Contratos fijos en `docs/version-funcional/contratos.md`.
**Por qué.** Las tres áreas son independientes dado el contrato; paralelizar reduce tiempo y cada agente carga solo su contexto (menos tokens que un solo hilo largo).

## ADR-010 · Selección de señales por core y pesos en selección
**Estado.** Aceptada.
**Contexto.** El usuario quería elegir qué señales de cada core cuentan y dar más peso a unos cores en la selección. `parametrosSchema.indicadores` ya existía sin efecto.
**Decisión.** Cada core exporta `SENALES` (nombre, etiqueta, descripción, peso base) y filtra con `filtrarSenales` (util): si la lista trae al menos una señal del core, solo esas entran en `combinar` (cobertura y confianza reflejan menos señales); si trae ninguna o está vacía, se usan todas (compatible hacia atrás). `GET /cores/catalogo` publica el catálogo. `POST /selecciones/ejecuciones` acepta `ponderaciones [{core, peso>=0}]` con el mismo subesquema que Confluencia. Versiones de los cores suben a 1.0.1.
**Alternativas.** Pesos por señal editables por el usuario (más flexible, pero rompe la trazabilidad de `pesoBase` y complica la UI); un campo nuevo en lugar de reutilizar `indicadores` (más claro, pero duplica el esquema).
**Debate abierto.** Reutilizar `indicadores` para señales de todos los cores mezcla nombres en una sola lista; se tolera porque los nombres son únicos entre cores. Queda pendiente decidir si los pesos por señal serán editables.
**Consecuencias.** Elegir una sola señal puede subir la cobertura aparente; el motivo deja constancia de la selección.

## ADR-011 · Ticket de órdenes en un paso y cierre de posiciones (paper)
**Estado.** Aceptada.
**Contexto.** Enviar una orden exigía crear a mano broker, conexión, configuración y orden, y luego llamar al envío. La interfaz necesita un ticket de un paso, un resumen en vivo y poder cerrar posiciones.
**Decisión.** `POST /broker/paper/conexion` asegura (idempotente) broker `alpaca` y conexión paper `env:ALPACA`; `GET /broker/paper/resumen` une posiciones vivas de Alpaca con contratos/posiciones guardados; `POST /ordenes/ticket` valida (contratos de la empresa, proveedor alpaca, no vencidos, 1–4 patas), crea una Configuracion `validada` y una Orden `pendiente` con `idempotencyKey` y la envía con `createBroker.enviar` (`client_order_id` = key); `POST /posiciones/:id/cierre` genera la orden de cierre (long→sell_to_close, short→buy_to_close). Repetir la key devuelve la orden existente sin enviar de nuevo. Solo paper (ADR-005/006).
**Convención de precio.** Nuestra API: `precioLimite` siempre positivo (precio neto por unidad) y `credito: true` para crédito neto. Alpaca (referencia `POST /v2/orders`, `limit_price` de órdenes `mleg`): positivo = débito, negativo = crédito. La traducción vive solo en `construirCuerpoOrden` (`alpaca.client.js`). Verificado en paper: un iron condor con `limit_price` negativo fue aceptado (`new`) y cancelado.
**Alternativas.** Reutilizar una Configuracion existente por orden (menos registros, pero acopla tickets distintos y complica la idempotencia); aceptar `precioLimite` negativo en la API (expone la convención del proveedor).
**Debate abierto.** Se crea una Configuracion nueva por cada orden: simple y trazable, pero genera muchos registros; podría deduplicarse o archivarse. Las guías de Alpaca muestran el ejemplo del iron condor con precio positivo sin explicar el signo; se siguió la referencia de la API, que es explícita.
**Consecuencias.** `Orden.credito` (booleano) nuevo en el modelo. `normalizarPosicion` añade `plNoRealizado` y `plPctNoRealizado`. Un envío fallido deja la orden `pendiente` con evento `error_envio`; se reintenta con `POST /ordenes/:id/envio`.

## ADR-012 · Desacuerdo entre cores en la confluencia
**Estado.** Aceptada (2026-11-17). Reemplaza las fórmulas de compatibilidad de ADR-002.
**Contexto.** Con la fórmula 1.0.0 el Iron Condor usaba la neutralidad del promedio, `100·(1 − |s̄|)`. Si los cores se contradicen
(caso real NVDA: fundamental +1.0, técnico −0.6, indicadores −0.8, noticias 0) el promedio ≈ −0.1 y el Iron Condor salía ≈ 90–100,
aunque ningún core indicaba un mercado lateral. Igualmente, un Long Call/Put salía con la misma fuerza con o sin acuerdo.
**Decisión.** Por core i usado: e_i = peso_i · confianza_i (la cobertura del core ya está dentro de su confianza).
s̄ = Σe·s/Σe; dispersión D = √(Σe·(s − s̄)²/Σe) ∈ [0, 1]; acuerdo A = 1 − D (un core → A = 1).
LONG_CALL = 50 + 50·s̄·A; LONG_PUT = 50 − 50·s̄·A; IRON_CONDOR = 100·Σe·(1 − |s|)/Σe + ajuste IV/HV (±15, sin cambios:
clamp((IV/HV20 − 1)/0.2)·15, o con IV Rank clamp((rank − 50)/30)·15). confianza = (Σpeso·confianza/Σpeso)·cobertura·A.
Se informan `dispersion_cores`, `acuerdo_cores`, `neutralidad_media` (métricas del resultado) y un motivo en español
("Los cores se contradicen (dispersión 0.62): la señal direccional se reduce un 62 %…"). `confluencia@1.1.0`.
**Alternativas.** Penalizar solo la confianza (no cambia el ranking de la selección, que ordena por puntaje); usar el rango
máx − mín (sensible a un solo core extremo con poca confianza); entropía de signos (ignora magnitudes).
**Consecuencias.** Con cores unánimes los puntajes casi no cambian (A ≈ 1). Con cores contradictorios el Iron Condor baja
(NVDA: 90 → 40) y las direccionales se acercan a 50 (NVDA Long Put 55 → 51.5). La selección queda menos "segura" cuando no hay acuerdo,
que es el comportamiento buscado. El modelo Confluencia no guarda `metricas`: la dispersión queda registrada en `motivos`.
**Debate abierto.** El factor A es lineal en D; podría usarse A² para castigar más el desacuerdo. Calibrar con resultados históricos
cuando exista un registro de evaluaciones y precios posteriores. El centro del ajuste IV/HV en 1.0 ignora la prima de riesgo de
varianza (IV/HV ≈ 1.1–1.2 es habitual), lo que favorece levemente al Iron Condor.

## ADR-013 · Universo obtenido de los proveedores y calculado por el servidor
**Contexto.** El screener partía de una lista fija de símbolos, que envejeció (empresas que ya no cotizan), y cada usuario debía cargarla a mano.
**Decisión.** El universo se obtiene: activos con opciones (Alpaca) cuyo CIK presenta 10-Q (SEC), ordenados por capitalización. Se calcula una vez
por servidor, en segundo plano, y se comparte. Capitalización = acciones (XBRL frames) × precio, o valor en manos del público si falta; si ambas
cifras difieren fuera de [0.25, 25], gana la que cuadra con el dinero negociado (rotación típica 0.6 %), porque hay emisores que reportan con error de unidades.
**Consecuencias.** Entran solas las empresas nuevas y salen las que dejan de cotizar. Quedan fuera las extranjeras (20-F/40-F) y los fondos.
El sector es una agrupación del código SIC, menos fina que GICS. Con dos clases de acciones, el total se reparte por igual.
**A debate.** Pagar una fuente GICS y datos SIP en tiempo real.

## ADR-014 · (PROPUESTA, sin aplicar) Calibración de los puntajes de compatibilidad
**Contexto.** Auditoría del 2026-11-24, con números verificados ejecutando los cores:
1. Iron Condor y Long Call/Put usan escalas distintas pero se comparan: sin información, Iron Condor = 100 y Call/Put = 50. Con dos cores en sesgo 0.40,
   confianza 0.8 e IV/HV 1.2: Long Call 70 e Iron Condor 75, aunque ambos cores se leen «Alcista».
2. Una contradicción dentro de un core cuenta como mercado lateral: señales [1,−1,1,−1] pesan 20 veces más que un mercado plano de verdad.
   Una caída de 14.8 % en 20 días da al técnico un sesgo ≈ 0 y, con ese core solo, Iron Condor = 99.
3. El ajuste IV/HV premia justo el riesgo de resultados: IV 45 % frente a HV 25 % antes de un reporte suma +15 al Iron Condor.
4. Long Call/Put ignoran lo cara que está la volatilidad: IV 60 % y 30 % dan el mismo puntaje.
5. La confianza se calcula pero no llega al puntaje: un solo titular negativo da Long Put = 100.
**Propuesta.** (a) Iron Condor centrado en 50 y multiplicado por el acuerdo; IV/HV centrado en 1.15. (b) Cada core devuelve su neutralidad propia.
(c) Ajuste IV/HV ≤ 0 si hay resultados antes del vencimiento (falta una fuente de fechas). (d) Penalizar Call/Put cuando la IV es alta.
(e) Acercar el puntaje a 50 según la confianza. Se calibran juntas porque interactúan.
**Estado: NO SE APLICA (2026-11-24).** El usuario pidió aplicarla solo si la mejora es real. Se probó con datos históricos y no lo es.

**Prueba** (`scripts/backtest/datos.cjs` y `analisis.py`; reproducible: `node scripts/backtest/datos.cjs CARPETA fund` y `python scripts/backtest/analisis.py CARPETA`).
500 empresas, 105 fines de mes de 2018-01 a 2026-09, 48 715 observaciones; cada core se evaluó solo con lo conocido ese día. Resultado a 25 sesiones en
unidades de volatilidad esperada (media geométrica de HV20 y HV60): Call y Put gana si se mueve más de 0.40 σ a su favor; Iron Condor, si queda dentro de ±0.84 σ.
- Correlación entre puntaje y resultado (por fecha): Call −0.014 / +0.001, Put −0.004 / −0.007, Iron Condor +0.013 / **−0.026** (2018-22 / 2023-26).
  Con la propuesta: −0.014 / +0.001, −0.004 / −0.007, +0.018 / −0.024. Es decir, prácticamente cero en ambas.
- Ventaja de la estrategia elegida con puntaje ≥ 60: actual −0.016 / −0.036 σ; propuesta −0.026 / −0.039 σ. Ninguna es positiva.
- Agregar Fundamental no cambia la conclusión. Ningún core por separado muestra correlación distinta de cero (|t| < 1).
- La mediana histórica de la neutralidad es 0.48; el 0.60 de la propuesta era una elección sin respaldo.
**Límites de la prueba.** Solo técnico, indicadores y fundamental (no hay IV histórica; noticias y 13F no se reconstruyeron); empresas actuales (sesgo de
supervivencia); fundamentales fechados de forma conservadora; un solo horizonte. No demuestra que los cinco juntos no sirvan: demuestra que no hay evidencia
de que los probados predigan, y que la recalibración no mejora.
**Consecuencia.** El puntaje describe qué tan alineados están los factores hoy; no es una probabilidad de ganar.

## ADR-015 · El ranking y el análisis deciden con los cinco cores
**Contexto.** El Top 5 usaba solo técnico e indicadores, y Análisis omitía Institucional por defecto mostrando cobertura 100 %. La decisión debe salir del conjunto.
**Decisión.** Las ~500 empresas se evalúan con los cinco cores, sin filtro previo (un filtro por precio descartaría empresas buenas en lo demás).
Técnico e indicadores salen por lotes en segundos; noticias, fundamental e institucional se completan en segundo plano por orden de capitalización y se
guardan: noticias cada hora (6 h con el mercado cerrado), fundamental cada 3 días, institucional cada 7. Los 13F se leen en una sola pasada: 16
instituciones × 2 cortes sirven para todas las empresas. Mientras falte algo, el ranking se marca «preliminar». En Análisis, Institucional viene activo y
un factor sin datos se declara («Parcial: opinan 4 de 5»).
**Consecuencias.** El puntaje de una empresa cambia conforme llegan sus factores. La combinación usa la confluencia vigente (ADR-012) con pesos iguales:
no se recalibró (ADR-014 sigue como propuesta). El ranking usa velas SIP y Análisis IEX: puede haber diferencias pequeñas.

## ADR-016 · Tasa, dividendos, resultados e interés abierto se obtienen de su fuente
**Contexto.** El 4 % de tasa estaba escrito dos veces en el código, los cálculos suponían dividendos en cero y no se avisaba de resultados ni de contratos poco negociados.
**Decisión.** Tasa: letras del Tesoro de EE. UU. por plazo (interpolación lineal, tasa continua), 12 h en memoria. Dividendos y divisiones: Alpaca, solo los anunciados; el
rendimiento usa lo pagado en el último año. Resultados: 8-K punto 2.02 de la SEC; la próxima fecha se **estima** (mismo trimestre + 364 días) con un margen propio de cada
empresa entre 4 y 14 días. Interés abierto: el de Alpaca, guardado con el contrato. Son avisos y entradas del cálculo de probabilidad: **no cambian los puntajes**.
**Evidencia.** En 186 reportes reales de empresas grandes la estimación falló 0 días de mediana, 4 en el 80 % y 8 en el 95 %.
**Consecuencias.** Sin dato se usa 0 y se dice. Alpaca puede no conocer aún un dividendo futuro. Emisores extranjeros (20-F/6-K): sin fecha.

## ADR-017 · Una sola definición por ruta (Zod) y capas vigiladas por pruebas
**Contexto.** Las acciones se validaban a mano y OpenAPI se escribía aparte: faltaban rutas en la documentación.
**Decisión.** `api/v1/schemas` describe cada ruta que no es CRUD; de ahí salen la validación (`validar.handler.js`) y OpenAPI. `acciones.routes.js` se dividió en análisis,
integraciones y operación, con controlador. Cada módulo CRUD usa de verdad su servicio. `contrato-broker.js` fija qué debe tener un broker y el servidor no arranca si falta algo.
`tests/estructura.test.cjs` comprueba todo lo anterior. ESLint y GitHub Actions corren en cada subida y Render publica solo si pasan (`autoDeployTrigger: checksPass`).
**Consecuencias.** Los esquemas validan forma y tipos; las reglas de negocio siguen en los servicios. Se conservan los archivos por módulo que piden los incisos D a H.

## ADR-018 · Seguimiento de órdenes en vivo
**Contexto.** La página preguntaba cada 3 s durante un minuto.
**Decisión.** `GET /ordenes/:id/seguimiento` (Server-Sent Events). Con Alpaca el servidor escucha `trade_updates` por WebSocket (una conexión, abierta solo mientras alguien sigue una
orden) y consulta cada 15 s por seguridad; con Webull consulta cada 3 s. El estado que se guarda siempre sale de consultar la orden, nunca del aviso. Se usa `fetch` en
streaming y no `EventSource`, porque el token va en una cabecera. Si no hay SSE, la página vuelve a preguntar.
**Consecuencias.** Tope de 6 seguimientos por usuario y 10 minutos. Vive en la memoria del proceso.

## ADR-019 · TradingView como vista, no como fuente
**Decisión.** Se ofrece su gráfica avanzada en Análisis, a elección del usuario, en un `iframe` aislado (`frame-src`): no se carga ningún script suyo en nuestra página, donde vive el
token. Se conserva la atribución que exigen sus términos. No alimenta cálculos: es de solo visualización y con retraso (15 min).
**Consecuencias.** Al abrirla, TradingView recibe el símbolo y la IP; se avisa y solo se carga si se elige. El uso comercial requeriría licencia.

## ADR-020 · Prueba con precios reales de opciones: los puntajes no anticipan el resultado
**Contexto.** ADR-014 midió el movimiento de la acción, sin precios de opciones. Alpaca da contratos vencidos con precios desde 2024-02.
**Prueba** (`scripts/backtest/opciones.cjs`, reproducible). Las 100 mayores empresas del universo, 30 vencimientos mensuales (2024-04 a 2026-11), 2 856 casos. Entrada ~37 días antes al
último precio operado de contratos negociados ese día; salida al vencer. Cuatro cores evaluados solo con lo conocido (técnico, indicadores, fundamental, noticias) y la IV del momento.
El error se calcula entre vencimientos, porque las empresas de un mismo mes se mueven juntas.
- Long Call: siempre +15.1 % (±16.5); con puntaje ≥ 60, +14.6 % (±18.6). Correlación puntaje-resultado −0.023 (t = −0.7). Gana el 38 % de las veces.
- Long Put: siempre −19.3 % (±16.4); con puntaje ≥ 60, −45.5 % (±21.7). Correlación +0.022 (t = 0.7). Gana el 29 %.
- Iron Condor: siempre −0.9 % (±4.6) del riesgo; con puntaje ≥ 60, −3.1 % (±6.0). Correlación **−0.090 (t = −4.9)**, igual en las dos mitades (−0.090 y −0.090). Gana el 67 %.
- Elegir la mejor estrategia con puntaje ≥ 60: −0.4 % (±12.1).
**Lectura.** Ningún puntaje anticipó la ganancia. El de Iron Condor ordena ligeramente al revés: dentro de cada mes favorece empresas tranquilas, que ganan un poco más a menudo
(+0.04, t = 2.4) pero pagan menos crédito respecto al ancho (−0.118, t = −6.1), y el saldo es algo peor. La razón IV/HV no mostró relación con el resultado (−0.005).
**Límites.** Precios operados, no cotizaciones: sin spread ni comisiones (lo real sería peor). Empresas grandes de hoy (sesgo de supervivencia) en un mercado alcista, que favorece a los
calls. Sin 13F. Se mantiene hasta vencer: no mide salidas anticipadas. 18 cóndores tienen un crédito atípico; sin ellos el resultado es el mismo.
**Decisión.** No se cambian los puntajes con una sola prueba: ajustar a estos datos sería sobreajuste. Se mantiene la nota «no es la probabilidad de ganar».
**A debate.** Ordenar Iron Condor por crédito respecto al ancho y probabilidad, en vez de por neutralidad, y probarlo con datos que no se usaron para diseñarlo.
