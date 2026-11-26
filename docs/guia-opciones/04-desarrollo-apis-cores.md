# 4. Desarrollo de APIs con los cores (algoritmos / cerebro)

> Los **5 cores de elegibilidad** (técnico, fundamental, institucional, indicadores y noticias), el **motor de confluencia** y
> los **3 modos de selección** estrategia ↔ empresa, expuestos como API REST.
> Código: `src/cores/`, `src/api/v1/services/analisis.service.js`, `src/api/v1/schemas/analisis.schema.js`.

## 4.1 Arquitectura en capas

```
Cliente ─► routes (registrar + Zod) ─► controllers ─► services ─► cores (puros)
                                                     │        └► integrations (Alpaca, SEC, Tesoro)
                                                     └► repositories (MongoDB | Supabase, por dueño)
```

| Capa | Regla | Vigilada por |
|---|---|---|
| Rutas | Solo HTTP; una sola definición Zod que valida **y** documenta OpenAPI (ADR-017) | `tests/estructura.test.cjs` |
| Servicios | Orquestan; no hablan HTTP | idem |
| Cores | **Funciones puras** (ADR-001): sin red, sin base, sin `Date.now()`, sin azar | idem |
| Repositorios | Siempre filtran por `owner_id` | `tests/repositorios.test.cjs` |

## 4.2 El contrato común de un core

Cada core exporta:

| Export | Contenido |
|---|---|
| `VERSION` | `'tecnico@1.1.0'` → se guarda como `versionAlgoritmo` |
| `REQUIERE` | Insumos: `'velas'`, `'fundamentales'`, `'reportes'`, `'noticias'`, `'opciones?'` (opcional) |
| `SENALES` | Catálogo `[{nombre, etiqueta, descripcion, pesoBase}]` → `GET /cores/catalogo` |
| `evaluar(input)` | `{simbolo, fechaReferencia, velas…, parametros, reglas}` → `{sesgo, confianza, puntaje, cobertura, metricas, motivos, datosFaltantes}` |

**Patrón de todos los cores (paso a paso):**
1. Limpiar datos y descartar lo posterior a `fechaReferencia` (sin sesgo de anticipación).
2. Calcular métricas en su unidad natural (%, razón, índice).
3. Convertir cada métrica a una señal en [−1, 1] con `tanh(x/escala)`, `clamp` o función por tramos.
4. Filtrar las señales que eligió el usuario (`parametros.indicadores`).
5. Combinar con `pesoBase`:
```
sesgo        = Σ p·v / Σ p
consistencia = |Σ p·v| / Σ p·|v|        intensidad = Σ p·|v| / Σ p
cobertura    = señales válidas / total
confianza    = cobertura · (0.5·consistencia + 0.5·intensidad)
puntaje      = 50 + 50·sesgo           (0 bajista · 50 neutral · 100 alcista)
```
6. Aplicar las reglas del perfil (`reglas.js`): ± peso puntos, o neutralizar si una regla obligatoria falla.

## 4.3 Los cinco cores

### 1) Técnico — tendencia (`tecnico@1.1.0`, requiere velas)
| Señal | Métrica | Mapeo | Peso |
|---|---|---|---|
| precio_vs_sma50 | (C/SMA50 − 1)·100 | tanh(%/5) | 1 |
| precio_vs_sma200 | (C/SMA200 − 1)·100 | tanh(%/10) | 1.5 |
| cruce_sma50_200 | SMA50 vs SMA200 | clamp(dif/5) | 1 |
| pendiente_20 | regresión de 20 cierres, %/vela | tanh(%/0.5) | 1 |
| posicion_rango_52s | (C − mín)/(máx − mín) | 2·(pos − 0.5) | 0.75 |
| volumen_relativo_20 | V/promedio 20 previos | signo(vela)·clamp(vr − 1) | 0.5 |

