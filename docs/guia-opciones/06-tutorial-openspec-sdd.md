# 6. Tutorial: desarrollo guiado por especificaciones (SDD) con OpenSpec

> Tutorial transversal a los objetivos 4 y 5. Cubre cómo se usa OpenSpec en AppRESTOpciones, un caso de estudio real
> paso a paso (`optimizar-microservicios-apis`) y los cambios (*changes*) creados para cada objetivo.
> Versión usada: OpenSpec 2.2.0 (`@fission-ai/openspec`), con Claude Code como asistente de IA.

## 6.1 ¿Qué es SDD y qué es OpenSpec?

En el desarrollo tradicional la idea va directo al código y la documentación llega después, si llega. En **SDD**
(*Spec-Driven Development*) primero se acuerda **qué** debe hacer el sistema, en requisitos verificables, y después se
programa contra eso.

```
Tradicional:   idea ──────────────────────────────▶ código ──▶ (documentación)
SDD:           idea ──▶ propuesta ──▶ specs ──▶ diseño ──▶ tareas ──▶ código ──▶ archivo (specs vivas)
                           └──── revisión humana ANTES de programar ────┘
```

**OpenSpec** es un framework SDD ligero. Guarda todo en la carpeta `openspec/` del repositorio y le da a la IA un
flujo fijo. Tiene dos partes:

| Carpeta | Qué contiene | Analogía |
|---|---|---|
| `openspec/specs/<capacidad>/spec.md` | Lo que el sistema **hace hoy** (la fuente de verdad) | El plano vigente de la casa |
| `openspec/changes/<cambio>/` | Una modificación en curso: propuesta, specs *delta*, diseño y tareas | Una orden de remodelación |
| `openspec/changes/archive/` | Cambios terminados, con fecha | El historial de remodelaciones |
| `openspec/config.yaml` | La **constitución** del proyecto: contexto y reglas que la IA lee antes de cada propuesta | El reglamento de la obra |

Un requisito se escribe con **SHALL/MUST** y cada uno lleva al menos un **escenario** «cuando / entonces» que se puede
convertir en una prueba:

```markdown
### Requirement: Fallo rápido con el circuito abierto
Con el circuito abierto, toda solicitud a ese proveedor SHALL fallar sin contactar la red ...

#### Scenario: Consulta con Alpaca caído
- **WHEN** el circuito de Alpaca está abierto y se pide `GET /api/v1/mercado/cotizaciones/AAPL/en-vivo`
- **THEN** responde 503 en menos de 100 ms
```

## 6.2 Instalación y configuración en este proyecto

1. **Instalar sin tocar el proyecto.** Se instaló de forma global para no cambiar `package.json` (Render instala con él):
   ```bash
   npm i -g @fission-ai/openspec@2.2.0
   ```
2. **Probar antes en una carpeta vacía** qué archivos crea `init`. Solo agrega `openspec/` y las skills; no modifica
   nada existente.
3. **Inicializar** en español, para Claude Code y con las skills dentro del proyecto:
   ```bash
   openspec init --tools claude --language es --scope project --no-animation
   ```
   Crea `openspec/config.yaml`, `openspec/specs/`, `openspec/changes/` y 7 skills (`/openspec-propose`,
   `/openspec-apply-change`, `/openspec-archive-change`, `/openspec-explore`…).
4. **Escribir la constitución** (`openspec/config.yaml`): stack, capas, reglas que no se negocian (solo paper,
   credenciales por referencia, sin Interactive Brokers) y la regla que pide la actividad:
   ```yaml
   ## Estructura propuesta por la IA
   Si al analizar un cambio la estructura actual no es la óptima, proponer en design.md la estructura alternativa
   (con justificación, impacto y plan de migración) en lugar de solo seguir la existente; la migración se hace
   como change separado y sin romper los endpoints actuales (/api/v1).
   rules:
     design:
       - Si la estructura actual no es óptima para el cambio, proponer la estructura alternativa y justificarla.
     tasks:
       - "Última tarea siempre: ejecutar npm run verificar (lint + pruebas + build del frontend) y que pase."
   ```
5. **Comprobar** con `openspec doctor`. Detectó un error de YAML (los dos puntos sin comillas en la regla de tareas),
   que se corrigió entre comillas.
6. **Privacidad:** OpenSpec manda estadísticas anónimas. Se apagan con `OPENSPEC_TELEMETRY=0` o
   `openspec config set telemetry.enabled false`.

