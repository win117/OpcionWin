# 8. Pruebas y monitoreo de las APIs (inciso C)

> Cada tipo de prueba y de monitoreo que pide el inciso C: con qué se hizo, cómo se ejecuta y qué resultado dio.
> El monitoreo se implementó con OpenSpec (cambio `monitoreo-apis`, capacidad `monitoreo-servicio`).

## 8.1 El servidor de pruebas

Las pruebas pesadas (E2E, carga y seguridad) corren contra `scripts/servidor-pruebas.cjs`. Es la **app compilada
real**, pero con:
- base de datos en memoria;
- un usuario fijo (`prueba@local`);
- proveedores sin credenciales.

Así no tocan las bases reales ni gastan cuota de Alpaca.

`scripts/con-servidor-pruebas.cjs <comando>` levanta ese servidor, espera a `/health`, ejecuta el comando y lo apaga.
Si el puerto ya está ocupado, falla en lugar de usar otro servidor. Esa protección se agregó después de que un servidor
olvidado contaminó una prueba de carga.

## 8.2 Pruebas de APIs

| Tipo | Herramienta | Dónde | Cómo se ejecuta | Resultado |
|---|---|---|---|---|
| **Unitarias** (lógica aislada con dobles de prueba) | `node:test` | `tests/cores`, `estrategias-orden`, `resiliencia`, `monitoreo`, `pwa`… | `npm test` | Cores, reglas, circuito, métricas y errores probados sin red ni base |
| **Integración** (API + base + servicios externos simulados) | `node:test` + `fetch` contra la app | `tests/http`, `acciones`, `operacion`, `repositorios`, `salud` | `npm test` | Flujo sincronizar → cores → selección → orden paper; MongoDB y Supabase con el mismo contrato |
| **Contrato** (estilo Pact) | Contrato del consumidor + verificador propio | `tests/contrato/web-api.contrato.json`, `tests/contrato.test.cjs` | `npm test` | 12 interacciones que la web necesita, cumplidas por la API |
| **Funcionales / E2E** | Postman + **Newman** | `tests/e2e/*.postman_collection.json` | `npm run test:e2e` | 26 solicitudes, **49/49 aserciones** |
| **Carga y estrés** | **k6** 2.4.0 | `tests/carga/carga.k6.js` | `npm run test:carga` (`MODO=estres` / `humo`) | Ver 8.3 |
| **Seguridad** | **OWASP ZAP** 2.17.0 + pruebas OWASP API Top 10 | `tests/seguridad/zap-plan.yaml`, `tests/seguridad.test.cjs` | `npm run test:seguridad` / `npm test` | Ver 8.4 |
| **Smoke** (post-deploy) | Guion propio | `scripts/smoke-despliegue.cjs` | `npm run smoke:despliegue -- https://<app>.onrender.com` | 7/7 en local |
| **Regresión** | GitHub Actions | `.github/workflows/pruebas.yml` | En cada push | Lint + 337 pruebas + build + E2E + auditoría; si falla, Render no publica |

**Contrato, en detalle.** Cada interacción indica qué archivo de la web la usa (`AuthContext.jsx`, `useJob.js`,
`BrokerContext.jsx`…) y qué espera de la respuesta, con comparadores por tipo (`uuid`, `iso-date`, `oneOf`, `regex`,
`cadaElemento`). La verificación también falla si el consumidor deja de usar esa ruta, y hay una prueba de que el
verificador detecta un proveedor que no cumple.

**E2E, en detalle.** La colección recorre seis grupos:
- plataforma (liveness y readiness);
- sesión (400, 401, login, consulta);
- CRUD con concurrencia optimista (201 + ETag, 304 condicional, `If-Match` → 200, versión vieja → 409, 405);
- análisis y trabajos 202;
- proveedores y circuitos (503 claro);
- limpieza (404, logout 204, token revocado 401).

## 8.3 Carga y estrés (k6)

Escenario: 80 % lectura (listar, leer, estrategias, catálogo), 20 % escritura y readiness, con 0.5 s de pausa por
iteración. Una sesión compartida, porque el login limita a 10 intentos por minuto, que es una protección intencional.

| Prueba | Usuarios virtuales | Solicitudes | Por segundo | p95 | p99 | Errores | Umbrales |
|---|---|---|---|---|---|---|---|
| Humo | 1 | 74 | 15 | 1.8 ms | 10.3 ms | 0 % | ✔ |
| **Carga** | 50 sostenidos (1 min) | 37 632 | 417 | **14.3 ms** | 33.1 ms | **0 %** | ✔ todos |
| **Estrés** | hasta 300 | 105 380 | 1 052 | 303.4 ms | 472.2 ms | **0 %** | ✗ listar p95 = 400.3 ms (umbral 400) |

