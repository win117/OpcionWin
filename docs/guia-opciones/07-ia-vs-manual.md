# 7. APIs con IA (OpenSpec) frente a APIs manuales — evidencia del inciso B

> Qué APIs se desarrollaron de forma manual (sin SDD) y cuáles con IA mediante OpenSpec, qué técnicas de microservicios
> aporta cada parte y en qué se distingue la estructura de una y otra.
> Cambio de OpenSpec que lo implementa: `optimizar-microservicios-apis` (ADR-022).

## 7.1 Criterio de clasificación

| Categoría | Qué incluye | Cómo se identifica |
|---|---|---|
| **Manual (sin SDD)** | Todo lo desarrollado antes de adoptar OpenSpec, dirigido por el equipo sin especificaciones previas | Commits hasta `0734dd1` (2026-11-25); código en `src/api/v1/`, `src/integrations/`, `src/cores/` |
| **IA con OpenSpec (SDD)** | Lo que nació de un cambio de OpenSpec: propuesta → specs → diseño → tareas → código | Carpeta `openspec/changes/archive/<fecha>-<cambio>/` + código en `src/modulos/` + el commit que implementa cada cambio archivado (p. ej. `6305012`, PWA; y el de `optimizar-microservicios-apis`) |

El flujo SDD deja rastro verificable: cada API hecha con IA tiene su propuesta, sus requisitos con escenarios
(`openspec/specs/`), su diseño y la lista de tareas marcadas, y el commit que la implementa.

## 7.2 Inventario de APIs

| API / grupo | Endpoints | Origen | Qué hizo la IA con OpenSpec |
|---|---|---|---|
| Sesiones (`/sesiones`) | 3 | Manual | — |
| CRUD común (18 recursos: empresas, estrategias, configuraciones, órdenes, posiciones…) | 8 por recurso | Manual | — |
| Análisis (cores, confluencia, selección, screener) | 9 | Manual | — |
| Mercado (`/mercado/*`) | 23 | Manual | **Optimizada:** circuito ante Alpaca/SEC/Tesoro (503 inmediato) |
| Datos de proveedores (`/integraciones/estado`, `/activos/busqueda`, `/sincronizaciones/ejecuciones`) | 3 | Manual | **Optimizada:** `estado` muestra el circuito; la sincronización responde 503 al drenar y se detiene con el circuito abierto |
| Operación paper (ticket, envío, cierres, resumen…) | 12 | Manual | **Optimizada:** circuito del broker; un circuito abierto deja la orden como `error_previo` (reintentable) |
| Trabajos 202 (ejecuciones y evaluaciones) | 5 | Manual | **Optimizada:** 503 + `Retry-After` durante el apagado, sin crear el registro |
| **Readiness `GET /health/listo`** | 1 | **IA con OpenSpec (nueva)** | Creada completa en la estructura por dominio (`src/modulos/salud/`) |
| Liveness `GET /health` | 1 | Manual | Sin cambios (se mantiene para Render) |

En resumen: **68 grupos de rutas manuales** (50 acciones + 18 CRUD) y **1 API nueva hecha con IA**. Además, la IA
optimizó **todas** las APIs que dependen de un proveedor externo o de la cola, sin cambiar sus contratos.

## 7.3 Técnicas de microservicios y su origen

| Técnica | Dónde | Origen |
|---|---|---|
| Versionado de la API (`/api/v1`) | `src/config/config.js` | Manual |
| Validación + documentación desde una sola definición (Zod → OpenAPI) | `src/api/v1/schemas/` | Manual |
| Paginación y filtros tipados | `services/crud.service.js` | Manual |
| Concurrencia optimista (ETag / `If-Match` → 409) y GET condicional (304) | `controllers/crud.controller.js` | Manual |
| Compresión gzip | `middlewares/gzip.handler.js` | Manual |
| Límites de ritmo por IP, correo y usuario (429 + `Retry-After`) | `middlewares/limites.handler.js` | Manual |
| Trabajos asíncronos (202 + consulta) | `src/jobs/cola.js` | Manual |
| Idempotencia (`Idempotency-Key`) | `services/broker.service.js` | Manual |
| Tiempo límite, reintentos con espera exponencial y limitador hacia proveedores | `integrations/http.js` | Manual |
| Apagado ordenado (SIGTERM) | `src/index.js` | Manual |
| **Circuit breaker por proveedor (fallo rápido + recuperación)** | `src/modulos/compartido/circuito.js` | **IA (OpenSpec)** |
| **Readiness separada de liveness** | `src/modulos/salud/` | **IA (OpenSpec)** |
| **Drenado de trabajos al apagar** | `src/modulos/salud/apagado.js`, `jobs/cola.js` | **IA (OpenSpec)** |
| **Módulos por dominio con frontera explícita (extraíbles como servicio)** | `src/modulos/<dominio>/index.js` | **IA (OpenSpec)** |

## 7.4 Diferencia en el proceso

| | Manual (sin SDD) | IA con OpenSpec |
|---|---|---|
| Punto de partida | Una idea o un error; se programa directo | `/openspec-propose`: propuesta con por qué, qué cambia y qué queda fuera |
| Qué se acuerda antes del código | Nada formal (a veces una ADR después) | Requisitos con escenarios **dado/cuando/entonces**, diseño con alternativas y tareas verificables |
| Revisión humana | Sobre el código terminado | Sobre la propuesta, **antes** de escribir código |
| Pruebas | Se escriben junto al código | Se derivan de los escenarios de la spec (cada escenario es un caso de prueba) |
| Cierre | Commit | `/openspec-archive-change`: los requisitos pasan a `openspec/specs/`, la documentación viva |
| Reglas del proyecto | En la cabeza del equipo y en las ADR | En `openspec/config.yaml`, que la IA lee antes de proponer |