## 6.3 Documentar lo que ya existía (specs base)

Antes del primer cambio se escribió la línea base: **11 capacidades y 73 requisitos** sacados del código y de las
pruebas que ya pasaban, no de memoria:

- `sesiones-autenticacion`
- `recursos-crud`
- `trabajos-asincronos`
- `datos-mercado`
- `universo-screener`
- `cores-analisis`
- `estrategias-seleccion`
- `brokers-paper`
- `ordenes-paper`
- `posiciones-cuenta`
- `plataforma-seguridad`

Cuatro datos dudosos se verificaron contra el código y se corrigieron: el login responde 200 y no 201, el cierre de
sesión 204, la salud está en `/health`, y la nota del puntaje dice «no es la probabilidad de ganar».

```bash
openspec validate --specs        # 11 passed, 0 failed
openspec list --specs            # capacidades y número de requisitos
```

## 6.4 El ciclo de trabajo

| Paso | Comando (skill) | Qué produce | ¿Toca código? |
|---|---|---|---|
| 1. Explorar (opcional) | `/openspec-explore` | Conversación para aclarar la idea | No |
| 2. Proponer | `/openspec-propose "<idea>"` | `proposal.md`, `specs/**/spec.md` (delta), `design.md`, `tasks.md` | **No** |
| 3. Revisar | Humano (y `/openspec-update-change`) | Ajustes a la propuesta | No |
| 4. Aplicar | `/openspec-apply-change <cambio>` | Código + pruebas; marca cada tarea `[x]` | Sí |
| 5. Archivar | `/openspec-archive-change <cambio>` | Funde los deltas en `openspec/specs/` y mueve el cambio a `archive/` | No |

Reglas útiles aprendidas en el proyecto:
- **Delta, no copia.** Un cambio describe solo lo que cambia: `## ADDED`, `## MODIFIED` (el bloque completo),
  `## REMOVED` (con motivo y migración) o `## RENAMED`.
- **ADDED frente a MODIFIED.** Si se agrega una regla sin cambiar la existente, va como ADDED. `--strict` marcó un
  MODIFIED de más de 500 caracteres, y la solución correcta fue convertirlo en un requisito nuevo.
- **`openspec validate <cambio> --strict`** antes de pedir la revisión.
- **El límite de la planeación:** `propose` nunca programa. Implementar requiere una petición nueva (`apply`).

## 6.5 Caso de estudio paso a paso: `optimizar-microservicios-apis`

**Objetivo (inciso B).** Aplicar técnicas de microservicios a todas las APIs y dejar que la IA evalúe la estructura.

**Paso 1. Investigar antes de proponer.** La IA revisó el código para no proponer lo que ya existía:
- **Ya existían:** reintentos con espera exponencial, límites, ETag/304, gzip, apagado ordenado y `cola.vaciar()`.
- **Faltaban:** el circuit breaker, la readiness y el drenado al apagar.
- **Riesgo hallado:** `clasificarErrorEnvio` decide si una orden «no llegó» o quedó «ambigua»; un circuito abierto
  debía contar como «no llegó».

**Paso 2. Proponer.**
```text
/openspec-propose optimizar-microservicios-apis: circuit breaker por proveedor, readiness /health/listo,
drenado de la cola al apagar; evaluar si la estructura manual es óptima y, si no, proponer la propia.
```
Resultado (`openspec/changes/optimizar-microservicios-apis/`):

| Artefacto | Contenido clave |
|---|---|
| `proposal.md` | Por qué (un proveedor caído colgaba las APIs 15 s; los despliegues cortaban trabajos), qué cambia y qué queda fuera |
| `specs/resiliencia-proveedores` (nueva) | 5 requisitos: circuito por proveedor, umbral de 5, fallo rápido 503 + `Retry-After`, recuperación a 30 s, «no es envío incierto» |
| `specs/salud-servicio` (nueva) | 5 requisitos: liveness, readiness, «degrada pero no tumba», comprobaciones acotadas, drenado |
| Deltas en `datos-mercado`, `ordenes-paper`, `trabajos-asincronos`, `plataforma-seguridad` | Cambios mínimos y compatibles en capacidades existentes |
| `design.md` | **Decisión 1: la estructura.** Diagnóstico de la manual (el screener ocupa 7 archivos en 5 carpetas) → módulos por dominio `src/modulos/<dominio>/`; alternativas descartadas (`opossum`, migrar todo, cambiar `/health`) |
| `tasks.md` | 15 tareas verificables en 7 grupos; cada grupo trae sus pruebas |