### 2) Indicadores — momentum y volatilidad (`indicadores@1.1.0`, velas + opciones?)
RSI 14 (Wilder) peso 1 · MACD 12/26/9 peso 1 · Estocástico 14/3 peso 0.75 · %B de Bollinger 20/2 peso 0.75.
No direccionales: ATR %, HV20, HV60, **IV promedio** (contratos a ±5 % del dinero, no vencidos, 0 < IV ≤ 5) e **IV/HV20**.
Si HV20/HV60 > 1.5 → confianza × 0.8 (volatilidad en expansión).

### 3) Fundamental — salud del negocio (`fundamental@1.1.0`, datos SEC XBRL)
Crecimiento de ingresos YoY (tanh(g/10), peso 1.5) · crecimiento de utilidad YoY (tanh(g/20), 1) · margen neto (tanh(m/10), 1) ·
deuda/capital (clamp(1.5 − d), 1) · razón corriente (clamp(rc − 1), 0.75) · margen de flujo operativo (tanh(m/15), 1).
Compara anual con anual y trimestre con el mismo trimestre del año previo (estacionalidad).

### 4) Institucional — grandes gestores (`institucional@1.1.0`, 13F de la SEC)
Compara los dos cortes 13F más recientes con **panel balanceado** (solo instituciones presentes en ambos):
cambio agregado de acciones (tanh(%/10), peso 1.5) y amplitud (aumentan − disminuyen)/comunes (peso 1). Detecta splits.
Corte de más de 135 días → confianza × 0.5 (el 13F se publica hasta 45 días después).

### 5) Noticias — sentimiento (`noticias@1.1.0`, noticias de Alpaca)
Léxico propio (`lexico.js`, −2..+2) con negadores, intensificadores y atenuadores. Por noticia: polaridad `(pos − neg)/(pos + neg)`.
Peso con decaimiento exponencial `0.5^(edad/vidaMedia)` (vida media 3 días, ventana 30, configurables).

## 4.4 Motor de confluencia (`confluencia@1.1.0`)

**Paso 1.** Peso efectivo por core: `e_i = w_i (usuario, 0–5) · c_i (confianza)`.
**Paso 2.** Consenso: `s̄ = Σ e_i s_i / Σ e_i`.
**Paso 3.** Desacuerdo: `D = √(Σ e_i (s_i − s̄)² / Σ e_i)`; acuerdo `A = 1 − D`.
**Paso 4.** Neutralidad media: `N̄ = Σ e_i (1 − |s_i|) / Σ e_i`.
**Paso 5.** Compatibilidad por estrategia:
```
LONG_CALL   = 50 + 50·s̄·A
LONG_PUT    = 50 − 50·s̄·A
IRON_CONDOR = 100·N̄ + ajuste(IV/HV20)        ajuste ∈ [−15, +15]
```
**Paso 6.** Confianza = (Σ w_i c_i / Σ w_i) · cobertura · A.

**Ejemplo con los 5 cores (ejecutado):** sesgos +0.17, −0.63, +0.61, +0.15, +0.16 → s̄ = 0.06, D = 0.48, N̄ = 0.57, IV/HV = 1.10:
Long Call **51.6**, Long Put **48.5**, Iron Condor **64.8** (mejor), confianza 0.29 → la interfaz avisa
«Los cores se contradicen: la neutralidad puede ser desacuerdo, no rango lateral».

**Por qué promedio de neutralidades (caso NVDA):** fundamental +1, técnico −0.6, indicadores −0.8, noticias 0. La fórmula
anterior `100·(1 − |s̄|)` daba Iron Condor 90 aunque ningún core indicaba calma; la actual da **40**.

## 4.5 Los 3 modos de selección estrategia ↔ empresa

`POST /api/v1/selecciones/ejecuciones` → **202** (trabajo en cola) → consultar `GET /selecciones/:id`.

| Modo | Pregunta que responde | Entrada obligatoria | Universo | Salida |
|---|---|---|---|---|
| `empresa` | «Tengo AAPL, ¿qué estrategia le va mejor?» | `empresaId` | 1 empresa × 3 estrategias | Estrategias ordenadas |
| `estrategia` | «Quiero un Iron Condor, ¿en qué empresa?» | `estrategiaId` | `empresasCandidatas` o 25 activas | Empresas ordenadas |
| `empresa_estrategia` | «¿Qué tan compatible es Iron Condor en TSLA?» | ambos | 1 × 1 | Un puntaje y motivos |

