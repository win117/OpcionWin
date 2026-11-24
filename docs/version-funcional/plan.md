# Plan — versión funcional

Base: inventario de APIs (inciso A, T2-Actividad 2) y entregas B–H (CRUD en MongoDB/Supabase ya funcionando, 39 pruebas).
Objetivo: que la plataforma **analice** (5 cores + confluencia + selección), **obtenga datos reales** (Alpaca, SEC) y **opere en paper** (Alpaca), con interfaz web.

## Etapas
| # | Etapa | Responsable | Estado |
|---|---|---|---|
| 0 | Respaldo, rama, ADRs, contratos | principal | Hecho |
| 1 | Cores puros + reglas + estrategias + confluencia, con pruebas | agente cores | Hecho (32 pruebas) |
| 2 | Adaptadores Alpaca y SEC con pruebas sin red | agente integraciones | Hecho (19 pruebas; SEC verificado en vivo) |
| 3 | Frontend React + Vite | agente frontend | Hecho (11 páginas, build OK) |
| 4 | Orquestación: cola de trabajos, sincronización, ejecución de cores, selección, confluencia | principal | Hecho (prueba E2E) |
| 5 | Órdenes paper: envío, cancelación, posiciones | principal | Hecho (verificado con Alpaca paper real) |
| 6 | Integración Express ↔ web/dist, OpenAPI actualizado | principal | Hecho |
| 7 | Verificación real con claves (usuario) y documentación final | principal + usuario | Hecho (MongoDB, Supabase y orden paper real) |

