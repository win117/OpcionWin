# Tasks

## 1. Piezas puras del monitoreo

- [x] 1.1 `src/modulos/monitoreo/metricas.js`: contador, histograma (cubetas 5 ms–10 s) y valores calculados con exportación en texto Prometheus 0.0.4 (HELP/TYPE, etiquetas escapadas, `_bucket{le}`/`_sum`/`_count`); probar en `tests/monitoreo.test.cjs` el formato exacto y el escape de etiquetas
- [x] 1.2 `src/modulos/monitoreo/uso.js` (analítica por endpoint y seudónimo, p50/p95, rechazos 429/503, tope de claves) y `errores.js` (huella = tipo + mensaje sin números/ids + ruta, conteo, primera/última vez, requestId de ejemplo, tope de 200 grupos, mensajes con `ocultarSecretos`); probar agrupación y topes

## 2. Instrumentación y endpoints de operación

- [x] 2.1 Middleware de instrumentación (`Server-Timing`, métrica por ruta-patrón, analítica, log JSON con `LOG_FORMATO=json` sin cuerpo/consulta/token/id real) y montaje en `src/app.js` justo después del `requestId`; probar `Server-Timing`, la etiqueta de patrón y la línea de log sin datos sensibles
- [x] 2.2 Módulo `src/modulos/monitoreo/` (schema, routes, controller, service, index): `GET /metrics` (incluye proceso, circuitos y cola), `GET /monitoreo/errores`, `GET /monitoreo/uso`; protegidos con `MONITOREO_TOKEN` (404 sin configurar, 401 con token incorrecto, comparación en tiempo constante); probar cada escenario de la spec y que la estructura por dominio lo vigila
- [x] 2.3 Captura de errores en el manejador de `src/app.js` (junto a `registrarError`) y envío opcional a Sentry por *envelope* sin bloquear (tope 3 s, 1 por huella/60 s); probar agrupación de 3 errores iguales y que Sentry caído no afecta la respuesta (fetch simulado)

## 3. Monitoreo sintético y configuración

- [x] 3.1 `.github/workflows/monitoreo-sintetico.yml` (cada 15 min + manual) que ejecuta `scripts/smoke-despliegue.cjs` contra `vars.URL_PRODUCCION` y se omite sin fallar si no está; verificar sintaxis YAML y ejecutar el mismo comando en local contra el servidor de pruebas
- [x] 3.2 `.env.example`: `MONITOREO_TOKEN`, `MONITOREO_SAL`, `LOG_FORMATO`, `SENTRY_DSN` documentadas (sin valores reales)

## 4. Documentación

- [x] 4.1 `docs/guia-opciones/08-pruebas-y-monitoreo.md`: cada tipo de prueba y de monitoreo del inciso C con su herramienta, comando, resultado real y pasos para conectar Grafana Cloud, UptimeRobot y Sentry; verificar que cada comando citado existe en `package.json`

## 5. Verificación

- [x] 5.1 Prueba manual: servidor de pruebas con `MONITOREO_TOKEN`, tráfico con k6 en modo humo y lectura de `/metrics`, `/monitoreo/uso` y `/monitoreo/errores`
- [x] 5.2 `npm run verificar` pasa completo
