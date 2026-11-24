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