## Requisitos del usuario para verificar en vivo
1. Completar en `.env`: `SEC_USER_AGENT="AppRESTOpciones tu-correo"`, `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` (cuenta paper).
2. Crear usuario: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-user.ps1` (no existe `private/users.json` todavía).

## Flujo funcional objetivo
Login → registrar empresa (o importarla desde Alpaca) → sincronizar históricos/noticias/fundamentales/13F/opciones →
ejecutar cores → confluencia por estrategia → selección (3 modos) → configuración con contratos reales → evaluación de configuración (payoff) → orden paper → posiciones.

## Bitácora
- 2026-11-16: Etapa 0. Respaldo `backups/00-antes-version-funcional-*.zip`. Rama `version-funcional`.
  SEC_USER_AGENT queda vacío en .env: lo completa el usuario (política de privacidad impide escribir el correo desde el agente).
- 2026-11-16: Etapas 1, 2, 4 y 5. 91 pruebas aprobadas (39 previas + 32 cores + 19 integraciones + 1 flujo E2E).
  Respaldo `backups/01-backend-funcional-*.zip`.

- 2026-11-16: Etapas 3 y 6. Express sirve `web/dist` con respaldo SPA (excepto /api, /health, /assets).
  Listas CRUD ordenadas por `createdAt` descendente (antes por UUID aleatorio). Verificación de conexión devuelve objeto plano.
  Claves Alpaca del usuario devuelven 401: empiezan con `CK` (Broker API), se requieren claves Trading API paper (`PK`).
  Respaldo `backups/02-frontend-integrado-*.zip`.
- 2026-11-16: Etapa 7 (verificación real). Claves Alpaca paper (PK) OK: cuenta ACTIVE, nivel de opciones 3.
  `npm run smoke:real -- mongodb AAPL --institucional` y `-- supabase MSFT`: flujo completo con datos reales y limpieza total.
  Corregido con datos reales: insumos opcionales `'opciones?'` no se cargaban (IV ignorada); IV promedio solo ±5 % del dinero;
  escrituras en bloque `upsertMany` (velas 54 s → 3 s, contratos 242 s → 7 s); contratos ±25 % del precio y un snapshot vigente por contrato;
  Supabase 201 sin cuerpo con `return=minimal` (cortaba velas a 100); cotización IEX cruzada (ask < bid) se guarda sin bid/ask; nombre SEC para 13F.
  Respaldo `backups/03-verificacion-real-*.zip`.
- 2026-11-17: Interfaz de un clic. Página `/analizar/:simbolo` (y buscador en el Panel): sincroniza empresa → históricos, cotización,
  noticias, fundamentales, contratos (13F opcional) en paralelo → 5 cores → selección, con progreso por paso; luego muestra resumen
  guardado (precio, velas, recomendación, tarjetas por core, noticias). El core institucional se omite si no hay 13F.
  Corregido: el gráfico de Mercado mostraba las 100 velas más antiguas de 300 (`slice(0,100)` sobre serie ascendente).
  Verificado con NVDA real en ~17 s (sin 13F). Respaldo `backups/04-interfaz-analizar-*.zip`.
- 2026-11-17: Espacio maestro–detalle (2 subagentes en paralelo: backend y frontend con contratos fijados de antemano).
  Backend: `GET /activos/busqueda` (catálogo Alpaca en caché 12 h; 1.ª consulta ~11 s, luego <0.5 s), `GET /cores/catalogo` (señales por core),
  `GET /mercado/opciones/resumen/:simbolo` (cadena guardada con IV y griegas), cores 1.0.1 respetan `parametros.indicadores`,
  selección acepta `ponderaciones` (ADR-010). Frontend: buscador a la izquierda, detalle a la derecha (gráfico con SMA 20/50/200,
  opciones y griegas con sonrisa de IV, fundamentales, 13F, noticias, último análisis) y configuración de cores/pesos/señales.
  Corregido con datos reales: atributo de opciones de Alpaca es `has_options` (no `options_enabled`).
  Verificado en Supabase con NVDA (66 contratos del vencimiento más cercano, 62 con griegas). MongoDB Atlas rechazó la IP actual
  (lista de acceso de Atlas, no código). 96 pruebas. Respaldo `backups/05-maestro-detalle-*.zip`.
- 2026-11-17: Retroalimentación del usuario: la entrada debe ser **buscar**, no analizar. Inicio (`/`) = espacio Buscar y analizar;
  Panel pasa a `/panel` (Resumen) y su tarjeta solo busca (`/analizar?q=`). Clic en un resultado muestra todo a la derecha;
  si la empresa no está registrada se sincronizan sus datos automáticamente. Configuración de cores/pesos/métricas siempre visible
  con botón Analizar al final. Gráfico: rangos 1M…Máx, intervalos diario/semanal/mensual (agregado en cliente), velas/línea,
  SMA y volumen, botón «Cargar histórico largo (10 años)» (`desde` en la sincronización).
  Backend: velas por sincronización hasta 10 000 (antes cortaba en 1000) y serie `/mercado/historicos` hasta 10 000.
  Limitación: el feed IEX de Alpaca solo tiene velas desde 2020-07 (~6 años; MSFT 1587 sesiones).
  Respaldo `backups/06-buscar-y-graficos-*.zip`.
- 2026-11-17: Inicio con tablero (el usuario lo veía vacío). `GET /mercado/panorama?simbolos=` (por defecto SPY, QQQ, DIA, IWM;
  consulta directa a Alpaca, caché 5 min por proceso, error por símbolo sin romper la respuesta). Panel derecho sin selección:
  Mercado hoy (sparklines), Tus empresas (precio, sparkline, última recomendación, dirección por core), Explora y Actividad reciente.
  97 pruebas. Respaldo `backups/07-inicio-tablero-*.zip`.
- 2026-11-17: Orden paper real (`npm run smoke:orden -- mongodb`): conexión verificada (cuenta ACTIVE, nivel 3), orden limit
  1 × AAPL261125C00350000 a 0.01 enviada (pending_new → aceptada por sincronización), reenvío con la misma Idempotency-Key
  devuelve la misma orden, clave ajena → 409, cancelación confirmada por Alpaca (canceled), posiciones sincronizadas (0).
- 2026-11-17: Ejecución real en paper (`npm run smoke:ejecucion -- mongodb`, mercado abierto): compra market 1 × AAPL261125C00350000
  ejecutada a 6.65 (3.8 s) → posición abierta long x1 @ 6.65 → venta market sell_to_close ejecutada a 5.85 → posición cerrada.
  Resultado simulado −80 USD (spread bid/ask 5.80/6.75). Sin posición residual en Alpaca.
  Corregido: la sincronización de posiciones nunca marcaba como `cerrada` una posición que el broker ya no reporta;
  la sincronización de órdenes ahora registra el precio de ejecución en eventos. 98 pruebas. Respaldo `backups/09-ejecucion-paper-*.zip`.
- 2026-11-17: Órdenes desde la interfaz (2 subagentes; ADR-011). Backend: `POST /broker/paper/conexion` (asegura broker + conexión
  paper y verifica), `GET /broker/paper/resumen` (cuenta, posiciones con P/L en vivo, órdenes), `POST /ordenes/ticket`
  (configuración + orden + envío en un paso, Idempotency-Key), `POST /posiciones/:id/cierre`. Crédito multi-pata: `precioLimite`
  positivo + `credito:true` → `limit_price` negativo (referencia de Alpaca postorder). Frontend: TicketOrden (revisar → confirmar,
  seguimiento hasta ejecución), «Operar» en la estrategia recomendada (patas armadas desde la cadena; contexto del análisis y avisos:
  sin análisis, >24 h, no es la top, cores contradictorios), clic en Bid/Ask de la cadena, Cartera paper (Inicio y Broker) con Cerrar/Cancelar.
  Integración corregida: `patrimonio` en cartera, `plPct` viene en %, venta de una pata desde la cadena sin estrategia (400 → se asocia por tipo).
  Verificado real: Iron Condor a crédito aceptado/cancelado (subagente); Long Call y venta de put vía ticket aceptadas/canceladas;
  reintento con la misma key no duplica. 105 pruebas. Respaldo `backups/10-ordenes-interfaz-*.zip`.

- 2026-11-17: Auditoría de exactitud y explicabilidad de los cores (ADR-012). Confluencia 1.1.0 con dispersión/acuerdo entre cores y
  neutralidad media para el Iron Condor. Cores 1.1.0: constantes con nombre y justificación; noticias (polaridad por noticia, sin dilución
  por titulares neutros, intensidad, negadores); institucional (panel balanceado, detección de split); indicadores (IV solo de contratos
  vigentes y ≤ 500 %); fundamental (sin anticipación si el periodo trae `fechaPresentacion`). Nuevo `src/cores/blackscholes.js`
  (A&S 26.2.17) y estrategias 1.1.0: probabilidad de ganancia, delta e IV verificadas contra Alpaca. Inventario técnico exacto en
  `docs/version-funcional/cores-inventario.md`. 115 pruebas.

- 2026-11-17: Despliegue en Render preparado (`render.yaml`, `docs/despliegue-render.md`). Usuarios desde `AUTH_USERS_JSON`
  (prioridad sobre `AUTH_USERS_FILE`) y `npm run exportar:usuarios`; `engines.node >= 20`. Simulado con un clon limpio sin `.env`:
  build de Render OK, servidor en 0.0.0.0, `/health` y SPA 200, login lee usuarios de la variable (401 con clave incorrecta). 117 pruebas.
  El repositorio es público: secretos solo en el panel de Render. Respaldo `backups/13-render-*.zip`.

- 2026-11-17: Cierre de 4 brechas docs/código. (1) ADR-003: trabajos `pendiente`/`procesando` de >15 min y no activos en la cola se
  persisten `fallida` al leerlos (`trabajos-huerfanos.service.js`). (2) `diasVencimientoMin/Max` filtran los contratos del core
  `indicadores` cuando se envían (`iv_promedio` con periodo `min-maxd`). (3) Auditoría automática (`auditoria.service.js`:
  login/logout, ticket/envío/cancelación de órdenes, cierre de posición, verificación de broker, creación de trabajos; mejor esfuerzo,
  email enmascarado en fallos). (4) Índice TTL de sesiones creado por el repositorio MongoDB al primer acceso (el del esquema no
  aplicaba con `autoIndex` apagado); en Supabase, 401 por `expiraEn` y purga de expiradas al iniciar sesión. 122 pruebas.

- 2026-11-19: Screener de universo (~500 símbolos, `src/data/universo.js`). `POST /screener/universo/sincronizaciones` (trabajo de fondo,
  recurso `sincronizaciones` con `recurso: 'universo'` y `total`), `GET .../:id` (progreso) y `GET /screener/ranking` (lee el recurso
  nuevo `screener`; tabla `api_screener` en `database/schema.sql`). Puntaje = confluencia de `tecnico` + `indicadores` (IV de opciones
  ATM a 20-50 días si hay) por estrategia. Alpaca: `velasLote`, `cotizacionesLote`, `reloj` (multi-símbolo, pocas solicitudes).
  `GET /mercado/estado` (reloj + SPY/QQQ/IWM/DIA, caché 60 s). `cambioPct` es fracción (0.012 = 1.2 %), igual que el panorama.

### Bitácora 2026-11-19 · Elegir broker: Alpaca o Webull
Adaptador `webull.client.js` contra Webull OpenAPI (sandbox `api.sandbox.webull.com`, firma HMAC-SHA1 con clave `AppSecret&`, verificada con el vector oficial):
cuenta/saldos, órdenes de opciones de una pata (SINGLE) y multi-pata (VERTICAL, STRADDLE, STRANGLE, CALENDAR, DIAGONAL, BUTTERFLY, CONDOR, IRON_BUTTERFLY,
IRON_CONDOR, estrategia deducida de las patas), consulta/cancelación por `client_order_id` (si la clave de idempotencia no es alfanumérica de ≤32 se usa su hash SHA-256 truncado),
posiciones. No soportado: órdenes de acciones desde el ticket, replace, TP/SL, OTO/OCO, nivel de opciones, datos de mercado (siguen en Alpaca). Live bloqueado (ADR-005).
`broker.service`/`operacion.service`/`sincronizacion.service` eligen el adaptador por `broker.codigo` de la conexión (`env:ALPACA` | `env:WEBULL`).
Contrato: `GET /brokers/disponibles`, `POST /broker/paper/conexion {broker?}`, `GET /broker/paper/resumen?broker=`, `broker` en `POST /ordenes/ticket`; el cierre usa el broker de la posición.
Pendiente: validar en vivo con credenciales reales de Webull (crédito multi-pata asumido como side SELL con precio positivo).

## Cómo ejecutar
- Desarrollo: `npm.cmd run dev` (API :PORT) y en otra terminal `npm.cmd run dev:web` (Vite con proxy).
- Producción local: `npm.cmd run build:all` y `npm.cmd start` → interfaz en `http://HOST:PORT/`, Swagger en `/api/v1/api-docs`.