**La constitución pide estructura propia.** `openspec/config.yaml` dice:

```yaml
  ## Estructura propuesta por la IA
  Si al analizar un cambio la estructura actual no es la óptima, proponer en design.md la estructura alternativa
  (con justificación, impacto y plan de migración) en lugar de solo seguir la existente; ...
rules:
  design:
    - Si la estructura actual no es óptima para el cambio, proponer la estructura alternativa y justificarla.
```

La IA lo aplicó en `design.md` (decisión 1): evaluó la estructura manual, concluyó que no es óptima para microservicios
y propuso e implementó los módulos por dominio, sin mover lo que ya funcionaba.

## 7.5 Diferencia en la estructura

### Manual: por tipo técnico
Una funcionalidad queda repartida por capas. Ejemplo real, el screener (`GET /api/v1/screener/ranking`):

```
src/api/v1/
  schemas/analisis.schema.js        ← su definición vive en el archivo de «análisis»
  controllers/analisis.controller.js ← su controlador también
  routes/screener.routes.js
  routes/index.js                    ← hay que registrarla aquí
  services/screener.service.js
  services/universo-vivo.service.js
  models/Screener.js
```

**7 archivos en 5 carpetas**, dos de ellos de otro dominio. Para extraerlo como servicio hay que cortar a través de
todas las carpetas.

```js
// src/api/v1/routes/screener.routes.js (manual)
import { analisis as rutas } from '../schemas';                  // definición de otro dominio
import controller from '../controllers/analisis.controller';     // controlador de otro dominio
export default deps => {
  const router = Router(), c = controller(deps);
  router.base = '/screener';
  return registrar(router, rutas.ranking, c.ranking);
};
```

### IA con OpenSpec: por dominio (vertical slice)

```
src/modulos/
  compartido/circuito.js      ← pieza pura reutilizable (sin HTTP, red ni entorno)
  salud/
    salud.schema.js           definición (método, ruta, respuestas)
    salud.routes.js           solo conecta definición → controlador
    salud.controller.js       HTTP ↔ servicio
    salud.service.js          reglas del dominio, sin req/res
    salud.comprobaciones.js   adaptadores a MongoDB y Supabase
    apagado.js                ciclo de vida (drenado)
    index.js                  ← única frontera: montarSalud(app, deps) y crearApagado
```

Todo el dominio está en una carpeta. El resto de la app solo importa `index.js`, y las dependencias (integraciones,
cola, comprobaciones) llegan inyectadas. Extraerlo como microservicio es mover la carpeta.

```js
// src/modulos/salud/index.js (IA)
export function montarSalud(app, { integraciones, cola, comprobaciones = comprobacionesReales(), ...opciones } = {}) {
  const servicio = createSalud({ integraciones, cola, comprobaciones, ...opciones });
  app.use(rutasSalud(crearControladorSalud(servicio)));
  return servicio;
}
// src/app.js: una línea para montar el dominio completo
app.locals.salud = montarSalud(app, { integraciones, cola });
```

### Comparación medible

| Aspecto | Manual | IA con OpenSpec |
|---|---|---|
| Carpetas que toca una API | 5 (+ registro en `routes/index.js`) | 1 (+ una línea en `app.js`) |
| Archivos de otros dominios que se editan | Sí (screener → `analisis.*`) | No |
| Frontera del dominio | Implícita | `index.js` con dependencias inyectadas |
| Reglas de capas vigiladas por prueba | Sí (`src/api/v1/`) | Sí, las mismas extendidas a `src/modulos/` (`tests/estructura.test.cjs`) |
| Requisitos escritos antes del código | No | Sí (`openspec/specs/salud-servicio`, `resiliencia-proveedores`) |

## 7.6 Pruebas que respaldan lo hecho con IA

| Archivo | Qué comprueba |
|---|---|
| `tests/resiliencia.test.cjs` | El circuito abre a los 5 fallos, no lo abren los 4xx, prueba única en semiabierto, 503 en menos de 100 ms con `Retry-After`, estado visible sin secretos |
| `tests/salud.test.cjs` | Readiness listo / no listo, tope de 2 s, caché de 10 s, proveedor degradado, `/health` intacto, apagado con drenado |
| `tests/operacion.test.cjs` | Circuito abierto al enviar → `error_previo`, no envío incierto |
| `tests/plataforma.test.cjs` | Drenado: 503 sin crear el registro; el trabajo en curso termina |
| `tests/estructura.test.cjs` | Los módulos por dominio cumplen las reglas de capas; detecta un módulo que las rompe |
| `tests/start.test.cjs` | SIGTERM real con código 0 (en Linux, GitHub Actions) |

## Resumen
Las 68 rutas existentes se desarrollaron de forma manual, sin SDD, sobre una estructura por capas técnicas. Con
OpenSpec, la IA escribió primero los requisitos y el diseño, evaluó esa estructura, propuso módulos por dominio y con
ella creó la readiness. Además aplicó a todas las APIs que dependen de proveedores o de la cola tres técnicas de
microservicios que faltaban: circuit breaker, readiness y drenado. Nada de `/api/v1` cambió de contrato.
