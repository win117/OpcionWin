# Registro de decisiones técnicas (ADR)

Cada decisión: contexto, decisión, alternativas, consecuencias y estado.
Estados: **Propuesta** (en debate) · **Aceptada** · **Reemplazada por ADR-n**.
Para debatir una decisión: cambiar su estado a Propuesta, anotar el argumento en "Debate" y fecharlo.

| # | Decisión | Estado |
|---|---|---|
| 001 | Cores como funciones puras sobre datos almacenados | Aceptada |
| 002 | Puntaje de core = índice direccional; compatibilidad en confluencia | Aceptada |
| 003 | Trabajos asíncronos en proceso con estado en la base (202 + sondeo) | Aceptada |
| 004 | Alpaca como proveedor principal; SEC EDGAR para fundamentales y 13F | Aceptada |
| 005 | Órdenes solo en Alpaca paper; live bloqueado en código | Aceptada |
| 006 | Credenciales de broker por referencia `env:ALPACA` | Aceptada |
| 007 | Frontend React + Vite servido por Express | Aceptada |
| 008 | Respaldos: zip local + rama git local por etapa | Aceptada |
| 009 | Desarrollo multiagente por carpetas con contratos fijos | Aceptada |

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

## ADR-003 · Trabajos asíncronos en proceso
**Contexto.** Sincronizar y evaluar puede tardar segundos. El inventario A define 202 + consulta.
**Decisión.** POST guarda el registro `pendiente`, responde 202 y ejecuta en el mismo proceso (cola en memoria, concurrencia 2). Estados en la base: pendiente → procesando → completada/fallida. Al reiniciar, los trabajos `procesando` antiguos se marcan `fallida` al consultarse (>15 min).
**Alternativas.** Cola externa (BullMQ/Redis) — correcta para microservicios del tema 3, pero agrega infraestructura.
**Consecuencias.** Una sola instancia. Migrable a cola externa sin cambiar el contrato HTTP.

## ADR-004 · Proveedores
**Decisión.** Alpaca Market Data (velas, cotizaciones, cadena de opciones con griegas feed `indicative`, noticias) y Trading paper. SEC EDGAR (`companyfacts`, `company_tickers`, 13F-HR de una lista configurable de instituciones). Webull queda como adaptador pendiente (sin API pública estable de opciones para este alcance).
**Consecuencias.** Feed IEX gratuito es parcial (no consolidado). Las griegas de Alpaca son indicativas. Se etiquetan `fuente.feed`. 13F tiene retraso de hasta 45 días tras el trimestre: no es flujo en tiempo real.

## ADR-005 · Órdenes solo paper
**Decisión.** El cliente de trading usa URL fija de paper. Conexiones con `entorno: live` se rechazan al enviar. Envío exige `Idempotency-Key` → `client_order_id`.
**Consecuencias.** Seguridad ante uso académico. Habilitar live requerirá nueva ADR, confirmación explícita por orden y pruebas.

## ADR-006 · Credenciales por referencia
**Decisión.** `ConexionBroker.credencialRef` acepta `env:ALPACA` (usa ALPACA_KEY_ID/SECRET del servidor). No se guardan claves en la base. Nunca se devuelven al cliente.
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