## Desviaciones aceptadas respecto a contratos.md
- `sec.cikDeSimbolo` devuelve `{cik, nombre, simbolo}`; `tenencias13F` requiere `filers` (se usa `integraciones.filers13F`, 9 instituciones verificadas en EDGAR).
- Códigos de error extra: VALIDACION, NO_PERMITIDO, NO_IMPLEMENTADO (mapeados a HTTP en app.js).
- Confluencia sin datos: `puntaje 50` y `sesgoCombinado null`; el orquestador lo guarda sin puntaje y en selección como cobertura 0.
- `ganancia_maxima` ilimitada (null) se omite de métricas guardadas (deben ser finitas); se explica en motivos.
- `puntaje` con 2 decimales; tras reglas `sesgo = (puntaje-50)/50`.

## Abierto a debate
- `deuda_capital` usa pasivos totales (SEC no aporta deuda financiera separada).
- Ajuste IV ±15 del Iron Condor heurístico (ADR-002).
- 13F por nombre de emisor puede fallar; agregar campo CUSIP a Empresa mejoraría la coincidencia.
- Tablas 13F grandes (BlackRock ~23 MB) hacen lenta la sincronización institucional.
- ~~**Desacuerdo entre cores ≠ neutralidad.**~~ **Atendido (ADR-012, `confluencia@1.1.0`)**: dispersión ponderada D, acuerdo A = 1 − D
  multiplica la señal direccional y la confianza; el Iron Condor usa la neutralidad media de los cores (NVDA: 90 → 40).
