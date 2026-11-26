# Design

## Context

Estado actual relevante (la motivación está en proposal.md):

- **Estructura manual (sin SDD).** Capas por tipo técnico en `src/api/v1/`:
  - `routes/`: 28 archivos;
  - `controllers/`: 27;
  - `services/`: 38 (2 702 líneas);
  - `models/`: 24;
  - `schemas/`: 7.
  - `tests/estructura.test.cjs` vigila que las rutas solo conecten, que los servicios no conozcan HTTP y que cada CRUD
    tenga sus cuatro piezas.
- **Técnicas que ya existen** (manuales):
  - tiempo límite, reintentos con espera exponencial, limitador de ritmo y errores normalizados (`integrations/http.js`);
  - ETag/304 (Express por defecto) y gzip;
  - paginación, límites por usuario, trabajos 202, idempotencia y apagado ordenado (`index.js`).
- **Lo que falta:**
  - **Circuit breaker:** no hay. Con un proveedor caído, cada llamada paga hasta 15 s + reintentos.
  - **Drenado:** `cola.vaciar()` existe, pero `shutdown()` no lo usa.
  - **Readiness:** no hay endpoint.
- **Clasificación de errores existente:**
  - `broker.service.js → clasificarErrorEnvio` decide «no llegó», «rechazada» o «ambiguo»;
  - `sincronizacion.service.js` aborta ante `LIMITE`/`RED`;
  - `app.js` mapea `IntegrationError.codigo` a HTTP, y los errores Boom propagan `output.headers` (así ya funciona
    `Retry-After` en los límites).

## Goals / Non-Goals

**Goals:**
- Que un proveedor caído no degrade la latencia de las APIs que dependen de él.
- Que un orquestador o monitor distinga «vivo» de «listo».
- Despliegues sin trabajos cortados.
- Evaluar la estructura manual y dejar implementada y vigilada la estructura que propone la IA, para compararlas.

**Non-Goals:**
- Migrar los módulos existentes.
- Varias instancias o estado de circuito compartido entre procesos (hay una sola instancia, ADR-003).
- Métricas y alertas (inciso C).

## Decisions

### 1. Evaluación de la estructura actual y estructura propuesta por la IA

**Diagnóstico.** La estructura manual está bien para un monolito por capas y sus reglas están vigiladas por pruebas. Pero
no es óptima para microservicios, porque **una funcionalidad está repartida por tipo técnico**:

- **Disperso:** el screener vive en 7 archivos de 5 carpetas (`schemas/analisis.schema.js`,
  `controllers/analisis.controller.js`, `routes/screener.routes.js`, `routes/index.js`, `services/screener.service.js`,
  `services/universo-vivo.service.js`, `models/Screener.js`).
- **Mezclado:** su definición y su controlador están en archivos de *otro* dominio (análisis).
- **Difícil de extraer:** sacar un dominio como servicio independiente exige cortar a través de todas las carpetas, y
  nada en la estructura dice qué piezas le pertenecen.

**Propuesta: módulos por dominio (vertical slices).**

```
src/modulos/
  compartido/            ← piezas puras reutilizables por varios dominios (sin HTTP ni base)
    circuito.js
  salud/                 ← un dominio = una carpeta con todas sus capas
    salud.schema.js      definición (método, ruta, respuestas) → validación + documentación
    salud.routes.js      solo conecta definición → controlador
    salud.controller.js  HTTP ↔ servicio
    salud.service.js     reglas del dominio, sin req/res
    index.js             montar(app, deps): el único punto de entrada del módulo
```

- **Por qué:**
  - Todo lo de un dominio vive junto.
  - `index.js` es su frontera: se monta con dependencias inyectadas (`factory`, `integraciones`, `cola`) y no importa
    nada de otros dominios.
  - Extraerlo como microservicio es mover una carpeta y su `index.js`.
- **Se conservan las reglas que ya funcionaban:** capas por archivo, rutas que solo conectan y servicios sin HTTP, y
  `tests/estructura.test.cjs` se extiende para recorrer `src/modulos/*/`. Así las reglas manuales se mantienen y lo
  nuevo queda vigilado igual.
- **Alternativas:**
  - Seguir en `src/api/v1/` por capas: más consistente hoy, pero no prueba la propuesta ni facilita la extracción.
  - Migrar todo ahora: es el mayor riesgo de romper la app y va contra la regla del proyecto de migrar en un cambio aparte.

**Comparación (evidencia para el inciso B):**

| Aspecto | Manual (sin SDD) | IA con OpenSpec |
|---|---|---|
| Organización | Por tipo técnico (`routes/`, `controllers/`, `services/`…) | Por dominio (`modulos/<dominio>/`) |
| Agregar una API | Tocar 5 o más carpetas y `routes/index.js` | Una carpeta + una línea para montarla |
| Frontera del dominio | Implícita | `index.js` con dependencias inyectadas |
| Punto de partida | Código | Propuesta, specs con escenarios, diseño y tareas aprobados antes del código |
| Pruebas | Escritas junto al código | Derivadas de los escenarios de la spec |
| Reglas de capas | Vigiladas en `src/api/v1/` | Las mismas reglas, extendidas a `src/modulos/` |