Algoritmo (`ejecutarSeleccion`): para cada empresa → recalcular cada core seleccionado (nueva `Evaluacion`) → para cada
estrategia → `combinar()` (nueva `Confluencia`) → ordenar por puntaje y desempatar por cobertura.

```json
POST /api/v1/selecciones/ejecuciones
{ "modo": "estrategia", "estrategiaId": "<IRON_CONDOR>",
  "coresSeleccionados": ["tecnico","indicadores","fundamental","noticias"],
  "ponderaciones": [{"core":"tecnico","peso":2},{"core":"noticias","peso":0.5}] }
```
Además, el **screener** (`GET /screener/ranking?estrategia=IRON_CONDOR&limite=5`) ordena ~500 empresas del universo con los
cinco cores ya calculados en segundo plano (ADR-015).

## 4.6 Endpoints de la API de cores

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `GET /cores/catalogo` | Versión, insumos y señales de cada core | 200 |
| `POST /cores/:core/evaluaciones` | Ejecuta un core sobre los datos sincronizados | **202** + trabajo |
| `GET /cores/:core/evaluaciones[/:id]` | Evaluaciones guardadas | 200 |
| `POST /confluencias/ejecuciones` | Combina evaluaciones para una estrategia | 202 |
| `POST /selecciones/ejecuciones` | Los 3 modos de selección | 202 |
| `POST /configuraciones/:id/evaluaciones` | Payoff, breakevens y Black-Scholes de una configuración | 202 |
| `POST /estrategias/catalogo-base` | Crea LONG_CALL, LONG_PUT e IRON_CONDOR | 200 |
| `GET /screener/ranking` | Mejores empresas por estrategia | 200 |
| `POST /sincronizaciones/ejecuciones` | Trae datos de Alpaca/SEC (insumos de los cores) | 202 |

## 4.7 Paso a paso: agregar un core nuevo

1. Crear `src/cores/<nombre>.core.js` con `VERSION`, `REQUIERE`, `SENALES` y `evaluar()` **puro**.
2. Usar `util.combinar` y `util.finalizar` para respetar el contrato.
3. Registrarlo en `src/cores/index.js`.
4. Escribir pruebas con valores calculados a mano en `tests/cores.test.cjs` (sin red).
5. Si necesita un insumo nuevo, añadirlo a `insumos()` en `analisis.service.js` y a la sincronización.
6. `npm run verificar` (ESLint + pruebas + compilación de la página).

## 4.8 Estructura del código y uso de la API (a fondo)

### Árbol del servidor
```
src/
├── index.js              Arranca el servidor y el universo de empresas
├── app.js                Express: middlewares, rutas, Swagger, página web y manejo de errores
├── config/               Variables de entorno y generación de OpenAPI
├── middlewares/          auth (token), validar (Zod), límites, cabeceras, gzip, errores
├── api/v1/
│   ├── schemas/          Cada ruta especial descrita una vez con Zod: valida y documenta
│   ├── routes/           Une verbo + dirección con su controlador
│   ├── controllers/      HTTP ↔ servicio
│   ├── services/         Reglas de negocio y orquestación
│   └── models/           Esquemas Mongoose estrictos (validan para ambas bases)
├── cores/                5 cores + confluencia + Black-Scholes (funciones puras)
├── integrations/         Alpaca, Webull, SEC, Tesoro
├── repositories/         MongoDB o Supabase con la misma interfaz, siempre por dueño
└── jobs/cola.js          Cola en memoria para trabajos 202
```

### Ciclo de vida de una petición
1. `app.js`: `X-Request-Id`, cabeceras de seguridad, compresión, JSON ≤ 1 MB.
2. `authenticate`: lee `Authorization: Bearer <token>`; el token es `baseDatos.usuario.sesion.aleatorio`, en la base solo se guarda
   su SHA-256; deja `req.context = { database, userId }`.