- **Snapshots sin historial.** Solo se conserva el último por contrato; un IV Rank requeriría histórico de IV.
- ~~**Noticias casi neutras**~~ **Atendido (`noticias@1.1.0`, `lexico@1.1.0`)**: los titulares sin términos del léxico ya no cuentan como
  neutros (diluían el promedio hacia 0: causa probable del 0.00 de MSFT); polaridad por noticia (pos − neg)/(pos + neg), intensificadores,
  más negadores ("fail", "unable", "lacks") y ~60 términos nuevos. Pendiente: calibrar con titulares reales etiquetados.
- 13F: una institución que aún no presentó el corte más reciente se trataba como "sale" (sesgo bajista artificial entre el
  cierre del trimestre y el día 45). Atendido con panel balanceado (`institucional@1.1.0`). Pendiente: guardar qué filers presentaron
  cada corte para distinguir salida real de presentación pendiente.
- Probabilidad de ganancia (Black-Scholes) es neutral al riesgo y lognormal: no es una predicción del mundo real.

### 2026-11-19 · Frontend: navegación superior, screener y análisis técnico
- Barra lateral eliminada: barra superior (Inicio · Análisis · Posiciones · Órdenes · Configuración) con buscador de ticker, estado del mercado, selector de broker (Alpaca/Webull, `BrokerContext` en localStorage) y salir. Rutas antiguas redirigen (`/analizar/:s`, `/panel`, `/mercado/:s`, `/broker`, catálogos → `/configuracion/*`).
- Inicio: índices + screener Top 5 por estrategia sobre el universo (`/screener/*`, `/mercado/estado`, `/brokers/disponibles`) con sincronización y progreso.
- Análisis: «Analizar» sincroniza solo los recursos que piden los cores activos (`requiere` de `/cores/catalogo`) y solo evalúa/selecciona esos cores; gráfica con soportes/resistencias y señales, confluencia, indicadores y pestañas por estrategia con contratos, DTE, payoff y operación con el broker elegido. S/R y señales se calculan en el cliente (`utils/senales.js`, `utils/indicadores.js`).
- Posiciones y Órdenes: páginas propias filtradas por el broker elegido; Configuración con sub-pestañas.