```bash
openspec validate optimizar-microservicios-apis --strict   # Change 'optimizar-microservicios-apis' is valid
```

**Paso 3. Revisión humana** de la propuesta. Después, la orden «aplica el cambio».

**Paso 4. Aplicar, tarea por tarea.** Cada tarea se marcó `[x]` solo cuando su comprobación pasó:

| Tarea | Evidencia |
|---|---|
| 0.1 Punto de partida | `npm run verificar`: 292 pruebas |
| 1.1 Vigilar `src/modulos/` | La revisión detecta un módulo roto de prueba (6 violaciones) |
| 2.1–2.5 Circuit breaker | 10 pruebas; 303 pruebas totales siguen pasando |
| 3.1–3.2 Readiness | 6 pruebas con bases simuladas |
| 4.1–4.2 Drenado | El trabajo termina antes del cierre; SIGTERM real probado en Linux (CI) |
| 5.1–5.2 ADR-022 y guía 07 | Toda ruta citada existe |
| 6.1 Prueba manual | 5 errores de red reales → la 6.ª da 503 con `Retry-After: 30`; MongoDB y Supabase reales `ok` |
| 6.2 Final | `npm run verificar`: 315 pruebas (+23) |

Hubo tres **hallazgos durante la implementación** que se resolvieron sin cambiar el alcance:
- La spec decía «sin búsqueda de envío incierto». Todo reintento consulta antes al broker (una salvaguarda que ya
  existía), así que el escenario se precisó a «no queda como envío incierto».
- La ADR-021 ya existía, así que la nueva es la **ADR-022**.
- Una prueba se colgaba porque la readiness intentaba conectarse a la base real. Desde entonces, las pruebas siempre
  inyectan comprobaciones simuladas.

**Paso 5. Archivar.**
```bash
openspec archive optimizar-microservicios-apis --yes
# Totals: + 12, ~ 2 → Specs updated successfully. → archive/2026-11-26-optimizar-microservicios-apis
openspec validate --specs   # 14 passed
```

## 6.6 Segundo caso: `convertir-web-en-pwa`

El mismo ciclo convirtió la SPA en PWA instalable:
- capacidad nueva `aplicacion-web-pwa` (9 requisitos);
- delta en `plataforma-seguridad`;
- 20 tareas.

Durante la implementación, el plugin de Vite reemplazó por error un marcador dentro de un comentario. La prueba de
generación lo detectó y se blindó con reemplazos anclados a su línea.

## 6.7 Cambios (*changes*) por objetivo

| Objetivo | Cambio | Estado | Capacidades |
|---|---|---|---|
| Base (documentar lo existente) | Specs base (sin cambio) | Hecho | 11 capacidades, 73 requisitos |
| PWA (punto 5 del inciso A) | `convertir-web-en-pwa` | Archivado 2026-11-26 | `aplicacion-web-pwa`, `plataforma-seguridad` |
| **Objetivo 4: microservicios con SDD (inciso B)** | `optimizar-microservicios-apis` | Archivado 2026-11-26 | `resiliencia-proveedores`, `salud-servicio` + 4 deltas |
| **Objetivo 5: pruebas y monitoreo (inciso C)** | `monitoreo-apis` | Archivado 2026-11-26 | `monitoreo-servicio` (8 requisitos) + delta en `plataforma-seguridad`; pruebas de contrato, E2E, carga y seguridad en la guía 08 |
| Futuro | `migrar-a-modulos-por-dominio` | Sugerido en el diseño | Un dominio por vez, con prueba de contrato antes y después |

## 6.8 Referencia rápida

```bash
openspec list                         # cambios en curso
openspec list --specs                 # capacidades y número de requisitos
openspec show <capacidad> --type spec # una capacidad completa
openspec status --change <cambio>     # qué artefactos faltan
openspec validate <cambio> --strict   # validación estricta
openspec archive <cambio> --yes       # fundir deltas y archivar
openspec view                         # tablero interactivo
```

## Resumen
OpenSpec convirtió la manera de trabajar con la IA: primero una propuesta revisable con requisitos y escenarios, luego
código contra esos escenarios y, al archivar, documentación viva en `openspec/specs/`. La constitución
(`config.yaml`) hizo que la IA evaluara la estructura y propusiera la suya; los dos casos reales del proyecto muestran
el ciclo completo con su evidencia.