### 2. Circuit breaker puro y por instancia de cliente HTTP
- **Qué:** `modulos/compartido/circuito.js` exporta `createCircuito({ umbral = 5, esperaMs = 30000, ahora })`. Es una
  máquina de estados pura (`permitir()`, `exito()`, `fallo()`, `estado()`), sin temporizadores: el tiempo se consulta
  con `ahora`, así que se prueba sin esperar.
- **Dónde:**
  - `integrations/http.js` crea un circuito por cliente (uno por proveedor) y lo consulta antes de cada solicitud.
  - Cuenta como fallo solo el error final (tras los reintentos) de tipo `RED` o 5xx. Los 4xx y el 429 cuentan como
    «respuesta del proveedor» y no abren el circuito.
  - En `semiabierto`, `permitir()` deja pasar una sola solicitud.
- **Error:** `IntegrationError` con el código nuevo `CIRCUITO_ABIERTO` y `reintentoEnMs`. `app.js` lo mapea a 503 y pone
  `Retry-After = ceil(reintentoEnMs / 1000)`.
- **Alternativa descartada:** librería (`opossum`). Es una dependencia nueva para unas 40 líneas puras, y además
  envuelve funciones en vez de integrarse con el cliente HTTP que ya tiene reintentos.

### 3. Clasificación coherente del circuito abierto
- **Órdenes:** `clasificarErrorEnvio` trata `CIRCUITO_ABIERTO` como `error_previo`, porque no salió nada a la red.
- **Sincronización:** `sincronizacion.service.js` lo relanza igual que `RED`.
- **Por qué:** sin esto, una orden que jamás salió quedaría como «envío incierto» y dispararía búsquedas en el broker.

### 4. Readiness en el módulo `salud`
- **Comprobaciones** de `salud.service.js`:
  - MongoDB (si hay `CONNECTION_STRING`): `connectMongo()` + `db.admin().ping()`, con un tope de 2 s.
  - Supabase (si hay URL y clave): un GET mínimo al REST, con un tope de 2 s.
- **Caché del resultado:** 10 s, compartida entre solicitudes simultáneas (una sola comprobación en vuelo).
- **Estado de las bases:** `sin_configurar` si no hay variables. Las respuestas nunca incluyen URL, cadena de conexión
  ni claves.
- **Circuitos:** se leen de `integraciones.estado()`. Uno abierto marca `degradado: true`, pero no da 503.
- **Ruta:** `/health/listo` está fuera de `/api/v1`, como `/health`. No lleva autenticación ni CORS especial y no aparece
  en OpenAPI, como `/health`.
- **Alternativa:** cambiar `/health` para que revise dependencias. Render reiniciaría el servicio cada vez que la base
  tuviera un corte breve: es peor.

### 5. Drenado en la cola y en `index.js`
- **Cola:** `cola.js` suma `drenar()` (marca `aceptando = false`) y `aceptando()`.
- **Rechazo:** el middleware que ya protege los endpoints 202 (`limiteOperaciones`) responde 503 con `Retry-After: 10`
  si la cola no acepta. Así no se crea el registro.
- **Apagado:** `shutdown()` llama a `cola.drenar()` y espera `Promise.race([cola.vaciar(), 8 s])` antes de
  `server.close`. El tope global de 10 s sigue igual.
- **Por qué 8 s:** cabe dentro del tope de 10 s que ya existe. Render da 30 s de gracia por defecto.

## Risks / Trade-offs

- **[Riesgo] El circuito se abre por una racha de errores de un solo endpoint del proveedor.**
  Mitigación: umbral de 5 fallos consecutivos y solo errores de disponibilidad (`RED`/5xx), no 4xx. La recuperación es
  automática a los 30 s.
- **[Riesgo] El circuito abierto bloquea también el cierre de posiciones con el broker caído.**
  Es el comportamiento correcto: el broker no lo procesaría. La orden queda reintentable y el usuario ve un 503 claro con
  `Retry-After` en lugar de un error tras 15 s.
- **[Riesgo] La prueba de estructura extendida falla con algo existente.**
  Mitigación: solo recorre `src/modulos/`, que nace con este cambio.
- **[Trade-off] Dos estructuras conviven** (`src/api/v1/` y `src/modulos/`) hasta que un cambio aparte migre lo demás.
  Es deliberado: permite comparar y no arriesga lo que funciona.
- **[Trade-off] El circuito vive en memoria de una sola instancia.**
  Con varias instancias cada una tendría el suyo (aceptable y documentado en ADR-003).

## Migration Plan

1. Ejecutar `npm run verificar` antes y después.
2. Desplegar como siempre. No hay cambios en `render.yaml`; Render sigue usando `/health`.
3. **Reversa:**
   - quitar la consulta al circuito en `http.js` (los clientes vuelven al comportamiento anterior);
   - desmontar el módulo `salud` en `app.js`;
   - quitar el drenado en `index.js`.
   No hay datos que migrar.
4. **Cambio futuro sugerido:** `migrar-a-modulos-por-dominio`, un dominio por vez, con prueba de contrato antes y después.