### 2026-11-23 · Unificación de la versión funcional
- Se integra en `version-funcional` el trabajo del 2026-11-19 (screener, brokers Alpaca/Webull, navegación superior y análisis técnico).
- Corrección: «Desglose por core» mostraba vacíos Importancia y Puntos; ahora lee los pesos efectivos de la confluencia guardada.
- Nuevo `scripts/smoke-screener.cjs` (Alpaca real + base real, sin órdenes, limpia al terminar). MongoDB: 492 símbolos en ~91 s, 7 sin datos.
- Ranking: los empates (Iron Condor topado en 100) se resuelven por el factor principal de la estrategia y después el alfabeto.
- Universo: se retiran FI, HES, ANSS, JNPR, IPG, WBA y CTLT (sin velas suficientes en Alpaca); quedan 485 y 0 fallidos.
- `api_screener` creada en Supabase y screener verificado ahí. Orden paper real (Iron Condor AAPL) aceptada y cancelada en Alpaca.
- Webull sandbox verificado con credenciales reales: cuenta, posiciones y resumen (MongoDB y Supabase); `/trading/orders/preview` acepta Call e Iron Condor.
  `WEBULL_ACCOUNT_ID` admite account_id o número de cuenta; `client_order_id` de 10 a 32 caracteres (si no, hash). `smoke-ticket.cjs <base> <broker>`.
  Pendiente: envío, cancelación y ejecución en horario de mercado (Webull rechaza fuera de 9:30-16:00 ET).

### 2026-11-23 · Mapa del mercado en vivo y universo automático
- **Sin datos de empresas en el código** (petición del usuario): se eliminó `src/data/`. `catalogo-universo.service.js` arma el universo
  (500 mayores por capitalización con opciones y reportes 10-Q) con Alpaca (activos, cotización) y SEC (CIK, acciones, flotante, SIC). Ver ADR-013.
- `universo-vivo.service.js`: se inicia solo al arrancar (`src/index.js`), compartido en memoria. `GET /mercado/mapa`, `GET /mercado/mapa/:simbolo`;
  `GET /screener/ranking` lo usa. Ranking en ~11 s la primera vez y ~4 s después (se guarda con propietario `sistema-universo`).