**Lectura.**
- **Con 50 usuarios** la API está muy holgada: p95 de 14 ms y ningún error.
- **Con 300 usuarios** sigue sin errores, pero la latencia sube unas 20 veces y el listado paginado cruza su umbral.
  Ese es el **punto de quiebre**: un solo proceso de Node empieza a encolar solicitudes.
- **Acciones si hiciera falta:** más instancias detrás del balanceador de Render (la cola y los circuitos están en
  memoria; ADR-003 y ADR-022), y que el listado no cuente el total en cada página.

## 8.4 Seguridad

**Pruebas propias** (`tests/seguridad.test.cjs`, OWASP API Security Top 10 2023):

| Riesgo OWASP | Qué se comprueba |
|---|---|
| API1 Autorización a nivel de objeto | Otro usuario no lee, cambia ni borra lo ajeno (404) y no aparece en su lista |
| API2 Autenticación | Sin token, token alterado, `Basic` o revocado → 401; fuerza bruta → 429 + `Retry-After` |
| API3 Autorización a nivel de propiedad | `usuarioId`, `_revision` y `owner_id` no se asignan (400); no se exponen hashes ni `credencialRef` |
| API4 Consumo de recursos | Cuerpo de más de 1 MB → 413; páginas de más de 100 o lotes de más de 100 → 400 |
| Inyección | `?simbolo[$ne]=x`, ids con operadores o `../` no filtran ni devuelven datos; la búsqueda escapa expresiones regulares |
| API8 Configuración | `nosniff`, `X-Frame-Options: DENY`, CSP, `no-referrer`, sin `X-Powered-By`, CORS cerrado, errores sin pila, `no-store` |
| API9 Inventario | Rutas desconocidas → 404; métodos no previstos → 404/405 |

**OWASP ZAP** (escaneo dinámico autenticado, `npm run test:seguridad`):
- importó **299 URL** desde OpenAPI y escaneó en modo pasivo y activo con el token del usuario de pruebas;
- envió **94 747 solicitudes de ataque** y **ninguna produjo un 500**:
  - 57 926 × 400: validación de entradas;
  - 27 411 × 404: ids inexistentes o ajenos;
  - 8 214 × 429: el límite de operaciones costosas frenó el bombardeo;
  - 163 × 503: proveedores sin credenciales.

| Alerta | Riesgo | Análisis | Decisión |
|---|---|---|---|
| Spring4Shell (CVE-2022-22965) | Alto | **Falso positivo.** Es una vulnerabilidad del *classloader* de Java/Spring; esta API es Node.js. ZAP lo marca porque `class.module.classLoader…=nonsense` recibe 400, que es la validación rechazando el campo («Campo no editable…») | Marcado como falso positivo en el plan (`alertFilter`), con su justificación |
| XSS persistente en respuesta JSON | Bajo (confianza baja) | La auditoría devuelve tal cual un id intentado con `<script>`. La respuesta es `application/json` + `nosniff`, React escapa el texto y la web no usa `dangerouslySetInnerHTML` | Riesgo aceptado: la auditoría debe registrar fielmente lo intentado |
| User Agent Fuzzer | Informativo | Respuestas distintas según el *User-Agent* en `POST /broker/paper/conexion` (sin credenciales en el servidor de pruebas) | Sin acción |

**Dos lecciones del escaneo:**
- El primer intento **no estaba autenticado**: el 48 % de las respuestas eran 401, porque una regla del `replacer`
  quedó guardada en la configuración de ZAP. Se corrigió con la autenticación oficial (`ZAP_AUTH_HEADER*`) y una
  carpeta de configuración nueva por escaneo (`-dir`).
- `/api/v1/sesiones` se excluye del escaneo activo, porque probaría `DELETE /sesiones/actual` y revocaría el token a
  mitad del escaneo. Esa ruta tiene sus propias pruebas.

## 8.5 Monitoreo de las APIs