3. `registrar(router, definicion, controlador)` monta la ruta con `validar(definicion)`: params, query, cabeceras y cuerpo pasan por
   Zod y quedan limpios en `req.datos` (400 con el campo exacto si algo falla).
4. El controlador (`handle`) llama al servicio; el servicio usa `repository(nombre, ctx)`, integraciones y cores.
5. Respuesta `{ success, message, data }`; error `{ success:false, message, error, requestId }`. Los `IntegrationError` se traducen:
   `SIN_CREDENCIALES` 503, `LIMITE` 429, `NO_ENCONTRADO` 404, `NO_PERMITIDO` 403, `PROVEEDOR`/`RED` 502.

```js
// schemas/analisis.schema.js — definición única (valida + documenta en Swagger)
export const seleccionar = trabajo({ metodo: 'post', ruta: '/selecciones/ejecuciones', grupo: 'Análisis',
  body: z.looseObject({ modo: z.enum(['empresa', 'estrategia', 'empresa_estrategia']), empresaId: id.nullish(),
    estrategiaId: id.nullish(), coresSeleccionados: z.array(core).min(1), ponderaciones: ponderaciones.optional() }) });
// routes/analisis.routes.js
registrar(router, rutas.seleccionar, c.seleccionar);
// controllers/analisis.controller.js → responde 202 con el registro del trabajo
seleccionar: handle(async (req, res) => aceptar(res, await trabajo(req, 'selecciones', 'seleccion.crear',
  () => analisis.ejecutarSeleccion(req.context, input(req.datos.body))))),
```

**CRUD genérico:** `moduleRouter(nombre)` genera `GET /`, `GET /:id` (con `ETag`), `POST /`, `PUT /:id` (con `If-Match` → 409 si cambió),
`DELETE /:id` y operaciones por lote para cada recurso simple, más rutas de subdocumentos.

**Trabajos 202:** `iniciarTrabajo` crea el registro `pendiente`, lo encola (concurrencia 2) y lo actualiza a `procesando` →
`completada` o `fallida`; el cliente consulta `GET /<recurso>/:id`. Un trabajo con más de 15 min sin avanzar tras un reinicio se marca `fallida`.

### Uso de la API con curl
```bash
# 1) Login → token
curl -X POST http://localhost:3000/api/v1/sesiones -H "Content-Type: application/json" \
  -d '{"email":"alumno@ejemplo.com","password":"********","baseDatos":"mongodb"}'
# 2) Sincronizar datos (202)
curl -X POST http://localhost:3000/api/v1/sincronizaciones/ejecuciones -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"recurso":"historicos","simbolos":["AAPL"]}'
# 3) Ejecutar un core (202) y consultar
curl -X POST http://localhost:3000/api/v1/cores/tecnico/evaluaciones -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"empresaId":"<id>"}'
# 4) Mejor estrategia para la empresa (202)
curl -X POST http://localhost:3000/api/v1/selecciones/ejecuciones -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"modo":"empresa","empresaId":"<id>","coresSeleccionados":["tecnico","indicadores"]}'
# 5) Orden idempotente (201 nueva / 200 repetida)
curl -X POST http://localhost:3000/api/v1/ordenes/ticket -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: 7f9c1e2a-0001" \
  -H "Content-Type: application/json" -d '{"empresaId":"<id>","tipo":"limit","precioLimite":3.6,"cantidad":1,
  "componentes":[{"contratoId":"<id>","accion":"buy","intencion":"buy_to_open"}]}'
```
Documentación interactiva: `/api/v1/api-docs` (Swagger) · especificación: `/api/v1/openapi.json` · salud: `/health`.

## Resumen
Cada core convierte datos en un sesgo [−1, 1] con confianza; la confluencia los combina castigando el desacuerdo, y los tres modos
de selección responden «qué estrategia para esta empresa», «qué empresa para esta estrategia» o «qué tan compatible es este par».
Todo se expone como trabajos asíncronos (202) y queda trazado por versión, parámetros y fuentes.