- Cotización: IEX en vivo + consolidado `delayed_sip` (cierre y volumen oficiales). Velas del ranking: SIP con 16 min de retraso.
- Corrección: 36 de 485 empresas perdían la IV en silencio por el límite de Alpaca (429). Ahora ritmo de 100/min y `conReintento`.
- Corrección: la lista anterior incluía 12 empresas que ya no cotizan (WBD, CTRA, MMC...); algunas salían en el Top 5.
- Frontend: `MapaMercado` (treemap propio, color por variación o compatibilidad, sectores, tabla, búsqueda), `FichaEmpresa`, `ResumenSector`,
  `useSondeo`; Top 5 sin botones; al abrir una empresa con datos viejos se actualizan solos.
- Pendiente: probar con el mercado abierto; las velas de «Análisis» siguen siendo IEX (el ranking usa SIP); sector según SIC (p. ej. Visa y
  Mastercard figuran en servicios); los índices de referencia (SPY, QQQ, IWM, DIA) y los filers 13F siguen configurados en código.

### 2026-11-24 · Auditoría y mejoras con subagentes
Tres auditorías (funcionalidad/seguridad, cores/finanzas, diseño) y mejoras en ramas separadas, integradas y probadas juntas:
- **Órdenes:** un reintento ya no da por enviado lo que falló (busca la orden en el broker, la adopta o la reenvía); cierre de estructuras completas
  (`POST /posiciones/cierre-grupo`), ejecuciones parciales, patas de Webull con su lado propio, CRUD de órdenes y posiciones protegido.
- **Plataforma:** listados y borrados sin tope de 10 000 filas, límites por IP, correo y usuario (`TRUST_PROXY`), encabezados de seguridad, gzip,
  índices de MongoDB al arrancar, retención de registros, tiempo límite también para el cuerpo de las respuestas.
- **Mercado:** instituciones 13F obtenidas de la SEC, índices configurables (`INDICES_REFERENCIA`) con nombre del proveedor, limitador de Alpaca
  ≤180/min, `GET /mercado/movimientos`; se eliminó la sincronización manual del universo y código sin uso.
- **Riesgo:** pérdida y ganancia máximas para cualquier combinación de patas, filtros de liquidez, probabilidad de ganancia y griegas en dólares antes
  de enviar, vencimiento objetivo de 35-45 días, etiquetas que coinciden con el número.
- **Diseño:** cabecera de 56 px, barra inferior en móvil, tema elegible, mapa accesible y en español, glosario, configuración agrupada.
- Propuesta de calibración de puntajes: ADR-014 (sin aplicar).

### 2026-11-24 · Decisión con los cinco cores (ADR-015)
`screener@2.0.0` (`combinarCores`), universo vivo con cores lentos en segundo plano, `sec.cargarTenencias13F` (lectura masiva) y `tests/cinco-cores.test.cjs`.

### 2026-11-24 · Ajustes pedidos tras revisar Render
Inicio con las 5 mejores antes del mapa; buscador con coincidencias (tolera errores; Enter no analiza a ciegas); historico del consolidado desde 2016 con carga automatica por rango; soportes y resistencias con extremos del periodo y visitas; rotulos de la grafica sin encimarse.

### 2026-11-24 · Backtest de la recalibración (ADR-014)
La propuesta no mejora la predicción frente a la fórmula vigente y no se aplica. Detalle y método en el ADR.

### 2026-11-24 · Prueba con el mercado abierto (paper)
- Mapa en vivo: abierto, 500 empresas, 154-244 precios cambian entre lecturas de 12 s; coincide con el consolidado retrasado.
- Webull: envio y cancelacion correctos. Iron Condor AAPL de 1 contrato abierto a 0.41 y cerrado desde la app a 1.28 (perdida simulada ~87 USD); 0 posiciones.
- Hallazgos corregidos: Webull no informa lado ni cantidad por pata (se deducen con evidencia numerica, `deducirLados`), repite `leg_id` en todas,
  no admite estructuras a mercado y confirma la cancelacion con retraso. `scripts/smoke-cierre-condor.cjs` reproduce la prueba.