| Necesidad | Implementación | Dónde verlo |
|---|---|---|
| **Health checks / uptime** | `GET /health` (liveness) y `GET /health/listo` (readiness con bases, circuitos y cola) | UptimeRobot (8.6) |
| **APM** (latencia, cuellos de botella) | Histograma `http_duracion_segundos` por ruta (patrón), `Server-Timing` en cada respuesta, retraso del event loop | Grafana (p95 por ruta) y DevTools del navegador |
| **Logging centralizado** | `LOG_FORMATO=json`: una línea JSON por solicitud (`ts`, `nivel`, `requestId`, `metodo`, `ruta`, `codigo`, `ms`, `usuario` seudonimizado) | Logs de Render (se puede reenviar a Better Stack o Grafana Loki) |
| **Error tracking** | Errores 500 agrupados por huella en `GET /monitoreo/errores`; envío opcional a **Sentry** por *envelope*, sin SDK | `/monitoreo/errores` o Sentry |
| **Métricas / alertas** | `GET /metrics` en formato Prometheus: solicitudes, duración, errores, memoria, CPU, event loop, circuitos, cola | **Grafana Cloud** (tablero y alertas) |
| **Synthetic monitoring** | `.github/workflows/monitoreo-sintetico.yml`: smoke cada 15 min contra la URL publicada | GitHub Actions (aviso por correo si falla) |
| **Rate limiting / analítica de uso** | Límites existentes (login, operaciones costosas, cola) + `GET /monitoreo/uso`: solicitudes, p50/p95 y rechazos 429/503 por endpoint y por usuario seudonimizado | `/monitoreo/uso` y Grafana |

**Privacidad y protección.**
- `/metrics` y `/monitoreo/*` exigen `Authorization: Bearer <MONITOREO_TOKEN>`; sin token configurado no existen (404).
- Las rutas se etiquetan por **patrón** (`/api/v1/empresas/:id`), nunca con ids reales.
- El usuario aparece solo como **seudónimo**: un hash con sal, de 10 caracteres.
- Logs, métricas y analítica nunca llevan tokens, consultas, cuerpos ni correos. Hay pruebas que lo comprueban.

## 8.6 Conectar los servicios gratuitos (los crea el equipo)

1. **Activar el monitoreo en Render** (*Environment*):
   - `MONITOREO_TOKEN`: un valor largo y aleatorio, por ejemplo de
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
   - `LOG_FORMATO=json`;
   - después de crear Sentry, `SENTRY_DSN`.
2. **Monitor sintético (GitHub):** *Settings → Secrets and variables → Actions → Variables*. Crear
   `URL_PRODUCCION = https://<app>.onrender.com`. Opcionalmente, los secretos `SMOKE_EMAIL` y `SMOKE_PASSWORD` de un
   usuario de prueba. Ejecutarlo una vez a mano en *Actions → Monitoreo sintético → Run workflow*.
3. **UptimeRobot** (uptimerobot.com, gratis):
   - *New monitor → HTTP(s)* a `https://<app>.onrender.com/health` cada 5 min;
   - otro de tipo *Keyword* a `/health/listo` que busque `"listo"`;
   - alerta por correo.
4. **Grafana Cloud** (grafana.com, plan gratuito):
   - *Connections → Add new connection → Metrics Endpoint*;
   - URL `https://<app>.onrender.com/metrics`, autenticación *Bearer* con el `MONITOREO_TOKEN`, cada 60 s.
5. **Paneles sugeridos** (PromQL):
   - Solicitudes por segundo: `sum(rate(http_solicitudes_total[5m]))`
   - Tasa de error 5xx: `sum(rate(http_solicitudes_total{codigo=~"5.."}[5m])) / sum(rate(http_solicitudes_total[5m]))`
   - p95 por ruta: `histogram_quantile(0.95, sum by (le, ruta) (rate(http_duracion_segundos_bucket[5m])))`
   - Circuitos abiertos: `circuito_abierto`; memoria: `proceso_memoria_bytes{tipo="rss"}`
6. **Alertas sugeridas** (Grafana → *Alerting*):
   - p95 > 500 ms durante 5 min;
   - errores 5xx > 5 % durante 5 min;
   - `circuito_abierto == 1` durante 2 min;
   - `cola_aceptando == 0` durante 2 min.
7. **Sentry** (sentry.io, gratis): crear un proyecto *Node.js*, copiar su DSN a `SENTRY_DSN` en Render y provocar un
   error de prueba para verlo agrupado.

Nota sobre Render gratuito: el servicio se duerme tras 15 minutos sin tráfico. El monitor sintético cada 15 minutos
lo mantiene despierto y además mide el arranque en frío (el smoke tolera hasta 90 s en la primera solicitud).

## Resumen
Las APIs quedan cubiertas por:
- **337 pruebas automáticas**: unitarias, integración, contrato y seguridad;
- una colección **E2E** en cada push;
- **k6**: soporta 50 usuarios con p95 de 14 ms; a 300 usuarios, sin errores, aparece el punto de quiebre;
- **ZAP** autenticado: sin hallazgos reales de riesgo alto ni medio;
- un **smoke** post-despliegue.

Para el monitoreo hay métricas Prometheus, logs JSON, errores agrupados con Sentry opcional, analítica de uso y un
monitor sintético. Todo sin dependencias nuevas y listo para conectarse a Grafana Cloud, UptimeRobot y Sentry.
